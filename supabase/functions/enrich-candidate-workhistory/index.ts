// Agent H Stage 3, full-profile enrichment (task #75, per the PRD's build
// order -- Harsha's explicit call 2026-07-15: before moving to Stage 4
// Screening, Sourcing needs to be able to show a candidate's COMPLETE
// record, not just the plain fields the cheap Search Preview step returns).
//
// Same two-tier discipline as everywhere else in this codebase: discovery
// (source-candidates-discovery) is the cheap, broad step; this function is
// the deliberately-expensive, one-candidate-at-a-time step, fired ONLY when
// a recruiter explicitly clicks "View full profile" on one already-saved
// candidate -- never automatically on every discovery hit or even on every
// save. Same reasoning as enrich-candidate-contact's header comment: a
// candidate someone decided to track isn't automatically one worth a real
// vendor credit yet.
//
// Waterfall, in order:
//   1. Coresignal Collect (docs.coresignal.com, confirmed directly via a
//      live test call 2026-07-15): GET /v2/employee_multi_source/collect/
//      {profile_url}, header `apikey: <key>` (same header Coresignal's
//      search preview uses, not a Bearer token). Costs 2 collect credits
//      per successful call (confirmed against Coresignal's own docs and
//      against the real x-credits-remaining header this session). Takes
//      the candidate's own linkedin_url directly as the profile_url path
//      segment (URL-encoded) -- no need for Coresignal's internal numeric
//      id. Returns a genuinely complete record: full experience array
//      (each entry carries its OWN company_name/industry/size/website --
//      confirmed directly, richer than the published data-dictionary
//      sample implied), education, certifications, courses, languages,
//      skills (up to ~100 inferred skills), salary projections, etc.
//   2. PDL Person Enrichment (docs.peopledatalabs.com), tried only if
//      Coresignal Collect fails or isn't configured. GET /v5/person/enrich
//      ?api_key=<key>&profile=<linkedin_url>. Confirmed directly this
//      session: PDL's Person SEARCH credits can be exhausted independently
//      of Person ENRICHMENT credits (they're a separate quota/product) --
//      so this fallback can still work even when PDL search is dead. Also
//      returns a real, rich record (experience array, education array,
//      skills, etc.) at a comparable depth to Coresignal's.
//
// Both vendor calls are best-effort: a vendor being unconfigured or
// returning no match is not an error. full_profile_status distinguishes
// "enriched" / "not_found" / "failed", same disclosure discipline as
// contact_enrichment_status and devsignal_enrichment_status.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

const CORESIGNAL_API_KEY = Deno.env.get("CORESIGNAL_API_KEY");
const CORESIGNAL_COLLECT_BASE =
  "https://api.coresignal.com/cdapi/v2/employee_multi_source/collect/";

const PDL_API_KEY = Deno.env.get("PDL_API_KEY");
const PDL_ENRICH_URL = "https://api.peopledatalabs.com/v5/person/enrich";

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

async function requireAuth(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing authorization header" }, 401);
  }
  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer" || !token) {
    return jsonResponse({ error: "Invalid authorization header" }, 401);
  }
  try {
    await jose.jwtVerify(token, SUPABASE_JWT_KEYS, { issuer: SUPABASE_JWT_ISSUER });
    return null;
  } catch {
    return jsonResponse({ error: "Unauthorized" }, 401);
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
      ...(init.headers ?? {}),
    },
  });
}

type CandidateRow = {
  id: number;
  linkedin_url: string | null;
  first_name: string | null;
  last_name: string | null;
};

async function fetchCandidate(
  candidateId: number,
  authHeader: string,
): Promise<CandidateRow | null> {
  const response = await restFetch(
    `candidates?id=eq.${candidateId}&select=id,linkedin_url,first_name,last_name`,
    authHeader,
  );
  if (!response.ok) return null;
  const rows = await response.json();
  return rows?.[0] ?? null;
}

type ProfileResult = {
  source: "coresignal_collect" | "pdl_enrich";
  raw: Record<string, unknown>;
  workHistory: Array<Record<string, unknown>>;
};

// Extracts a simple, display-friendly work-history array from either
// vendor's raw response -- best-effort, not a strict schema, since the two
// vendors name fields slightly differently (position_title vs job_title,
// etc.) and the rich profile view reads from the raw blob directly anyway.
function extractWorkHistory(
  experience: unknown,
  fieldMap: { title: string; company: string; dateFrom: string; dateTo: string; duration?: string; description: string },
): Array<Record<string, unknown>> {
  if (!Array.isArray(experience)) return [];
  return experience.map((entry) => {
    const e = entry as Record<string, unknown>;
    return {
      title: e[fieldMap.title] ?? null,
      company: e[fieldMap.company] ?? null,
      date_from: e[fieldMap.dateFrom] ?? null,
      date_to: e[fieldMap.dateTo] ?? null,
      duration_months: fieldMap.duration ? e[fieldMap.duration] ?? null : null,
      description: e[fieldMap.description] ?? null,
    };
  });
}

async function tryCoresignalCollect(candidate: CandidateRow): Promise<ProfileResult | null> {
  if (!CORESIGNAL_API_KEY || !candidate.linkedin_url) return null;

  const url = `${CORESIGNAL_COLLECT_BASE}${encodeURIComponent(candidate.linkedin_url)}`;
  const response = await fetch(url, {
    headers: { accept: "application/json", apikey: CORESIGNAL_API_KEY },
  });

  if (response.status === 404) return null; // Clean "not in Coresignal's collect index" -- not an error.
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Coresignal collect error (${response.status}): ${body}`);
  }

  const raw = await response.json();
  return {
    source: "coresignal_collect",
    raw,
    workHistory: extractWorkHistory(raw.experience, {
      title: "position_title",
      company: "company_name",
      dateFrom: "date_from",
      dateTo: "date_to",
      duration: "duration_months",
      description: "description",
    }),
  };
}

async function tryPdlEnrich(candidate: CandidateRow): Promise<ProfileResult | null> {
  if (!PDL_API_KEY || !candidate.linkedin_url) return null;

  const url = new URL(PDL_ENRICH_URL);
  url.searchParams.set("api_key", PDL_API_KEY);
  url.searchParams.set("profile", candidate.linkedin_url);

  const response = await fetch(url.toString());
  const result = await response.json();

  if (response.status === 404) return null; // Clean "no record" -- not an error.
  if (!response.ok) {
    throw new Error(`PDL enrich error (${response.status}): ${JSON.stringify(result)}`);
  }

  const raw = result?.data;
  if (!raw) return null;

  return {
    source: "pdl_enrich",
    raw,
    workHistory: extractWorkHistory(raw.experience, {
      title: "title", // PDL nests experience[].title as an object ({name: ...}); handled loosely here, full detail lives in raw for the profile view.
      company: "company",
      dateFrom: "start_date",
      dateTo: "end_date",
      description: "summary",
    }),
  };
}

const enrichCandidateWorkHistory = async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  let candidateId: number | undefined;
  try {
    const body = await req.json();
    candidateId = body?.candidate_id;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!candidateId || typeof candidateId !== "number") {
    return jsonResponse({ error: "candidate_id is required" }, 400);
  }

  const authHeader = req.headers.get("authorization")!;
  const candidate = await fetchCandidate(candidateId, authHeader);
  if (!candidate) {
    return jsonResponse({ error: "Candidate not found (or you don't have access to it)" }, 404);
  }

  if (!candidate.linkedin_url) {
    return jsonResponse(
      { error: "This candidate has no LinkedIn URL on file -- full-profile lookup needs one." },
      400,
    );
  }

  if (!CORESIGNAL_API_KEY && !PDL_API_KEY) {
    return jsonResponse(
      {
        error:
          "No full-profile vendor is configured for this project. Add CORESIGNAL_API_KEY and/or PDL_API_KEY under Project Settings > Edge Functions > Secrets.",
      },
      400,
    );
  }

  const notes: string[] = [];
  let result: ProfileResult | null = null;
  let hadFailure = false;

  try {
    result = await tryCoresignalCollect(candidate);
    if (!result) notes.push("Coresignal has no collect-able record for this profile URL.");
  } catch (error) {
    hadFailure = true;
    console.error("Coresignal collect failed (non-fatal, trying PDL next)", error);
    notes.push(
      `Coresignal collect failed: ${error instanceof Error ? error.message : String(error)}. Falling through to PDL.`,
    );
  }

  if (!result) {
    try {
      result = await tryPdlEnrich(candidate);
      if (!result) notes.push("PDL has no enrichment record for this profile URL either.");
    } catch (error) {
      hadFailure = true;
      console.error("PDL enrich failed (non-fatal)", error);
      notes.push(`PDL enrich failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const now = new Date().toISOString();
  const patchBody: Record<string, unknown> = { full_profile_updated_at: now };

  if (result) {
    patchBody.full_profile_status = "enriched";
    patchBody.full_profile_source = result.source;
    patchBody.full_profile_raw = result.raw;
    patchBody.work_history = result.workHistory;
  } else {
    patchBody.full_profile_status = hadFailure ? "failed" : "not_found";
  }

  const patchResponse = await restFetch(`candidates?id=eq.${candidateId}`, authHeader, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patchBody),
  });

  if (!patchResponse.ok) {
    const errorBody = await patchResponse.text();
    console.error("full-profile enrichment PATCH failed", patchResponse.status, errorBody);
    return jsonResponse({ error: "Enrichment ran but failed to save to the candidate record" }, 502);
  }

  return jsonResponse({
    status: patchBody.full_profile_status,
    source: result?.source ?? null,
    experience_count: result?.workHistory.length ?? 0,
    education_count: Array.isArray((result?.raw as Record<string, unknown> | undefined)?.education)
      ? ((result!.raw as Record<string, unknown>).education as unknown[]).length
      : 0,
    notes,
  });
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const authError = await requireAuth(req);
  if (authError) return authError;
  return enrichCandidateWorkHistory(req);
});
