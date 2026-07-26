// Calibration Loop B — server-side session manager.
//
// Owns pull-rank-persist and next-batch/rerank against the role_discovery_cache
// table so the ranked pool survives browser refresh, new tabs, and device
// switches without re-burning vendor credits.
//
// Actions (POST body: { action, deal_id, ... }):
//   start      — given already-pulled raw candidates + role brief from the
//                browser, check the Talent Bench first (non-expired cache rows
//                from OTHER deals in the same tenant), merge with vendor
//                candidates, rank via rank-discovery-batch, persist, return
//                the first batch. bench_note is set when bench candidates were
//                found so the recruiter transcript can surface a plain-English note.
//   next_batch — read cursor from DB, advance it, return next slice.
//   rerank     — append a negative reason, re-rank the stored raw payload,
//                reset cursor, persist, return the new top slice.
//
// Auth: requires a valid Supabase JWT (same pattern as source-candidates-*).
// RLS on role_discovery_cache ensures tenant isolation automatically when
// requests ride the user's JWT.
//
// Expired row cleanup: rows with expires_at < now() are excluded from bench
// queries. Physical cleanup can be done with:
//   DELETE FROM role_discovery_cache WHERE expires_at < now();
// (a scheduled pg_cron job or a manual periodic cleanup).
//
// UX copy: never say "cache" to recruiters — say "saved search results" /
// "from recent searches". The bench_note field carries this copy.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";
import { searchCrustdataForRoleBrief } from "../_shared/crustdataClient.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);
const CRUSTDATA_API_KEY = Deno.env.get("CRUSTDATA_API_KEY");

const BATCH_SIZE = 5;
// Pull Crustdata server-side when bench + cheap pool is below this floor.
// BATCH_SIZE * 3 = 15 ensures we have enough for a few calibration batches
// before presenting thinly-sourced results to the recruiter.
const CRUSTDATA_POOL_FLOOR = BATCH_SIZE * 3;

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

type CalibrationCandidate = {
  external_id: string;
  name: string;
  headline: string | null;
  why_fit: string;
  match_score: number | null;
  linkedin_url: string | null;
  from_bench: boolean;
};

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
async function rankCandidates(
  candidates: RawCandidate[],
  roleBrief: Record<string, unknown>,
  authHeader: string,
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

  const slice = orderedIds.slice(cache.cursor, cache.cursor + batchSize);
  const candidates: CalibrationCandidate[] = slice
    .map((id) => {
      const raw = rawById.get(id);
      if (!raw) return null;
      return {
        external_id: id,
        name: raw.full_name ?? `Candidate ${id}`,
        headline:
          [raw.job_title, raw.job_company_name].filter(Boolean).join(" at ") ||
          null,
        why_fit: whyFitById.get(id) ?? "",
        match_score: null,
        linkedin_url: raw.linkedin_url ?? null,
        from_bench: raw._from_bench ?? false,
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

    // Talent Bench: pull non-expired candidates from other deals in tenant.
    const benchCandidates = await fetchBenchCandidates(deal_id, authHeader);

    // Merge bench + cheap (free-portal + Exa) candidates passed by the client,
    // deduping by linkedin_url then id.
    const seen = new Set<string>();
    const merged: RawCandidate[] = [];
    for (const c of [...benchCandidates, ...rawCandidates]) {
      const key = c.linkedin_url || c.id;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(c);
    }

    // Crustdata gate: if bench + cheap pool is thin, call Crustdata server-side.
    // This keeps Crustdata off the client (no key exposure) and off cheap searches
    // where we already have enough candidates for calibration.
    if (merged.length < CRUSTDATA_POOL_FLOOR && CRUSTDATA_API_KEY) {
      const crustdataCandidates = await searchCrustdataForRoleBrief(
        roleBrief,
        // Request enough to fill the gap; cap at 30 to stay within API budget.
        Math.min(CRUSTDATA_POOL_FLOOR - merged.length + 10, 30),
        CRUSTDATA_API_KEY,
      );
      for (const c of crustdataCandidates) {
        const key = c.linkedin_url || c.id;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(c);
      }
    }

    const ranked = await rankCandidates(merged, roleBrief, authHeader);

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

  // ── rerank: add negative reason, re-rank, reset cursor, persist ──
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
    const enrichedBrief = {
      ...cache.role_brief_snapshot,
      avoid_signals: reasons.join("; "),
    };
    const reranked = await rankCandidates(
      cache.payload,
      enrichedBrief,
      authHeader,
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
