// Agent H Stage 3, checkpoint 3d: GitHub + Stack Overflow dev-signal
// enrichment (task #28, per the PRD's build order and the sourcing-engine
// architecture doc's "SeekOut: niche technical enrichment depth" line
// item, logged there as "deferred, not forgotten").
//
// Directory note (2026-07-25): this folder was recreated as a real directory
// (replacing a OneDrive junction that broke Supabase bundler/deploy on
// Windows — same fix as save-sourced-candidate). See ADR-unipile Phase 0.
//
// Scope, same manual/on-demand discipline as enrich-candidate-contact:
// runs only when a recruiter explicitly clicks "Enrich dev signals" on one
// specific already-saved candidate. Nothing here fires automatically on
// save or on a discovery hit.
//
// Honest limitation, worth stating up front rather than discovering later:
// neither GitHub's nor Stack Exchange's public search API supports a
// reliable "find this exact real-world person" lookup -- both are
// name-text search over self-reported profile fields, and plenty of real
// developers never set a display name, company, or location on either
// platform at all. This function does NOT claim high-confidence identity
// resolution. It runs a best-effort name search, applies a light
// corroboration check (does the profile's self-reported company loosely
// match the candidate's current employer, if both are known) to separate
// a more-likely match from a pure coincidence, and is explicit in its
// response about which kind of match (if any) it found -- never silently
// attaches a profile the way a false positive here could actively mislead
// a recruiter. Ambiguous results (multiple plausible name matches with no
// corroborating signal to break the tie) are treated as not_found rather
// than guessed.
//
// GitHub Search Users API (docs.github.com/en/rest/search/search,
// confirmed directly): GET /search/users?q=<query>+in:name. Unauthenticated
// rate limit is low (10 req/min); a GITHUB_TOKEN (classic PAT, no scopes
// needed for public search) raises this to 30 req/min and is required in
// practice for anything beyond isolated manual testing.
//
// Stack Exchange API (api.stackexchange.com/docs/users, confirmed
// directly): GET /2.3/users?inname=<query>&site=stackoverflow. The `key`
// parameter (a free Stack Apps registration, not a full OAuth token) raises
// the daily quota from 300 to 10,000 requests -- genuinely free, just a
// registration step, per Stack Exchange's own docs.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");
const GITHUB_SEARCH_URL = "https://api.github.com/search/users";
const GITHUB_USER_URL = "https://api.github.com/users";

const STACK_EXCHANGE_API_KEY = Deno.env.get("STACK_EXCHANGE_API_KEY");
const STACK_EXCHANGE_USERS_URL = "https://api.stackexchange.com/2.3/users";

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
    await jose.jwtVerify(token, SUPABASE_JWT_KEYS, {
      issuer: SUPABASE_JWT_ISSUER,
    });
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
  first_name: string | null;
  last_name: string | null;
  current_company_id: number | null;
  source_raw: Record<string, unknown> | null;
};

async function fetchCandidate(
  candidateId: number,
  authHeader: string,
): Promise<CandidateRow | null> {
  const response = await restFetch(
    `candidates?id=eq.${candidateId}&select=id,first_name,last_name,current_company_id,source_raw`,
    authHeader,
  );
  if (!response.ok) return null;
  const rows = await response.json();
  return rows?.[0] ?? null;
}

async function fetchCompanyName(
  companyId: number | null,
  authHeader: string,
): Promise<string | null> {
  if (!companyId) return null;
  const response = await restFetch(
    `companies?id=eq.${companyId}&select=name`,
    authHeader,
  );
  if (!response.ok) return null;
  const rows = await response.json();
  return rows?.[0]?.name ?? null;
}

// Loose, case-insensitive "does one contain a meaningful chunk of the
// other" check -- deliberately not exact-match, since "Acme Inc." vs
// "Acme" vs "ACME, Inc" are all the same real employer written differently
// across platforms. Deliberately not a fuzzy edit-distance match either --
// that would risk false positives (matching two different companies with
// similar short names), which is worse than a missed corroboration here.
function looselyMatches(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const na = normalize(a);
  const nb = normalize(b);
  if (na.length < 3 || nb.length < 3) return false;
  return na.includes(nb) || nb.includes(na);
}

type DevSignalMatch = {
  platform: "github" | "stackoverflow";
  url: string;
  raw: unknown;
  corroborated: boolean; // true if a second signal (company) also matched
};

// GitHub: search by "First Last" in:name, fetch full profiles for the top
// few hits, keep only those whose profile `name` field case-insensitively
// equals the candidate's full name (not just contains it -- GitHub's search
// already does fuzzy matching server-side, so the client-side filter here
// is deliberately strict to avoid compounding two layers of fuzziness).
// If more than one strict-name match remains and none is corroborated by
// company, that's an unresolvable ambiguity -- returns null rather than
// picking one arbitrarily.
async function searchGithub(
  candidate: CandidateRow,
  companyName: string | null,
): Promise<DevSignalMatch | null> {
  if (!candidate.first_name || !candidate.last_name) return null;
  const fullName = `${candidate.first_name} ${candidate.last_name}`.trim();

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

  const searchUrl = `${GITHUB_SEARCH_URL}?q=${encodeURIComponent(`${fullName} in:name`)}&per_page=5`;
  const searchResponse = await fetch(searchUrl, { headers });
  if (!searchResponse.ok) {
    const body = await searchResponse.text();
    throw new Error(
      `GitHub search API error (${searchResponse.status}): ${body}`,
    );
  }
  const searchResult = await searchResponse.json();
  const candidates: Array<{ login: string }> = searchResult?.items ?? [];
  if (candidates.length === 0) return null;

  const strictMatches: Array<{
    login: string;
    profile: any;
    corroborated: boolean;
  }> = [];
  for (const item of candidates.slice(0, 5)) {
    const profileResponse = await fetch(`${GITHUB_USER_URL}/${item.login}`, {
      headers,
    });
    if (!profileResponse.ok) continue;
    const profile = await profileResponse.json();
    const profileName: string | null = profile?.name ?? null;
    if (
      !profileName ||
      profileName.trim().toLowerCase() !== fullName.toLowerCase()
    )
      continue;
    const corroborated = looselyMatches(profile?.company, companyName);
    strictMatches.push({ login: item.login, profile, corroborated });
  }

  if (strictMatches.length === 0) return null;

  // Prefer a corroborated match if any exists among the strict-name
  // matches; otherwise only accept if there's exactly one strict match at
  // all (no way to disambiguate two same-named, same-unconfirmed people).
  const corroboratedMatch = strictMatches.find((m) => m.corroborated);
  const chosen =
    corroboratedMatch ?? (strictMatches.length === 1 ? strictMatches[0] : null);
  if (!chosen) return null;

  return {
    platform: "github",
    url: chosen.profile.html_url,
    raw: chosen.profile,
    corroborated: chosen.corroborated,
  };
}

// Stack Exchange: same strict-name-match-then-corroborate approach as
// GitHub above, applied to the `inname` partial-text search Stack
// Exchange's API actually supports (there's no exact-name query parameter
// on their public API).
async function searchStackOverflow(
  candidate: CandidateRow,
  companyName: string | null,
): Promise<DevSignalMatch | null> {
  if (!candidate.first_name || !candidate.last_name) return null;
  const fullName = `${candidate.first_name} ${candidate.last_name}`.trim();

  const params = new URLSearchParams({
    order: "desc",
    sort: "reputation",
    inname: fullName,
    site: "stackoverflow",
  });
  if (STACK_EXCHANGE_API_KEY) params.set("key", STACK_EXCHANGE_API_KEY);

  const response = await fetch(
    `${STACK_EXCHANGE_USERS_URL}?${params.toString()}`,
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Stack Exchange API error (${response.status}): ${body}`);
  }
  const result = await response.json();
  const items: Array<{
    display_name: string;
    link: string;
    about_me?: string;
  }> = result?.items ?? [];
  if (items.length === 0) return null;

  const strictMatches = items.filter(
    (u) => u.display_name?.trim().toLowerCase() === fullName.toLowerCase(),
  );
  if (strictMatches.length === 0) return null;

  // Stack Overflow profiles don't have a structured "company" field on
  // this endpoint (it's buried in free-text about_me at best), so
  // corroboration here is weaker than GitHub's -- a loose substring check
  // against about_me text, best-effort only.
  const corroboratedMatch = strictMatches.find((u) =>
    looselyMatches(u.about_me, companyName),
  );
  const chosen =
    corroboratedMatch ?? (strictMatches.length === 1 ? strictMatches[0] : null);
  if (!chosen) return null;

  return {
    platform: "stackoverflow",
    url: chosen.link,
    raw: chosen,
    corroborated: Boolean(corroboratedMatch),
  };
}

const enrichCandidateDevsignals = async (req: Request) => {
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
    return jsonResponse(
      { error: "Candidate not found (or you don't have access to it)" },
      404,
    );
  }

  const notes: string[] = [
    "Dev-signal matching is name-based, best-effort identity resolution -- not a guaranteed-correct link. See the GitHub/Stack Overflow profile links yourself before treating this as confirmed.",
  ];
  let hadFailure = false;

  const companyName = await fetchCompanyName(
    candidate.current_company_id,
    authHeader,
  );

  let github: DevSignalMatch | null = null;
  try {
    github = await searchGithub(candidate, companyName);
  } catch (error) {
    hadFailure = true;
    console.error("GitHub dev-signal search failed (non-fatal)", error);
    notes.push("GitHub search failed -- see server logs.");
  }

  let stackoverflow: DevSignalMatch | null = null;
  try {
    stackoverflow = await searchStackOverflow(candidate, companyName);
  } catch (error) {
    hadFailure = true;
    console.error("Stack Overflow dev-signal search failed (non-fatal)", error);
    notes.push("Stack Overflow search failed -- see server logs.");
  }

  if (github) {
    notes.push(
      github.corroborated
        ? `GitHub match found and corroborated by a matching company field: ${github.url}`
        : `GitHub match found by name only (not corroborated by company) -- verify before trusting: ${github.url}`,
    );
  } else {
    notes.push("No confident GitHub match found.");
  }

  if (stackoverflow) {
    notes.push(
      stackoverflow.corroborated
        ? `Stack Overflow match found and corroborated: ${stackoverflow.url}`
        : `Stack Overflow match found by name only (not corroborated) -- verify before trusting: ${stackoverflow.url}`,
    );
  } else {
    notes.push("No confident Stack Overflow match found.");
  }

  const now = new Date().toISOString();
  const patchBody: Record<string, unknown> = {
    devsignal_enrichment_updated_at: now,
    devsignal_enrichment_status: hadFailure
      ? "failed"
      : github || stackoverflow
        ? "enriched"
        : "not_found",
  };
  if (github) {
    patchBody.github_url = github.url;
    patchBody.github_username = github.url.split("/").pop() ?? null;
    patchBody.github_profile_raw = github.raw;
  }
  if (stackoverflow) {
    patchBody.stackoverflow_url = stackoverflow.url;
    patchBody.stackoverflow_profile_raw = stackoverflow.raw;
  }

  const patchResponse = await restFetch(
    `candidates?id=eq.${candidateId}`,
    authHeader,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patchBody),
    },
  );

  if (!patchResponse.ok) {
    const errorBody = await patchResponse.text();
    console.error(
      "devsignal enrichment PATCH failed",
      patchResponse.status,
      errorBody,
    );
    return jsonResponse(
      { error: "Enrichment ran but failed to save to the candidate record" },
      502,
    );
  }

  return jsonResponse({
    status: patchBody.devsignal_enrichment_status,
    github_url: github?.url ?? null,
    github_corroborated: github?.corroborated ?? null,
    stackoverflow_url: stackoverflow?.url ?? null,
    stackoverflow_corroborated: stackoverflow?.corroborated ?? null,
    notes,
  });
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const authError = await requireAuth(req);
  if (authError) return authError;
  return enrichCandidateDevsignals(req);
});
