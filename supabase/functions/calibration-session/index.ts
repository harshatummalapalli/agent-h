// Calibration Loop B — server-side session manager.
//
// Owns pull-rank-persist and next-batch/rerank against the role_discovery_cache
// table so the ranked pool survives browser refresh, new tabs, and device
// switches without re-burning vendor credits.
//
// Actions (POST body: { action, deal_id, ... }):
//   start      — given a role brief from the browser, call Crustdata (sole
//                active discovery vendor), rank via rank-discovery-batch,
//                persist, return the first batch. bench_note is a diagnostic
//                string surfaced when the pool is empty.
//   next_batch — read cursor from DB, advance it, return next slice.
//   rerank     — append a negative reason, re-rank the stored raw payload,
//                reset cursor, persist, return the new top slice.
//
// Auth: requires a valid Supabase JWT (same pattern as source-candidates-*).
// RLS on role_discovery_cache ensures tenant isolation automatically when
// requests ride the user's JWT.
//
// Expired row cleanup: rows with expires_at < now() are excluded from
// role_discovery_cache. Physical cleanup can be done with:
//   DELETE FROM role_discovery_cache WHERE expires_at < now();
// (a scheduled pg_cron job or a manual periodic cleanup).
//
// UX copy: never say "cache" to recruiters. The bench_note field carries
// diagnostics when the pool is empty.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";
import {
  searchCrustdataForRoleBrief,
  parseLocationForFilter,
  extractCanonicalCountry,
} from "../_shared/crustdataClient.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);
const CRUSTDATA_API_KEY = Deno.env.get("CRUSTDATA_API_KEY");

const BATCH_SIZE = 3;
// Pull Crustdata server-side when bench + cheap pool is below this floor.
// BATCH_SIZE * 3 = 9 — enough for ~3 calibration rounds before the pool
// runs thin. Raise to 15 explicitly if sourcing quality proves too variable.
const CRUSTDATA_POOL_FLOOR = BATCH_SIZE * 3;

// Talent Bench is permanently disabled — Crustdata is the sole discovery
// source when CRUSTDATA_API_KEY is set. Never seed the pool from other deals'
// caches (cross-deal contamination was the root cause of off-role results).
const FORCE_CRUSTDATA_ONLY = true;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST",
};

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });

async function requireAuth(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer" || !token) return null;
  try {
    await jose.jwtVerify(token, SUPABASE_JWT_KEYS, {
      issuer: SUPABASE_JWT_ISSUER,
    });
    return authHeader;
  } catch {
    return null;
  }
}

async function restFetch(
  path: string,
  authHeader: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_ANON_KEY ?? "",
      Authorization: authHeader,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
}

type RawCandidate = {
  id: string;
  full_name?: string | null;
  job_title?: string | null;
  job_company_name?: string | null;
  location_name?: string | null;
  skills?: string[] | null;
  years_experience?: number | null;
  linkedin_url?: string | null;
  _from_bench?: boolean;
};

type RankedEntry = { id: string; rank: number; why_fit: string };

type CacheRow = {
  id?: number;
  deal_id: number;
  payload: RawCandidate[];
  ranked: RankedEntry[];
  cursor: number;
  negative_reasons: string[];
  role_brief_snapshot: Record<string, unknown>;
  expires_at?: string;
};

type MustHaveCheck = {
  label: string;
  status: "found" | "inferred" | "missing";
};

type CalibrationCandidate = {
  external_id: string;
  name: string;
  headline: string | null;
  why_fit: string;
  match_score: number | null;
  linkedin_url: string | null;
  location_name: string | null;
  from_bench: boolean;
  must_haves: MustHaveCheck[];
};

// Common keyword aliases for must-have matching (expand as needed).
const KW_ALIASES: Record<string, string[]> = {
  ".net": ["c#", "csharp", "dotnet", "asp.net"],
  "c#": [".net", "dotnet", "asp.net", "csharp"],
  dotnet: [".net", "c#", "asp.net"],
  "asp.net": [".net", "c#", "dotnet"],
  "node.js": ["nodejs", "node js"],
  nodejs: ["node.js", "node js"],
  javascript: ["js", "ecmascript"],
  typescript: ["ts"],
  python: ["py"],
  golang: ["go lang"],
  kubernetes: ["k8s"],
  postgresql: ["postgres", "pg"],
};

function checkMustHave(
  keyword: string,
  raw: RawCandidate,
  whyFit: string,
): "found" | "inferred" | "missing" {
  const haystack = [
    ...(raw.skills ?? []),
    raw.job_title ?? "",
    raw.job_company_name ?? "",
    raw.location_name ?? "",
    whyFit,
  ]
    .join(" ")
    .toLowerCase();
  const kw = keyword.toLowerCase();
  if (haystack.includes(kw)) return "found";
  const aliases = KW_ALIASES[kw] ?? [];
  if (aliases.some((a) => haystack.includes(a))) return "inferred";
  return "missing";
}

function synthWhyFit(
  raw: RawCandidate,
  roleBrief: Record<string, unknown>,
): string {
  const parts: string[] = [];
  if (raw.job_title)
    parts.push(
      raw.job_title +
        (raw.job_company_name ? ` at ${raw.job_company_name}` : ""),
    );
  if (raw.location_name) parts.push(`based in ${raw.location_name}`);
  const required = [
    ...((roleBrief.required_skills as string[] | null) ?? []),
    ...((roleBrief.must_have_keywords as string[] | null) ?? []),
  ];
  const skills = raw.skills ?? [];
  const overlap = skills.filter((s) =>
    required.some(
      (r) =>
        s.toLowerCase().includes(r.toLowerCase()) ||
        r.toLowerCase().includes(s.toLowerCase()),
    ),
  );
  if (overlap.length > 0)
    parts.push(`skills include ${overlap.slice(0, 3).join(", ")}`);
  else if (skills.length > 0)
    parts.push(`skills: ${skills.slice(0, 3).join(", ")}`);
  return (
    parts.join("; ") || "Profile available — no summary returned by ranking."
  );
}

async function fetchCacheRow(
  dealId: number,
  authHeader: string,
): Promise<CacheRow | null> {
  const res = await restFetch(
    `role_discovery_cache?deal_id=eq.${dealId}&select=*`,
    authHeader,
    { method: "GET", headers: {} },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as CacheRow[];
  return rows?.[0] ?? null;
}

// Pull non-expired bench candidates from OTHER deals in the same tenant.
// RLS scopes to the caller's tenant automatically.
async function fetchBenchCandidates(
  dealId: number,
  authHeader: string,
): Promise<RawCandidate[]> {
  const nowIso = encodeURIComponent(`"${new Date().toISOString()}"`);
  const res = await restFetch(
    `role_discovery_cache?deal_id=neq.${dealId}&expires_at=gt.${nowIso}&select=payload&limit=5`,
    authHeader,
    { method: "GET", headers: {} },
  );
  if (!res.ok) return [];
  const rows = (await res.json()) as { payload: RawCandidate[] }[];
  const bench: RawCandidate[] = [];
  for (const row of rows) {
    for (const c of row.payload ?? []) {
      bench.push({ ...c, _from_bench: true });
    }
  }
  return bench;
}

// Call rank-discovery-batch (sibling edge function) with the user's JWT.
// searchIntent is optional — when present (T4 wiring), it is forwarded so the
// ranking prompt can flag conflicts plainly (e.g. "currently Staff, which was excluded").
async function rankCandidates(
  candidates: RawCandidate[],
  roleBrief: Record<string, unknown>,
  authHeader: string,
  searchIntent?: Record<string, unknown> | null,
): Promise<RankedEntry[]> {
  if (candidates.length === 0) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/rank-discovery-batch`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          apikey: SUPABASE_ANON_KEY ?? "",
        },
        body: JSON.stringify({
          candidates: candidates.slice(0, 100).map((c) => ({
            id: c.id,
            full_name: c.full_name,
            job_title: c.job_title,
            job_company_name: c.job_company_name,
            location_name: c.location_name,
            skills: c.skills,
          })),
          role: roleBrief,
          ...(searchIntent ? { search_intent: searchIntent } : {}),
        }),
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { ranked?: RankedEntry[] };
    return data.ranked ?? [];
  } catch {
    return [];
  }
}

// Upsert the cache row (insert or overwrite on deal_id conflict).
async function upsertCacheRow(
  dealId: number,
  data: Partial<CacheRow>,
  authHeader: string,
): Promise<void> {
  await restFetch(`role_discovery_cache?on_conflict=deal_id`, authHeader, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ deal_id: dealId, ...data }),
  });
}

async function patchCacheRow(
  dealId: number,
  data: Partial<CacheRow>,
  authHeader: string,
): Promise<void> {
  await restFetch(`role_discovery_cache?deal_id=eq.${dealId}`, authHeader, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(data),
  });
}

function buildBatch(
  cache: CacheRow,
  batchSize: number,
): {
  candidates: CalibrationCandidate[];
  pool_size: number;
  cursor: number;
  pool_exhausted: boolean;
} {
  const rawById = new Map(cache.payload.map((c) => [c.id, c]));
  const orderedIds =
    cache.ranked.length > 0
      ? cache.ranked.map((r) => r.id)
      : cache.payload.map((c) => c.id);
  const whyFitById = new Map(cache.ranked.map((r) => [r.id, r.why_fit]));

  const roleBrief = cache.role_brief_snapshot;
  const mustHaveLabels: string[] = [
    ...((roleBrief.required_skills as string[] | null) ?? []),
    ...((roleBrief.must_have_keywords as string[] | null) ?? []),
  ].slice(0, 5);

  const slice = orderedIds.slice(cache.cursor, cache.cursor + batchSize);
  const candidates: CalibrationCandidate[] = slice
    .map((id) => {
      const raw = rawById.get(id);
      if (!raw) return null;
      const rankedWhyFit = whyFitById.get(id) ?? "";
      const why_fit = rankedWhyFit.trim() || synthWhyFit(raw, roleBrief);
      const must_haves: MustHaveCheck[] = mustHaveLabels.map((label) => ({
        label,
        status: checkMustHave(label, raw, why_fit),
      }));
      return {
        external_id: id,
        name: raw.full_name ?? `Candidate ${id}`,
        headline:
          [raw.job_title, raw.job_company_name].filter(Boolean).join(" at ") ||
          null,
        why_fit,
        match_score: null,
        linkedin_url: raw.linkedin_url ?? null,
        location_name: raw.location_name ?? null,
        from_bench: raw._from_bench ?? false,
        must_haves,
      };
    })
    .filter((c): c is CalibrationCandidate => c !== null);

  const pool_exhausted = cache.cursor + batchSize >= orderedIds.length;
  return {
    candidates,
    pool_size: orderedIds.length,
    cursor: cache.cursor,
    pool_exhausted,
  };
}

type RequestBody = {
  action: "start" | "next_batch" | "rerank";
  deal_id: number;
  raw_candidates?: RawCandidate[];
  role_brief?: Record<string, unknown>;
  negative_reason?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  const authHeader = await requireAuth(req);
  if (!authHeader) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { action, deal_id } = body;
  if (!deal_id || typeof deal_id !== "number") {
    return jsonResponse({ error: "deal_id (number) required" }, 400);
  }

  // ── start: merge bench + cheap pool, gate Crustdata, rank, persist ──
  if (action === "start") {
    const rawCandidates = body.raw_candidates ?? [];
    const roleBrief = body.role_brief ?? {};

    // Talent Bench permanently disabled — never pull from other deals' caches.
    const benchCandidates: RawCandidate[] = [];

    // Merge only freshly passed raw_candidates (bench is always empty).
    const seen = new Set<string>();
    const merged: RawCandidate[] = [];
    for (const c of [...benchCandidates, ...rawCandidates]) {
      const key = c.linkedin_url || c.id;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(c);
    }

    // Always call Crustdata when the API key is present — no pool-floor gate.
    let crustdataNote: string | undefined;
    if (CRUSTDATA_API_KEY) {
      const crustdataResult = await searchCrustdataForRoleBrief(
        roleBrief,
        Math.min(CRUSTDATA_POOL_FLOOR + 10, 30),
        CRUSTDATA_API_KEY,
      );
      crustdataNote = crustdataResult.note;
      for (const c of crustdataResult.candidates) {
        const key = c.linkedin_url || c.id;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(c);
      }
    }

    // If pool is empty, return a diagnostic bench_note rather than persisting
    // an empty pool. Prefer the structured note from the Crustdata client when
    // available; otherwise derive a country-specific or generic fallback.
    if (merged.length === 0) {
      const locationStr =
        typeof roleBrief.location === "string" ? roleBrief.location.trim() : "";
      const { place } = locationStr
        ? parseLocationForFilter(locationStr)
        : { place: null };
      const canonicalCountry = place ? extractCanonicalCountry(place) : null;

      let bench_note: string;
      if (!CRUSTDATA_API_KEY) {
        bench_note =
          "Search is not configured on this server yet — ask your admin to set up web search.";
      } else if (crustdataNote?.includes("not configured")) {
        bench_note =
          "Search is not configured on this server yet — ask your admin to set up web search.";
      } else if (crustdataNote?.includes("returned an error")) {
        bench_note =
          "Web search is temporarily unavailable — try again shortly.";
      } else if (
        crustdataNote?.includes("none matched the requested location")
      ) {
        bench_note = canonicalCountry
          ? `Found profiles in web search but none were based in ${canonicalCountry} — check the location in the brief.`
          : crustdataNote ?? "No profiles matched the location in this brief.";
      } else if (
        crustdataNote?.includes("No profiles matched") ||
        crustdataNote?.includes("too little detail")
      ) {
        bench_note = canonicalCountry
          ? `No ${canonicalCountry}-based profiles found for this brief — try a shorter title or fewer required skills.`
          : "No matching profiles found — try broadening the brief.";
      } else if (canonicalCountry) {
        bench_note = `No ${canonicalCountry}-based profiles found for this brief — try broadening the role title or required skills.`;
      } else {
        bench_note =
          "No matching profiles found for this brief — try broadening the criteria.";
      }

      return jsonResponse({
        candidates: [],
        pool_size: 0,
        cursor: 0,
        pool_exhausted: true,
        bench_note,
      });
    }

    // Fetch stored SearchIntent for conflict-aware why-fit ranking (T4).
    // Non-blocking read — missing or failed intent does not block ranking.
    let storedSearchIntent: Record<string, unknown> | null = null;
    try {
      const dealRes = await fetch(
        `${SUPABASE_URL}/rest/v1/deals?id=eq.${deal_id}&select=role_brief_search_intent`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY ?? "",
            Authorization: authHeader,
          },
        },
      );
      if (dealRes.ok) {
        const rows = await dealRes.json();
        const record = rows[0]?.role_brief_search_intent;
        if (record?.current?.conditions) storedSearchIntent = record.current;
      }
    } catch {
      // non-fatal
    }

    const ranked = await rankCandidates(
      merged,
      roleBrief,
      authHeader,
      storedSearchIntent,
    );

    const expiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    await upsertCacheRow(
      deal_id,
      {
        payload: merged,
        ranked,
        cursor: 0,
        negative_reasons: [],
        role_brief_snapshot: roleBrief,
        expires_at: expiresAt,
      },
      authHeader,
    );

    const cacheForBatch: CacheRow = {
      deal_id,
      payload: merged,
      ranked,
      cursor: 0,
      negative_reasons: [],
      role_brief_snapshot: roleBrief,
    };
    const batch = buildBatch(cacheForBatch, BATCH_SIZE);

    // UX copy: recruiter-facing note — never say "cache"
    const bench_note =
      benchCandidates.length > 0
        ? `Found ${benchCandidates.length} ${benchCandidates.length === 1 ? "person" : "people"} from recent searches who may fit — reviewing those before a new search.`
        : null;

    return jsonResponse({ ...batch, bench_note });
  }

  // ── next_batch: advance cursor in DB, return next slice ──
  if (action === "next_batch") {
    const cache = await fetchCacheRow(deal_id, authHeader);
    if (!cache) {
      return jsonResponse({
        candidates: [],
        pool_size: 0,
        cursor: 0,
        pool_exhausted: true,
        bench_note: null,
      });
    }
    // Check if pool is already exhausted before advancing
    const orderedIds =
      cache.ranked.length > 0
        ? cache.ranked.map((r) => r.id)
        : cache.payload.map((c) => c.id);
    if (cache.cursor >= orderedIds.length) {
      return jsonResponse({
        candidates: [],
        pool_size: orderedIds.length,
        cursor: cache.cursor,
        pool_exhausted: true,
        bench_note: null,
      });
    }
    cache.cursor += BATCH_SIZE;
    await patchCacheRow(deal_id, { cursor: cache.cursor }, authHeader);
    return jsonResponse({ ...buildBatch(cache, BATCH_SIZE), bench_note: null });
  }

  // ── rerank: add negative reason, update SearchIntent, re-rank, reset cursor ──
  if (action === "rerank") {
    const cache = await fetchCacheRow(deal_id, authHeader);
    if (!cache || cache.payload.length === 0) {
      return jsonResponse({
        candidates: [],
        pool_size: 0,
        cursor: 0,
        pool_exhausted: true,
        bench_note: null,
      });
    }
    const reasons = [
      ...cache.negative_reasons,
      ...(body.negative_reason ? [body.negative_reason] : []),
    ];

    // T5 WIRING: call resolve-search-intent with the new calibration feedback.
    // Fire-and-forget — re-ranking proceeds regardless of whether this succeeds.
    // The updated SearchIntent will be used on the NEXT ranking pass; immediate
    // re-rank still uses the old intent (consistent with the transition period).
    // Note: role_brief_learned_criteria remains for legacy display; SearchIntent
    // is now the source of truth for filter/rank going forward.
    // Forward the caller's JWT so resolve-search-intent runs under RLS
    // (tenant isolation). Service-role is never used for this call.
    if (body.negative_reason && SUPABASE_URL) {
      void fetch(`${SUPABASE_URL}/functions/v1/resolve-search-intent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY ?? "",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          deal_id,
          calibration_feedback: reasons,
        }),
      }).catch((err) => {
        console.warn("resolve-search-intent (rerank) failed (non-fatal):", err);
      });
    }

    const enrichedBrief = {
      ...cache.role_brief_snapshot,
      avoid_signals: reasons.join("; "),
    };
    // Fetch current SearchIntent for conflict-aware why-fit (T4, rerank path).
    let reRankIntent: Record<string, unknown> | null = null;
    try {
      const dRes = await fetch(
        `${SUPABASE_URL}/rest/v1/deals?id=eq.${deal_id}&select=role_brief_search_intent`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY ?? "",
            Authorization: authHeader,
          },
        },
      );
      if (dRes.ok) {
        const dRows = await dRes.json();
        const rec = dRows[0]?.role_brief_search_intent;
        if (rec?.current?.conditions) reRankIntent = rec.current;
      }
    } catch {
      /* non-fatal */
    }
    const reranked = await rankCandidates(
      cache.payload,
      enrichedBrief,
      authHeader,
      reRankIntent,
    );
    cache.ranked = reranked;
    cache.cursor = 0;
    cache.negative_reasons = reasons;
    await patchCacheRow(
      deal_id,
      { ranked: reranked, cursor: 0, negative_reasons: reasons },
      authHeader,
    );
    return jsonResponse({ ...buildBatch(cache, BATCH_SIZE), bench_note: null });
  }

  return jsonResponse({ error: `Unknown action: ${action}` }, 400);
});
