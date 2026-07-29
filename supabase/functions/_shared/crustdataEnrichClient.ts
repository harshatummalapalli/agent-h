// Crustdata Person Enrich / Contact Enrich / account helpers.
// Docs confirmed 2026-07-28 against docs.crustdata.com (Person Enrich
// introduction + reference, Contact Enrich, Credits, Permissions, Pricing,
// API Introduction). Version pinned to the same header the search client uses.
//
// Endpoints:
//   POST https://api.crustdata.com/person/enrich
//   POST https://api.crustdata.com/person/contact/enrich
//   GET  https://api.crustdata.com/account/credits          (free)
//   GET  https://api.crustdata.com/account/endpoints        (free)
//
// Contact Enrich is plan-gated: docs state self-serve keys get 403. Always
// call getCrustdataEndpointPermissions before spending contact credits.

import { CRUSTDATA_API_VERSION } from "./crustdataClient.ts";

export const CRUSTDATA_ENRICH_URL = "https://api.crustdata.com/person/enrich";
export const CRUSTDATA_CONTACT_ENRICH_URL =
  "https://api.crustdata.com/person/contact/enrich";
export const CRUSTDATA_CREDITS_URL =
  "https://api.crustdata.com/account/credits";
export const CRUSTDATA_ENDPOINTS_URL =
  "https://api.crustdata.com/account/endpoints";

/** Default fields for a completeness comparison (1 credit base profile). */
export const CRUSTDATA_PROFILE_COMPARE_FIELDS = [
  "basic_profile",
  "experience",
  "education",
  "skills",
  "social_handles",
  "professional_network",
  "contact", // in-DB business emails only on /person/enrich
] as const;

export type CrustdataEmailRecord = {
  email?: string;
  status?: "deliverable" | "catch_all" | "invalid" | "unknown" | string;
};

export type CrustdataEnrichMatch = {
  matched_on: string;
  match_type: string;
  matches: Array<{
    confidence_score?: number;
    person_data?: Record<string, unknown>;
  }>;
};

export type CrustdataHttpResult<T> = {
  ok: boolean;
  status: number;
  body: T | null;
  rawText: string;
  errorType?: string;
};

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "x-api-version": CRUSTDATA_API_VERSION,
  };
}

async function parseJsonResponse<T>(
  response: Response,
): Promise<CrustdataHttpResult<T>> {
  const rawText = await response.text();
  let body: T | null = null;
  let errorType: string | undefined;
  try {
    body = rawText ? (JSON.parse(rawText) as T) : null;
    const err = (body as { error?: { type?: string } | string } | null)?.error;
    if (err && typeof err === "object" && err.type) errorType = err.type;
    else if (typeof err === "string") errorType = err;
  } catch {
    body = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    body,
    rawText,
    errorType,
  };
}

/** Free — remaining credits. Confirmed: GET /account/credits. */
export async function getCrustdataCredits(
  apiKey: string,
): Promise<CrustdataHttpResult<{ account?: { credits?: number } }>> {
  const response = await fetch(CRUSTDATA_CREDITS_URL, {
    method: "GET",
    headers: authHeaders(apiKey),
  });
  return parseJsonResponse(response);
}

/**
 * Free — endpoint permission map. Use
 * `?path=/person/contact/enrich` before any Contact Enrich spend.
 */
export async function getCrustdataEndpointPermissions(
  apiKey: string,
  path?: string,
): Promise<
  CrustdataHttpResult<{
    endpoints?: Array<{
      path: string;
      status: string;
      fields?: { enabled?: string[]; disabled?: string[] };
    }>;
  }>
> {
  const url = path
    ? `${CRUSTDATA_ENDPOINTS_URL}?path=${encodeURIComponent(path)}`
    : CRUSTDATA_ENDPOINTS_URL;
  const response = await fetch(url, {
    method: "GET",
    headers: authHeaders(apiKey),
  });
  return parseJsonResponse(response);
}

/**
 * Cached Person Enrich. Does NOT return personal emails / phones
 * (docs: use Contact Enrich for those). Max 25 URLs.
 */
export async function enrichCrustdataProfiles(
  apiKey: string,
  linkedinUrls: string[],
  fields: readonly string[] = CRUSTDATA_PROFILE_COMPARE_FIELDS,
): Promise<CrustdataHttpResult<CrustdataEnrichMatch[]>> {
  if (linkedinUrls.length === 0 || linkedinUrls.length > 25) {
    throw new Error("enrichCrustdataProfiles: need 1–25 LinkedIn URLs");
  }
  const response = await fetch(CRUSTDATA_ENRICH_URL, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      professional_network_profile_urls: linkedinUrls,
      fields: [...fields],
    }),
  });
  return parseJsonResponse(response);
}

/**
 * Contact-only enrich. Plan-gated (enterprise). Prefer requesting only the
 * tiers you need: contact.business_emails (1), personal_emails (2),
 * phone_numbers (2).
 */
export async function enrichCrustdataContact(
  apiKey: string,
  linkedinUrls: string[],
  fields: readonly string[] = [
    "contact.business_emails",
    "contact.personal_emails",
    "contact.phone_numbers",
  ],
): Promise<CrustdataHttpResult<CrustdataEnrichMatch[]>> {
  if (linkedinUrls.length === 0 || linkedinUrls.length > 25) {
    throw new Error("enrichCrustdataContact: need 1–25 LinkedIn URLs");
  }
  const response = await fetch(CRUSTDATA_CONTACT_ENRICH_URL, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      professional_network_profile_urls: linkedinUrls,
      fields: [...fields],
    }),
  });
  return parseJsonResponse(response);
}

// ── Normalized snapshot for apples-to-apples comparison ───────────────────

export type EnrichmentEmail = {
  email: string;
  status?: string;
  provenance: "sourced" | "inferred" | "unknown";
  num_sources?: number;
};

export type NormalizedEnrichment = {
  vendor: "crustdata" | "pdl";
  linkedin_url: string;
  matched: boolean;
  confidence?: number | null;
  personal_emails: EnrichmentEmail[];
  business_emails: EnrichmentEmail[];
  phones: string[];
  mobile?: string | null;
  employment: Array<{
    title?: string | null;
    company?: string | null;
    start?: string | null;
    end?: string | null;
  }>;
  social_profiles: Array<{ network?: string; url?: string }>;
  notes: string[];
  raw?: unknown;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function crustdataEmails(
  list: unknown,
  provenance: EnrichmentEmail["provenance"],
): EnrichmentEmail[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (typeof item === "string") {
        return { email: item, provenance };
      }
      const rec = asRecord(item);
      if (!rec?.email || typeof rec.email !== "string") return null;
      return {
        email: rec.email,
        status: typeof rec.status === "string" ? rec.status : undefined,
        provenance,
      };
    })
    .filter((e): e is EnrichmentEmail => e != null);
}

function flattenExperience(personData: Record<string, unknown>) {
  const experience = asRecord(personData.experience);
  const details = asRecord(experience?.employment_details);
  const current = Array.isArray(details?.current) ? details!.current : [];
  const past = Array.isArray(details?.past) ? details!.past : [];
  return [...current, ...past].map((entry) => {
    const e = asRecord(entry) ?? {};
    const company = asRecord(e.company);
    return {
      title: typeof e.title === "string" ? e.title : null,
      company:
        (typeof company?.name === "string" ? company.name : null) ??
        (typeof e.company_name === "string" ? e.company_name : null),
      start: typeof e.start_date === "string" ? e.start_date : null,
      end: typeof e.end_date === "string" ? e.end_date : null,
    };
  });
}

function socialFromCrustdata(personData: Record<string, unknown>) {
  const handles = asRecord(personData.social_handles) ?? {};
  const out: Array<{ network?: string; url?: string }> = [];
  for (const [key, value] of Object.entries(handles)) {
    const rec = asRecord(value);
    const url =
      (typeof rec?.profile_url === "string" && rec.profile_url) ||
      (typeof rec?.slug === "string" && rec.slug) ||
      undefined;
    if (url) out.push({ network: key, url });
  }
  return out;
}

/** Normalize one Crustdata enrich/contact result entry. */
export function normalizeCrustdataEnrichment(
  linkedinUrl: string,
  entry: CrustdataEnrichMatch | null | undefined,
  opts?: { contactOnly?: boolean },
): NormalizedEnrichment {
  const notes: string[] = [];
  const match = entry?.matches?.[0];
  const personData = asRecord(match?.person_data) ?? {};
  const contact = asRecord(personData.contact) ?? {};

  if (!entry || !match) {
    return {
      vendor: "crustdata",
      linkedin_url: linkedinUrl,
      matched: false,
      personal_emails: [],
      business_emails: [],
      phones: [],
      employment: [],
      social_profiles: [],
      notes: ["no match"],
      raw: entry ?? null,
    };
  }

  if (!opts?.contactOnly) {
    notes.push(
      "On /person/enrich, contact is in-DB business emails only; personal/phone require /person/contact/enrich",
    );
  }

  const phones = Array.isArray(contact.phone_numbers)
    ? contact.phone_numbers.filter((p): p is string => typeof p === "string")
    : [];

  return {
    vendor: "crustdata",
    linkedin_url: linkedinUrl,
    matched: true,
    confidence: match.confidence_score ?? null,
    personal_emails: crustdataEmails(contact.personal_emails, "sourced"),
    business_emails: crustdataEmails(contact.business_emails, "sourced"),
    phones,
    mobile: phones[0] ?? null,
    employment: opts?.contactOnly ? [] : flattenExperience(personData),
    social_profiles: opts?.contactOnly ? [] : socialFromCrustdata(personData),
    notes,
    raw: personData,
  };
}
