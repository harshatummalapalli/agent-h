// Agent H Stage 3, checkpoint 3d-adjacent: Hunter.io -> Apollo.io contact-
// enrichment waterfall (task #27, per the PRD's build order and the
// sourcing-engine architecture doc's "Enrichment waterfall" section).
//
// Scope, deliberately narrow, same discipline as save-sourced-candidate:
// this function runs ONLY when a recruiter explicitly clicks "Enrich
// contact" on one specific ALREADY-SAVED candidate (a public.candidates
// row) -- never automatically on every discovery hit or even on every
// save. Harsha's explicit call (2026-07-11 session): a candidate someone
// decided to track isn't necessarily one worth spending a Hunter/Apollo
// credit on yet -- that's a second, separate decision a recruiter makes
// deliberately, same "an unreviewed hit isn't the same as a candidate
// someone decided to track" principle already applied to "Add to
// pipeline" itself.
//
// Why this matters more now than when the architecture doc was written:
// the doc's cost audit assumed "PDL's own results already include email at
// current volume" and treated Hunter/Apollo as not-yet-needed. That's no
// longer true -- Coresignal (the sole active discovery provider as of this
// session, see source-candidates-discovery/index.ts's DISCOVERY_PROVIDERS)
// has NO contact data in its Search Preview response at all (confirmed:
// normalizeCoresignalCandidate never sets an "emails" field), so every
// Coresignal-sourced candidate saved so far has a null email_jsonb. This
// waterfall is what actually makes those candidates contactable.
//
// The waterfall, in order:
//   1. Hunter.io Email Finder (docs.hunter.io/api-reference/email-finder,
//      confirmed directly): GET /v2/email-finder?domain=<domain>&
//      first_name=<first>&last_name=<last>&api_key=<key>. Needs a company
//      DOMAIN, not just a name -- resolved from the candidate's linked
//      companies.website. Returns a confidence score (0-100); Hunter's own
//      docs describe this as a real deliverability confidence signal, not
//      a binary found/not-found, so a low-confidence hit is disclosed via
//      contact_enrichment_raw rather than silently trusted the same as a
//      high-confidence one.
//   2. Apollo people/match (docs.apollo.io, same endpoint family as the
//      bulk_match call already proven working in source-candidates-
//      discovery's apolloProvider), tried only if Hunter found nothing or
//      isn't configured. Matched by linkedin_url when available (Apollo's
//      most precise identifier) or by name + organization_name otherwise.
//      reveal_personal_emails: true is a real, synchronous email reveal.
//      Phone reveal is deliberately NOT attempted here -- Apollo's phone
//      reveal is asynchronous via webhook (confirmed in their docs), a
//      genuinely different integration shape than this on-demand,
//      request/response function supports; a phone number found this way
//      would need a follow-up webhook receiver, which is out of scope for
//      this checkpoint. Disclosed via a note, not silently absent.
//
// Both vendor calls are genuinely optional/best-effort in the sense that a
// vendor being unconfigured (no API key) or returning nothing is not an
// error -- contact_enrichment_status distinguishes "enriched" / "not_found"
// / "failed" so the recruiter (and any future automation) can tell a clean
// "nobody has this" apart from a real problem worth retrying.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

// Reuses the same APOLLO_API_KEY secret source-candidates-discovery already
// uses for People Search -- Apollo's docs confirm the same API key works
// across their endpoint families (search, bulk_match, match all sit under
// one account/key), so no separate secret is needed for enrichment.
const HUNTER_API_KEY = Deno.env.get("HUNTER_API_KEY");
const HUNTER_EMAIL_FINDER_URL = "https://api.hunter.io/v2/email-finder";

const APOLLO_API_KEY = Deno.env.get("APOLLO_API_KEY");
const APOLLO_MATCH_URL = "https://api.apollo.io/api/v1/people/match";

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
  linkedin_url: string | null;
  current_company_id: number | null;
};

// Fetches the candidate row through PostgREST using the CALLER's own JWT,
// same RLS-riding pattern as every other function in this codebase -- a
// recruiter can only enrich a candidate their tenant can already see.
async function fetchCandidate(
  candidateId: number,
  authHeader: string,
): Promise<CandidateRow | null> {
  const response = await restFetch(
    `candidates?id=eq.${candidateId}&select=id,first_name,last_name,linkedin_url,current_company_id`,
    authHeader,
  );
  if (!response.ok) return null;
  const rows = await response.json();
  return rows?.[0] ?? null;
}

// Domain resolution: Hunter's Email Finder needs a real company domain, not
// a company name -- companies.website already exists on the linked company
// (populated when save-sourced-candidate's findOrCreateCompany created it,
// though currently that only sets `name`, so website is often still null;
// this function handles that gracefully by skipping Hunter rather than
// guessing a domain from the company name).
async function fetchCompanyDomain(
  companyId: number | null,
  authHeader: string,
): Promise<string | null> {
  if (!companyId) return null;
  const response = await restFetch(
    `companies?id=eq.${companyId}&select=website`,
    authHeader,
  );
  if (!response.ok) return null;
  const rows = await response.json();
  const website: string | null = rows?.[0]?.website ?? null;
  if (!website) return null;
  // companies.website may be a full URL ("https://acme.com/about") or a
  // bare domain -- normalize to just the hostname, which is what Hunter's
  // `domain` parameter expects.
  try {
    const withScheme = website.startsWith("http") ? website : `https://${website}`;
    return new URL(withScheme).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

type EnrichmentResult = {
  source: "hunter" | "apollo";
  email: string | null;
  phone: string | null;
  raw: unknown;
  notes: string[];
};

// Hunter.io Email Finder -- confirmed API shape directly against Hunter's
// docs before writing this: response is { data: { email, score, ... },
// meta }. A null `data.email` (or a non-2xx response) means "no match,"
// not a hard failure -- Hunter returns 2xx with a null email for a
// genuinely unknown person at a known domain.
async function tryHunter(
  candidate: CandidateRow,
  domain: string,
): Promise<EnrichmentResult | null> {
  if (!HUNTER_API_KEY) return null;
  if (!candidate.first_name || !candidate.last_name) return null;

  const url =
    `${HUNTER_EMAIL_FINDER_URL}?domain=${encodeURIComponent(domain)}` +
    `&first_name=${encodeURIComponent(candidate.first_name)}` +
    `&last_name=${encodeURIComponent(candidate.last_name)}` +
    `&api_key=${encodeURIComponent(HUNTER_API_KEY)}`;

  const response = await fetch(url);
  const result = await response.json();

  if (!response.ok) {
    // A real Hunter API error (bad key, rate limit, etc.) -- distinct from
    // a clean "no email found," which Hunter reports differently (see
    // below). Thrown so the caller can record contact_enrichment_status =
    // "failed" for this vendor rather than silently treating it the same
    // as "not_found."
    throw new Error(`Hunter API error (${response.status}): ${JSON.stringify(result)}`);
  }

  const email: string | null = result?.data?.email ?? null;
  if (!email) return null;

  const score: number | null = typeof result?.data?.score === "number" ? result.data.score : null;
  return {
    source: "hunter",
    email,
    phone: null, // Hunter's Email Finder doesn't return phone numbers.
    raw: result,
    notes:
      score !== null
        ? [`Hunter's own confidence score for this email: ${score}/100.`]
        : [],
  };
}

// Apollo people/match -- same endpoint family as the bulk_match call
// already proven working in source-candidates-discovery's apolloProvider.
// Matched by linkedin_url when available (Apollo's own docs describe this
// as their most precise single-identifier match), falling back to name +
// organization_name only as a looser secondary attempt.
async function tryApollo(
  candidate: CandidateRow,
  companyName: string | null,
): Promise<EnrichmentResult | null> {
  if (!APOLLO_API_KEY) return null;

  const body: Record<string, unknown> = { reveal_personal_emails: true };
  if (candidate.linkedin_url) {
    body.linkedin_url = candidate.linkedin_url;
  } else if (candidate.first_name && candidate.last_name) {
    body.first_name = candidate.first_name;
    body.last_name = candidate.last_name;
    if (companyName) body.organization_name = companyName;
  } else {
    return null; // Not enough to identify anyone.
  }

  const response = await fetch(APOLLO_MATCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": APOLLO_API_KEY,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(`Apollo API error (${response.status}): ${JSON.stringify(result)}`);
  }

  const email: string | null = result?.person?.email ?? null;
  if (!email) return null;

  return {
    source: "apollo",
    email,
    // Deliberately not attempting Apollo's phone reveal here -- see header
    // comment: it's asynchronous via webhook, a different integration
    // shape than this function supports today.
    phone: null,
    raw: result,
    notes: [
      "Apollo phone-number reveal not attempted -- Apollo's phone reveal is asynchronous (webhook-based), which this on-demand enrichment doesn't yet support.",
    ],
  };
}

const enrichCandidateContact = async (req: Request) => {
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

  if (!HUNTER_API_KEY && !APOLLO_API_KEY) {
    return jsonResponse(
      {
        error:
          "No contact-enrichment vendor is configured for this project. Add HUNTER_API_KEY and/or APOLLO_API_KEY under Project Settings > Edge Functions > Secrets.",
      },
      400,
    );
  }

  const notes: string[] = [];
  let result: EnrichmentResult | null = null;
  let hadFailure = false;

  try {
    const domain = await fetchCompanyDomain(candidate.current_company_id, authHeader);
    if (domain) {
      result = await tryHunter(candidate, domain);
    } else {
      notes.push(
        "Skipped Hunter.io -- this candidate's linked company has no known website/domain on file yet.",
      );
    }
  } catch (error) {
    hadFailure = true;
    console.error("Hunter enrichment failed (non-fatal, trying Apollo next)", error);
    // Surfaced directly rather than "see server logs" -- a recruiter using
    // this button has no access to Supabase's logs, so a generic pointer
    // there is functionally useless. Same "never hide" disclosure
    // principle already applied everywhere else in this codebase.
    notes.push(
      `Hunter.io lookup failed: ${error instanceof Error ? error.message : String(error)}. Falling through to Apollo.`,
    );
  }

  if (!result) {
    try {
      // Best-effort company name lookup for Apollo's organization_name
      // fallback path -- only needed if linkedin_url isn't available.
      let companyName: string | null = null;
      if (!candidate.linkedin_url && candidate.current_company_id) {
        const companyResponse = await restFetch(
          `companies?id=eq.${candidate.current_company_id}&select=name`,
          authHeader,
        );
        if (companyResponse.ok) {
          const rows = await companyResponse.json();
          companyName = rows?.[0]?.name ?? null;
        }
      }
      result = await tryApollo(candidate, companyName);
    } catch (error) {
      hadFailure = true;
      console.error("Apollo enrichment failed (non-fatal)", error);
      // Surfaced directly, same reasoning as the Hunter catch above. This
      // is how the real 403 API_INACCESSIBLE plan-restriction error (Apollo's
      // people/match/email-reveal endpoint isn't included on a free plan --
      // confirmed directly against a real response during 2026-07-11
      // testing) got diagnosed in the first place; a recruiter seeing this
      // note again later would immediately know it's an account/billing
      // issue to raise with whoever owns the Apollo subscription, not a bug
      // to report.
      notes.push(
        `Apollo lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const now = new Date().toISOString();
  const patchBody: Record<string, unknown> = {
    contact_enrichment_updated_at: now,
  };

  if (result) {
    patchBody.contact_enrichment_status = "enriched";
    patchBody.contact_enrichment_source = result.source;
    patchBody.contact_enrichment_raw = result.raw;
    patchBody.email_jsonb = [{ address: result.email, source: result.source }];
    if (result.phone) {
      patchBody.phone_jsonb = [{ number: result.phone, source: result.source }];
    }
    notes.push(...result.notes);
  } else {
    patchBody.contact_enrichment_status = hadFailure ? "failed" : "not_found";
  }

  const patchResponse = await restFetch(`candidates?id=eq.${candidateId}`, authHeader, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patchBody),
  });

  if (!patchResponse.ok) {
    const errorBody = await patchResponse.text();
    console.error("contact enrichment PATCH failed", patchResponse.status, errorBody);
    return jsonResponse({ error: "Enrichment ran but failed to save to the candidate record" }, 502);
  }

  return jsonResponse({
    status: patchBody.contact_enrichment_status,
    source: result?.source ?? null,
    email: result?.email ?? null,
    notes,
  });
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const authError = await requireAuth(req);
  if (authError) return authError;
  return enrichCandidateContact(req);
});
