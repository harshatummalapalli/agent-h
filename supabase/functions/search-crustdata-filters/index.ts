// search-crustdata-filters — manual filter-based Crustdata person search.
//
// Powers the "Build search" tab in RoleWorkspacePage. Accepts a typed
// FilterDraft from the UI (explicit form fields), compiles it to a
// Crustdata boolean filter tree, and returns normalized candidate profiles.
//
// Deliberately ISOLATED from the calibration loop:
//   • Does NOT read or write role_discovery_cache.
//   • Does NOT interact with the Talent Bench.
//   • Does NOT modify deal.role_brief_search_intent.
// Results stay local to this request — caller decides what to do with them.
//
// Auth: requires a valid Supabase JWT (same pattern as calibration-session).
// Body: { filter_draft: FilterDraft, deal_id?: string, limit?: number }
// Response: { candidates, compiled_filters, applied_groups, total_count }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";
import {
  compileFilterDraft,
  type FilterDraft,
} from "../_shared/crustdataFilterCompiler.ts";
import {
  normalizeCrustdataProfile,
  type RawCalibrationCandidate,
  CRUSTDATA_SEARCH_URL,
  CRUSTDATA_API_VERSION,
} from "../_shared/crustdataClient.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);
const CRUSTDATA_API_KEY = Deno.env.get("CRUSTDATA_API_KEY");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

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

  let body: {
    filter_draft?: FilterDraft;
    deal_id?: string;
    limit?: number;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { filter_draft: filterDraft, limit: rawLimit } = body;

  if (!filterDraft || typeof filterDraft !== "object") {
    return jsonResponse({ error: "filter_draft is required" }, 400);
  }

  // Compile UI draft → Crustdata filter tree.
  const { filters, appliedGroups } = compileFilterDraft(filterDraft);

  if (!filters) {
    return jsonResponse({
      candidates: [],
      compiled_filters: null,
      applied_groups: [],
      total_count: 0,
      note: "No filters provided — please fill in at least one filter field.",
    });
  }

  const limit = Math.min(
    Math.max(1, typeof rawLimit === "number" ? rawLimit : DEFAULT_LIMIT),
    MAX_LIMIT,
  );

  // Call Crustdata person search.
  let crustdataResponse:
    | { profiles?: Array<Record<string, unknown>>; total_count?: number }
    | { error: string };
  try {
    const res = await fetch(CRUSTDATA_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CRUSTDATA_API_KEY}`,
        "x-api-version": CRUSTDATA_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filters, limit }),
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
      crustdataResponse = { error: `Crustdata returned HTTP ${res.status}` };
    } else {
      crustdataResponse = (await res.json()) as {
        profiles?: Array<Record<string, unknown>>;
        total_count?: number;
      };
    }
  } catch (err) {
    console.error("[search-crustdata-filters] fetch error:", err);
    crustdataResponse = { error: String(err) };
  }

  if ("error" in crustdataResponse) {
    return jsonResponse(
      {
        candidates: [],
        compiled_filters: filters,
        applied_groups: appliedGroups,
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
    total_count: crustdataResponse.total_count ?? candidates.length,
  });
});
