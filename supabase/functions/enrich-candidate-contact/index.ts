// Agent H contact enrichment — PDL primary, Hunter/Apollo fallback.
//
// Vendor role (locked 2026-07-30): PDL (People Data Labs) is the primary
// contact enrichment vendor — personal email and phone numbers. Hunter.io
// and Apollo are retained as fallbacks for users without a PDL key.
// Harvest API is NOT used here; Harvest handles rich profile enrichment
// (experience, education, skills, photo) via calibration-session.
//
// Directory note (2026-07-25): this folder was recreated as a real directory
// (replacing a OneDrive junction that broke Supabase bundler/deploy on
// Windows — same fix as save-sourced-candidate). See ADR-unipile Phase 0.
//
// Scope: runs ONLY when a recruiter clicks "Get contact" on an already-saved
// candidate — never on every discovery hit or save.
//
// Waterfall, in order:
//   1. PDL Person Enrichment (primary — 2026-07-30 vendor split decision):
//      GET https://api.peopledatalabs.com/v5/person/enrich
//        ?api_key=<PDL_API_KEY>&profile=<linkedin_url>
//      Returns personal_emails[] and mobile_phone / phone_numbers[].
//      Same PDL_API_KEY already used by enrich-candidate-workhistory and
//      source-candidates-discovery.
//   2. Hunter.io Email Finder — tried only if PDL_API_KEY is missing or PDL
//      returns no result. Needs a company domain (from companies.website).
//   3. Apollo people/match — tried only if Hunter also fails/isn't configured.
//      reveal_personal_emails: true. Phone reveal not attempted (async webhook).
//
// All vendors are best-effort: unconfigured or no-match is not an error.
// contact_enrichment_status: "enriched" / "not_found" / "failed".

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

// PDL — primary contact enrichment vendor (2026-07-30 vendor split decision).
// Same key already used by enrich-candidate-workhistory and source-candidates-discovery.
const PDL_API_KEY = Deno.env.get("PDL_API_KEY");
const PDL_ENRICH_URL = "https://api.peopledatalabs.com/v5/person/enrich";

// Hunter/Apollo — fallback only when PDL_API_KEY is missing or PDL returns nothing.
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
    const withScheme = website.startsWith("http")
      ? website
      : `https://${website}`;
    return new URL(withScheme).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

type EnrichmentResult = {
  source: "pdl" | "hunter" | "apollo";
  email: string | null;
  phone: string | null;
  raw: unknown;
  notes: string[];
};

// PDL Person Enrichment — primary contact vendor (2026-07-30 vendor split).
// Returns personal_emails and mobile_phone / phone_numbers from PDL's record.
async function tryPdl(
  candidate: CandidateRow,
): Promise<EnrichmentResult | null> {
  if (!PDL_API_KEY || !candidate.linkedin_url) return null;

  const url = new URL(PDL_ENRICH_URL);
  url.searchParams.set("api_key", PDL_API_KEY);
  url.searchParams.set("profile", candidate.linkedin_url);

  const response = await fetch(url.toString());
  if (response.status === 404) return null; // clean not-found
  if (!response.ok) {
    throw new Error(
      `PDL API error (${response.status}): ${await response.text()}`,
    );
  }

  const result = await response.json();
  const person = result?.data ?? result; // PDL wraps in .data for enrichment endpoint

  const personalEmails: string[] = Array.isArray(person?.personal_emails)
    ? person.personal_emails
    : [];
  const email: string | null = personalEmails[0] ?? null;

  const phone: string | null =
    person?.mobile_phone ??
    (Array.isArray(person?.phone_numbers)
      ? (person.phone_numbers[0] ?? null)
      : null) ??
    null;

  if (!email && !phone) return null;

  return {
    source: "pdl",
    email,
    phone,
    raw: { ...result, pdl_primary: true },
    notes: [],
  };
}

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
    throw new Error(
      `Hunter API error (${response.status}): ${JSON.stringify(result)}`,
    );
  }

  const email: string | null = result?.data?.email ?? null;
  if (!email) return null;

  const score: number | null =
    typeof result?.data?.score === "number" ? result.data.score : null;
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
    throw new Error(
      `Apollo API error (${response.status}): ${JSON.stringify(result)}`,
    );
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

  if (!PDL_API_KEY && !HUNTER_API_KEY && !APOLLO_API_KEY) {
    return jsonResponse(
      {
        error:
          "No contact-enrichment vendor is configured. Add PDL_API_KEY (primary) or HUNTER_API_KEY / APOLLO_API_KEY (fallback) under Project Settings > Edge Functions > Secrets.",
      },
      400,
    );
  }

  const notes: string[] = [];
  let result: EnrichmentResult | null = null;
  let hadFailure = false;

  // ── Step 1: PDL (primary — 2026-07-30 vendor split decision) ─────────────
  if (PDL_API_KEY) {
    try {
      result = await tryPdl(candidate);
      if (!result) {
        notes.push("PDL found no contact data for this candidate.");
      }
    } catch (error) {
      hadFailure = true;
      console.error(
        "PDL enrichment failed (non-fatal, trying Hunter next)",
        error,
      );
      notes.push(
        `PDL lookup failed: ${error instanceof Error ? error.message : String(error)}. Falling through to Hunter.`,
      );
    }
  }

  // ── Step 2: Hunter.io (fallback — only if PDL unavailable or no result) ──
  if (!result) {
    try {
      const domain = await fetchCompanyDomain(
        candidate.current_company_id,
        authHeader,
      );
      if (domain) {
        result = await tryHunter(candidate, domain);
      } else {
        notes.push(
          "Skipped Hunter.io -- this candidate's linked company has no known website/domain on file yet.",
        );
      }
    } catch (error) {
      hadFailure = true;
      console.error(
        "Hunter enrichment failed (non-fatal, trying Apollo next)",
        error,
      );
      notes.push(
        `Hunter.io lookup failed: ${error instanceof Error ? error.message : String(error)}. Falling through to Apollo.`,
      );
    }
  }

  // ── Step 3: Apollo (fallback — only if PDL and Hunter both failed) ────────
  if (!result) {
    try {
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
      "contact enrichment PATCH failed",
      patchResponse.status,
      errorBody,
    );
    return jsonResponse(
      { error: "Enrichment ran but failed to save to the candidate record" },
      502,
    );
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
