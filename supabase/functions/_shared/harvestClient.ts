// Harvest API client for profile enrichment.
//
// Vendor role (locked 2026-07-30): Harvest API handles rich profile enrichment
// — experience, education, skills, photo. NOT used for emails/phones (that's
// PDL's job via enrich-candidate-contact).
//
// API: GET https://api.harvestapi.io/linkedin/profile
// Auth: X-API-Key header
// Params: url (LinkedIn URL) or publicIdentifier (LinkedIn handle)
//
// Env: HARVESTAPI_KEY
//
// Credit estimate: ~$0.01/profile. Per-role ceiling: HARVEST_PER_ROLE_CEILING_USD.

export const HARVEST_API_URL = "https://api.harvestapi.io/linkedin/profile";
export const HARVEST_PER_ROLE_CEILING_USD = 1.5;

const HARVESTAPI_KEY = Deno.env.get("HARVESTAPI_KEY");

// ── Types ─────────────────────────────────────────────────────────────────────

export type HarvestExperience = {
  title?: string | null;
  companyName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
  location?: string | null;
};

export type HarvestEducation = {
  school?: string | null;
  degree?: string | null;
  fieldOfStudy?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

export type HarvestProfile = {
  profilePictureUrl?: string | null;
  headline?: string | null;
  summary?: string | null;
  skills: string[];
  experiences: HarvestExperience[];
  educations: HarvestEducation[];
};

// ── Core fetch ────────────────────────────────────────────────────────────────

/** Fetch a single LinkedIn profile from Harvest API. Returns null on any error. */
export async function enrichProfileFromHarvest(
  linkedinUrl: string,
): Promise<HarvestProfile | null> {
  if (!HARVESTAPI_KEY) return null;

  const url = new URL(HARVEST_API_URL);
  url.searchParams.set("url", linkedinUrl);

  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      headers: { "X-API-Key": HARVESTAPI_KEY },
    });
  } catch (err) {
    console.warn("[harvestClient] fetch error for", linkedinUrl, err);
    return null;
  }

  if (!resp.ok) {
    console.warn(
      "[harvestClient] non-OK response",
      resp.status,
      "for",
      linkedinUrl,
    );
    return null;
  }

  let raw: Record<string, unknown>;
  try {
    raw = await resp.json();
  } catch {
    console.warn("[harvestClient] invalid JSON response for", linkedinUrl);
    return null;
  }

  return normalizeHarvestProfile(raw);
}

function normalizeHarvestProfile(raw: Record<string, unknown>): HarvestProfile {
  const skills = Array.isArray(raw.skills)
    ? (raw.skills as string[]).filter((s) => typeof s === "string")
    : [];

  const experiences: HarvestExperience[] = Array.isArray(raw.experiences)
    ? (raw.experiences as Record<string, unknown>[]).map((e) => ({
        title: (e.title as string) ?? null,
        companyName: (e.companyName as string) ?? null,
        startDate: (e.startDate as string) ?? null,
        endDate: (e.endDate as string) ?? null,
        description: (e.description as string) ?? null,
        location: (e.location as string) ?? null,
      }))
    : [];

  const educations: HarvestEducation[] = Array.isArray(raw.educations)
    ? (raw.educations as Record<string, unknown>[]).map((e) => ({
        school: (e.school as string) ?? null,
        degree: (e.degree as string) ?? null,
        fieldOfStudy: (e.fieldOfStudy as string) ?? null,
        startDate: (e.startDate as string) ?? null,
        endDate: (e.endDate as string) ?? null,
      }))
    : [];

  return {
    profilePictureUrl: (raw.profilePictureUrl as string) ?? null,
    headline: (raw.headline as string) ?? null,
    summary: (raw.summary as string) ?? null,
    skills,
    experiences,
    educations,
  };
}

// ── Batch helper ──────────────────────────────────────────────────────────────

/**
 * Enrich a batch of LinkedIn URLs with Harvest profiles, bounded concurrency.
 * Returns a Map from linkedin_url → HarvestProfile | null (null = error or not found).
 */
export async function batchEnrichFromHarvest(
  linkedinUrls: string[],
  concurrency = 5,
): Promise<Map<string, HarvestProfile | null>> {
  const results = new Map<string, HarvestProfile | null>();
  if (!HARVESTAPI_KEY || linkedinUrls.length === 0) return results;

  const queue = [...linkedinUrls];

  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift()!;
      results.set(url, await enrichProfileFromHarvest(url));
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, linkedinUrls.length) },
    () => worker(),
  );
  await Promise.all(workers);

  return results;
}

/** Build a compact work history summary string for ranking context. */
export function buildWorkHistorySummary(
  experiences: HarvestExperience[],
  maxEntries = 3,
): string {
  return experiences
    .slice(0, maxEntries)
    .map((e) => {
      const parts = [e.title, e.companyName].filter(Boolean).join(" @ ");
      const years =
        e.startDate && e.endDate
          ? ` (${e.startDate.slice(0, 4)}–${e.endDate.slice(0, 4)})`
          : e.startDate
            ? ` (${e.startDate.slice(0, 4)}–present)`
            : "";
      return parts + years;
    })
    .join(", ");
}
