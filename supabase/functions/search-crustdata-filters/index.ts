// search-crustdata-filters — manual filter-based Crustdata person search + autocomplete.
//
// Powers the "Build search" standalone page. Two modes:
//
// MODE: search (default)
//   Body: { conditions: SearchIntentCondition[], deal_id?: string, limit?: number }
//   Response: { candidates, compiled_filters, applied_groups, total_count, unenforceable }
//   Compiles conditions via validateAndAssembleIntent (single canonical compiler).
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
import { validateAndAssembleIntent } from "../_shared/crustdataIntentValidator.ts";
import { makeInitialIntent } from "../_shared/searchIntent.ts";
import type { SearchIntentCondition } from "../_shared/searchIntent.ts";
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
  const conditions = body.conditions as SearchIntentCondition[] | undefined;
  const rawLimit = body.limit as number | undefined;

  if (!Array.isArray(conditions)) {
    return jsonResponse({ error: "conditions (array) is required" }, 400);
  }

  // Compile SearchIntentCondition[] → Crustdata filter tree via the single
  // canonical compiler (validateAndAssembleIntent). This is the only compiler.
  const intent = makeInitialIntent(conditions, []);
  const { filters, unenforceable } = validateAndAssembleIntent(intent);

  // Derive applied_groups from the filter conditions for the UI summary.
  const appliedGroups: string[] = filters
    ? [
        "conditions: " +
          conditions.filter((c) => c.disposition !== "prefer").length,
      ]
    : [];

  if (!filters) {
    return jsonResponse({
      candidates: [],
      compiled_filters: null,
      applied_groups: [],
      unenforceable,
      total_count: 0,
      note: "No enforceable filters — all conditions were unenforceable or prefer-only. Check unenforceable list.",
    });
  }

  const limit = Math.min(
    Math.max(1, typeof rawLimit === "number" ? rawLimit : DEFAULT_LIMIT),
    MAX_LIMIT,
  );

  // ── Relaxation allowlist (spec §4.3) ──────────────────────────────────────
  //
  // If the first search returns < RELAX_FLOOR candidates, automatically relax
  // ONE allowlisted condition and retry, disclosing what was relaxed. Never
  // relax skill/require (hard requirements), company excludes, or location.
  // Allowlist: experience_range, headcount_range, connections_min.
  const RELAX_FLOOR = 5;
  const RELAXABLE_CATEGORIES = new Set([
    "experience_range",
    "headcount_range",
    "connections_min",
  ]);

  type SearchResult =
    | { profiles?: Array<Record<string, unknown>>; total_count?: number }
    | { error: string };

  async function callCrustdata(
    filterTree: typeof filters,
  ): Promise<SearchResult> {
    try {
      const res = await fetch(CRUSTDATA_SEARCH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CRUSTDATA_API_KEY}`,
          "x-api-version": CRUSTDATA_API_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filters: filterTree, limit }),
      });
      if (!res.ok) {
        let bodySnippet = "";
        try {
          bodySnippet = (await res.text()).slice(0, 300);
        } catch {
          /* ignore */
        }
        console.error(
          `[search-crustdata-filters] HTTP ${res.status}:`,
          bodySnippet,
        );
        return { error: `Crustdata returned HTTP ${res.status}` };
      }
      return (await res.json()) as {
        profiles?: Array<Record<string, unknown>>;
        total_count?: number;
      };
    } catch (err) {
      console.error("[search-crustdata-filters] fetch error:", err);
      return { error: String(err) };
    }
  }

  let crustdataResponse = await callCrustdata(filters);
  let relaxedNote: string | undefined;

  // Relaxation pass: if thin result, remove one relaxable condition and retry.
  if (
    !("error" in crustdataResponse) &&
    (crustdataResponse.profiles?.length ?? 0) < RELAX_FLOOR
  ) {
    const relaxableCondition = conditions.find(
      (c) =>
        c.disposition === "require" && RELAXABLE_CATEGORIES.has(c.category),
    );
    if (relaxableCondition) {
      const relaxedConditions = conditions.filter(
        (c) => c !== relaxableCondition,
      );
      const relaxedIntent = makeInitialIntent(relaxedConditions, []);
      const { filters: relaxedFilters } =
        validateAndAssembleIntent(relaxedIntent);
      if (relaxedFilters) {
        const relaxedResponse = await callCrustdata(relaxedFilters);
        if (
          !("error" in relaxedResponse) &&
          (relaxedResponse.profiles?.length ?? 0) > 0
        ) {
          crustdataResponse = relaxedResponse;
          const categoryLabel: Record<string, string> = {
            experience_range: "years of experience",
            headcount_range: "company headcount",
            connections_min: "LinkedIn connections minimum",
          };
          relaxedNote = `Relaxed ${categoryLabel[relaxableCondition.category] ?? relaxableCondition.category} filter (was: "${relaxableCondition.value}") — search returned fewer than ${RELAX_FLOOR} candidates without it.`;
        }
      }
    }
  }

  if ("error" in crustdataResponse) {
    return jsonResponse(
      {
        candidates: [],
        compiled_filters: filters,
        applied_groups: appliedGroups,
        unenforceable,
        total_count: 0,
        note: "Search returned an error — credits are not consumed on errors.",
        error: crustdataResponse.error,
      },
      502,
    );
  }

  const profiles = crustdataResponse.profiles ?? [];
  const candidates: RawCalibrationCandidate[] = profiles.map(
    normalizeCrustdataProfile,
  );

  return jsonResponse({
    candidates,
    compiled_filters: filters,
    applied_groups: appliedGroups,
    unenforceable,
    total_count: crustdataResponse.total_count ?? candidates.length,
    ...(relaxedNote ? { relaxed_note: relaxedNote } : {}),
  });
});
