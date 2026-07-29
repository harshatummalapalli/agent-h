// PDL Person Enrich helpers for the Crustdata-vs-PDL comparison harness.
// Mechanics already proven in enrich-candidate-workhistory:
//   GET https://api.peopledatalabs.com/v5/person/enrich?api_key=&profile=
// Field provenance from docs.peopledatalabs.com/docs/fields (2026-07-28):
//   personal_emails / emails / phone_numbers / mobile_phone → sourced assoc.
//   possible_* / inferred_* → inferred / weaker.

import type {
  EnrichmentEmail,
  NormalizedEnrichment,
} from "./crustdataEnrichClient.ts";

export const PDL_ENRICH_URL = "https://api.peopledatalabs.com/v5/person/enrich";

export type PdlEnrichHttpResult = {
  ok: boolean;
  status: number;
  likelihood?: number | null;
  data: Record<string, unknown> | null;
  rawText: string;
};

export async function enrichPdlPerson(
  apiKey: string,
  linkedinUrl: string,
): Promise<PdlEnrichHttpResult> {
  const url = new URL(PDL_ENRICH_URL);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("profile", linkedinUrl);

  const response = await fetch(url.toString());
  const rawText = await response.text();
  let parsed: {
    status?: number;
    likelihood?: number;
    data?: Record<string, unknown>;
  } | null = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = null;
  }

  if (response.status === 404) {
    return { ok: true, status: 404, likelihood: null, data: null, rawText };
  }

  return {
    ok: response.ok,
    status: response.status,
    likelihood: parsed?.likelihood ?? null,
    data: parsed?.data ?? null,
    rawText,
  };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function pdlEmailList(
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
      const email =
        (typeof rec?.address === "string" && rec.address) ||
        (typeof rec?.email === "string" && rec.email) ||
        null;
      if (!email) return null;
      return {
        email,
        provenance,
        num_sources:
          typeof rec?.num_sources === "number" ? rec.num_sources : undefined,
      };
    })
    .filter((e): e is EnrichmentEmail => e != null);
}

function experienceFromPdl(data: Record<string, unknown>) {
  if (!Array.isArray(data.experience)) return [];
  return data.experience.map((entry) => {
    const e = asRecord(entry) ?? {};
    const company = asRecord(e.company);
    const titleObj = asRecord(e.title);
    const title =
      (typeof e.title === "string" && e.title) ||
      (typeof titleObj?.name === "string" && titleObj.name) ||
      null;
    return {
      title,
      company:
        (typeof company?.name === "string" && company.name) ||
        (typeof e.company_name === "string" && e.company_name) ||
        null,
      start: typeof e.start_date === "string" ? e.start_date : null,
      end: typeof e.end_date === "string" ? e.end_date : null,
    };
  });
}

function socialFromPdl(data: Record<string, unknown>) {
  const out: Array<{ network?: string; url?: string }> = [];
  if (typeof data.linkedin_url === "string") {
    out.push({ network: "linkedin", url: data.linkedin_url });
  }
  if (typeof data.twitter_url === "string") {
    out.push({ network: "twitter", url: data.twitter_url });
  }
  if (typeof data.facebook_url === "string") {
    out.push({ network: "facebook", url: data.facebook_url });
  }
  if (typeof data.github_url === "string") {
    out.push({ network: "github", url: data.github_url });
  }
  if (Array.isArray(data.profiles)) {
    for (const p of data.profiles) {
      const rec = asRecord(p);
      if (!rec) continue;
      const url =
        (typeof rec.url === "string" && rec.url) ||
        (typeof rec.id === "string" && rec.id) ||
        undefined;
      if (url) {
        out.push({
          network: typeof rec.network === "string" ? rec.network : undefined,
          url,
        });
      }
    }
  }
  return out;
}

export function normalizePdlEnrichment(
  linkedinUrl: string,
  result: PdlEnrichHttpResult,
): NormalizedEnrichment {
  const notes: string[] = [];
  if (result.status === 404 || !result.data) {
    return {
      vendor: "pdl",
      linkedin_url: linkedinUrl,
      matched: false,
      personal_emails: [],
      business_emails: [],
      phones: [],
      employment: [],
      social_profiles: [],
      notes: [result.status === 404 ? "no match (404)" : "empty data"],
      raw: null,
    };
  }

  const data = result.data;
  const personal = pdlEmailList(data.personal_emails, "sourced");
  const possiblePersonal = pdlEmailList(data.possible_emails, "inferred");
  if (possiblePersonal.length) {
    notes.push(
      `${possiblePersonal.length} possible_emails treated as inferred (weaker association)`,
    );
  }

  // Split emails[] by type when personal_emails is empty/sparse.
  if (Array.isArray(data.emails)) {
    for (const item of data.emails) {
      const rec = asRecord(item);
      const email =
        (typeof rec?.address === "string" && rec.address) ||
        (typeof rec?.email === "string" && rec.email) ||
        null;
      if (!email) continue;
      const type = typeof rec?.type === "string" ? rec.type : "";
      const entry: EnrichmentEmail = {
        email,
        provenance: "sourced",
        num_sources:
          typeof rec?.num_sources === "number" ? rec.num_sources : undefined,
      };
      if (type === "personal") {
        if (!personal.some((e) => e.email === email)) personal.push(entry);
      } else if (type === "current_professional" || type === "professional") {
        // fall through to business bucket below via side list
      }
    }
  }

  const business: EnrichmentEmail[] = [];
  if (typeof data.work_email === "string" && data.work_email) {
    business.push({ email: data.work_email, provenance: "sourced" });
  }
  if (Array.isArray(data.emails)) {
    for (const item of data.emails) {
      const rec = asRecord(item);
      const email =
        (typeof rec?.address === "string" && rec.address) ||
        (typeof rec?.email === "string" && rec.email) ||
        null;
      if (!email) continue;
      const type = typeof rec?.type === "string" ? rec.type : "";
      if (type === "personal") continue;
      if (!business.some((e) => e.email === email)) {
        business.push({
          email,
          provenance: "sourced",
          num_sources:
            typeof rec?.num_sources === "number" ? rec.num_sources : undefined,
        });
      }
    }
  }

  const phones: string[] = [];
  if (typeof data.mobile_phone === "string" && data.mobile_phone) {
    phones.push(data.mobile_phone);
  }
  if (Array.isArray(data.phone_numbers)) {
    for (const p of data.phone_numbers) {
      if (typeof p === "string" && !phones.includes(p)) phones.push(p);
      else {
        const rec = asRecord(p);
        const num =
          (typeof rec?.number === "string" && rec.number) ||
          (typeof rec?.phone_number === "string" && rec.phone_number) ||
          null;
        if (num && !phones.includes(num)) phones.push(num);
      }
    }
  }
  if (Array.isArray(data.possible_phones) && data.possible_phones.length) {
    notes.push(
      `${data.possible_phones.length} possible_phones omitted from primary phone list (inferred)`,
    );
  }
  if (data.inferred_salary != null) {
    notes.push(`inferred_salary present: ${String(data.inferred_salary)}`);
  }
  if (data.inferred_years_experience != null) {
    notes.push(
      `inferred_years_experience present: ${String(data.inferred_years_experience)}`,
    );
  }

  // Boolean redaction (free plan) — docs say contact fields may be true/false.
  if (typeof data.mobile_phone === "boolean") {
    notes.push(
      `mobile_phone redacted to boolean (${data.mobile_phone}) — plan may hide contact values`,
    );
  }

  return {
    vendor: "pdl",
    linkedin_url: linkedinUrl,
    matched: true,
    confidence: result.likelihood ?? null,
    personal_emails: [...personal, ...possiblePersonal],
    business_emails: business,
    phones,
    mobile: typeof data.mobile_phone === "string" ? data.mobile_phone : null,
    employment: experienceFromPdl(data),
    social_profiles: socialFromPdl(data),
    notes,
    raw: data,
  };
}
