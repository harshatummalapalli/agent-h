// search-crustdata-filters — manual filter-based Crustdata person search + autocomplete.
//
// Powers the "Build search" standalone page. Two modes:
//
// MODE: search (default)
//   Body: { filter_draft: FilterDraft, deal_id?: string, limit?: number }
//   Response: { candidates, compiled_filters, applied_groups, total_count }
//   Accepts the full expanded FilterDraft from crustdataFilterCompiler.
//
// MODE: autocomplete
//   Body: { mode: "autocomplete", field: string, query: string, limit?: number }
//   Response: { suggestions: string[] }
//   Calls POST https://api.crustdata.com/person/search/autocomplete.
//   field must be one of AUTOCOMPLETE_SUPPORTED_FIELDS (allowlist enforced).
//
// Both modes:
//   - Require a valid Supabase JWT (same auth pattern as calibration-session).
//   - Do NOT read or write role_discovery_cache.
//   - Do NOT interact with the Talent Bench.
//   - Do NOT modify deal.role_brief_search_intent.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";
import {
  compileFilterDraft,
  relaxFilterDraft,
  type FilterDraft,
  type CrustdataFilters,
} from "../_shared/crustdataFilterCompiler.ts";
import {
  normalizeCrustdataProfile,
  type RawCalibrationCandidate,
  CRUSTDATA_SEARCH_URL,
  CRUSTDATA_API_VERSION,
} from "../_shared/crustdataClient.ts";
import {
  CRUSTDATA_AUTOCOMPLETE_URL,
  AUTOCOMPLETE_SUPPORTED_FIELDS,
} from "../_shared/crustdataCapabilityManifest.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);
const CRUSTDATA_API_KEY = Deno.env.get("CRUSTDATA_API_KEY");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const AUTOCOMPLETE_MAX_LIMIT = 20;

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

async function requireAuth(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;
  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer" || !token) return false;
  try {
    await jose.jwtVerify(token, SUPABASE_JWT_KEYS, {
      issuer: SUPABASE_JWT_ISSUER,
    });
    return true;
  } catch {
    return false;
  }
}

// ── Autocomplete handler ───────────────────────────────────────────────────────

const ALLOWED_AUTOCOMPLETE_FIELDS: ReadonlySet<string> = new Set(
  AUTOCOMPLETE_SUPPORTED_FIELDS as unknown as string[],
);

async function handleAutocomplete(body: {
  field: string;
  query: string;
  limit?: number;
}): Promise<Response> {
  const { field, query, limit: rawLimit } = body;

  if (!field || typeof field !== "string") {
    return jsonResponse({ error: "field is required" }, 400);
  }
  if (typeof query !== "string") {
    return jsonResponse({ error: "query must be a string" }, 400);
  }
  if (!ALLOWED_AUTOCOMPLETE_FIELDS.has(field)) {
    // Unknown field — return empty suggestions rather than exposing server-side error.
    return jsonResponse({ suggestions: [] });
  }

  const limit = Math.min(
    Math.max(
      1,
      typeof rawLimit === "number" ? rawLimit : AUTOCOMPLETE_MAX_LIMIT,
    ),
    AUTOCOMPLETE_MAX_LIMIT,
  );

  try {
    const res = await fetch(CRUSTDATA_AUTOCOMPLETE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CRUSTDATA_API_KEY}`,
        "x-api-version": CRUSTDATA_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ field, query, limit }),
      signal: AbortSignal.timeout(2000),
    });

    if (!res.ok) {
      console.error(
        `[search-crustdata-filters/autocomplete] HTTP ${res.status} for field=${field}`,
      );
      return jsonResponse({ suggestions: [] });
    }

    const data = (await res.json()) as {
      suggestions?: Array<{ value: string }>;
    };
    const suggestions = (data.suggestions ?? []).map((s) => s.value);
    return jsonResponse({ suggestions });
  } catch (err) {
    console.error("[search-crustdata-filters/autocomplete] error:", err);
    return jsonResponse({ suggestions: [] });
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authed = await requireAuth(req);
  if (!authed) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  if (!CRUSTDATA_API_KEY) {
    return jsonResponse(
      { error: "Search is not configured on this server." },
      503,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  // ── Autocomplete mode ────────────────────────────────────────────────────
  if (body.mode === "autocomplete") {
    return handleAutocomplete(
      body as { field: string; query: string; limit?: number },
    );
  }

  // ── Search mode (default) ────────────────────────────────────────────────
  const filterDraft = body.filter_draft as FilterDraft | undefined;
  const rawLimit = body.limit as number | undefined;
  // Opt out of auto-relax when the UI wants a strict pass first.
  const allowRelax = body.relax !== false;

  if (!filterDraft || typeof filterDraft !== "object") {
    return jsonResponse({ error: "filter_draft is required" }, 400);
  }

  const limit = Math.min(
    Math.max(1, typeof rawLimit === "number" ? rawLimit : DEFAULT_LIMIT),
    MAX_LIMIT,
  );

  const cursor = typeof body.cursor === "string" ? body.cursor : undefined;

  type CrustOk = {
    profiles?: Array<Record<string, unknown>>;
    total_count?: number;
    next_cursor?: string;
  };
  type CrustErr = { error: string; detail?: string; httpStatus: number | null };

  async function callCrustdata(
    filters: CrustdataFilters,
    sorts?: Array<{ field: string; order: "asc" | "desc" }>,
  ): Promise<CrustOk | CrustErr> {
    try {
      const body: Record<string, unknown> = {
        filters,
        limit,
        fields: [
          "basic_profile",
          "education",
          "experience",
          "social_handles",
          "professional_network",
        ],
      };
      if (cursor) body.cursor = cursor;
      if (sorts && sorts.length > 0) body.sorts = sorts;

      const res = await fetch(CRUSTDATA_SEARCH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CRUSTDATA_API_KEY}`,
          "x-api-version": CRUSTDATA_API_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        let bodySnippet = "";
        try {
          bodySnippet = (await res.text()).slice(0, 500);
        } catch {
          /* ignore */
        }
        console.error(
          `[search-crustdata-filters] HTTP ${res.status}:`,
          bodySnippet || "(no body)",
        );
        return {
          error: `Crustdata returned HTTP ${res.status}`,
          detail: bodySnippet || undefined,
          httpStatus: res.status,
        };
      }

      const json = (await res.json()) as CrustOk;
      return json;
    } catch (err) {
      console.error("[search-crustdata-filters] fetch error:", err);
      return { error: String(err), httpStatus: null };
    }
  }

  // Progressive search: try draft as-is, then relax constraints until we
  // get profiles (same ladder philosophy as calibration's title+country retry).
  let workingDraft: FilterDraft = filterDraft;
  const dropped: string[] = [];
  let lastFilters: CrustdataFilters | null = null;
  let lastApplied: string[] = [];
  let lastHttpStatus: number | null = null;
  let profiles: Array<Record<string, unknown>> = [];
  let totalCount = 0;
  let nextCursor: string | undefined;
  let lastError: CrustErr | null = null;

  const MAX_RELAX_STEPS = 8;
  for (let step = 0; step <= MAX_RELAX_STEPS; step++) {
    const { filters, appliedGroups, sorts } = compileFilterDraft(workingDraft);
    if (!filters) {
      return jsonResponse({
        candidates: [],
        compiled_filters: null,
        applied_groups: [],
        total_count: 0,
        note: "No filters provided — please fill in at least one filter field.",
        relaxed_away: dropped,
      });
    }

    lastFilters = filters;
    lastApplied = appliedGroups;

    const result = await callCrustdata(filters, sorts);
    if ("error" in result) {
      lastError = result;
      lastHttpStatus = result.httpStatus;
      // Don't relax through provider errors — surface them.
      break;
    }

    profiles = result.profiles ?? [];
    totalCount = result.total_count ?? profiles.length;
    nextCursor = result.next_cursor;
    lastError = null;

    if (profiles.length > 0) break;
    if (!allowRelax) break;

    const next = relaxFilterDraft(workingDraft);
    if (!next) break;
    dropped.push(next.dropped);
    workingDraft = next.draft;
    console.warn(
      `[search-crustdata-filters] 0 results — relaxing: ${next.dropped}`,
    );
  }

  if (lastError) {
    return jsonResponse(
      {
        candidates: [],
        compiled_filters: lastFilters,
        applied_groups: lastApplied,
        total_count: 0,
        crustdata_http_status: lastHttpStatus,
        note: "Search provider returned an error — check compiled filters and try fewer constraints.",
        error: lastError.error,
        error_detail: lastError.detail,
        relaxed_away: dropped,
      },
      200,
    );
  }

  const candidates: RawCalibrationCandidate[] = profiles.map(
    normalizeCrustdataProfile,
  );

  let note: string | undefined;
  if (candidates.length === 0) {
    note =
      "Crustdata returned 0 profiles even after relaxing constraints. Try broader titles or a different country.";
  } else if (dropped.length > 0) {
    note = `Your exact filters returned 0 — showing results after dropping: ${dropped.join(", ")}.`;
  }

  return jsonResponse({
    candidates,
    compiled_filters: lastFilters,
    applied_groups: lastApplied,
    total_count: totalCount || candidates.length,
    crustdata_http_status: lastHttpStatus,
    relaxed_away: dropped,
    note,
    ...(nextCursor ? { next_cursor: nextCursor } : {}),
  });
});
