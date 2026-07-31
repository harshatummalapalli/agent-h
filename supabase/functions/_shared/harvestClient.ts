// Harvest API client for profile enrichment.
//
// Vendor role (locked 2026-07-30): Harvest API handles rich profile enrichment
// — experience, education, skills, certifications, photo.
// Free incidental emails parsed from response when present (no findEmail=true).
// PDL remains the primary source for personal email/phone via enrich-candidate-contact.
//
// API: GET https://api.harvestapi.io/linkedin/profile
// Auth: X-API-Key header
// Params: url (LinkedIn URL), main=true for cheaper/faster capped lists
//
// Env: HARVESTAPI_KEY, HARVEST_CONCURRENCY (default 1 for free-tier safety)
//
// main=true: caps list lengths (skills, experience) — cheaper/faster for pilot.
// Set cheap=false on fetchHarvestProfile if why-fit quality drops noticeably.

export const HARVEST_API_URL = "https://api.harvestapi.io/linkedin/profile";
export const HARVEST_PER_ROLE_CEILING_USD = 1.5;

const HARVESTAPI_KEY = Deno.env.get("HARVESTAPI_KEY");
const HARVEST_CONCURRENCY = Math.max(
  1,
  parseInt(Deno.env.get("HARVEST_CONCURRENCY") ?? "1", 10) || 1,
);

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
  certifications?: string[];
  emails?: string[];
  experiences: HarvestExperience[];
  educations: HarvestEducation[];
};

// ── Concurrency helper ────────────────────────────────────────────────────────

/**
 * Run an array of task factories with at most `limit` inflight at once.
 * Preserves order of results.
 */
export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  const queue = tasks.map((task, i) => ({ task, i }));
  let idx = 0;

  async function worker() {
    while (idx < queue.length) {
      const { task, i } = queue[idx++];
      results[i] = await task();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

// ── Core fetch with retry ─────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [500, 1000, 2000];

/**
 * Fetch a single LinkedIn profile from Harvest API.
 * Retries up to 2 times on 429/503 with exponential-ish backoff.
 * Returns null on any unrecoverable error.
 *
 * opts.cheap=true (default): appends main=true — faster/cheaper, caps list lengths.
 * Set cheap=false if why-fit quality requires full profile lists.
 */
export async function fetchHarvestProfile(
  linkedinUrl: string,
  opts: { cheap?: boolean } = {},
): Promise<HarvestProfile | null> {
  if (!HARVESTAPI_KEY) return null;

  const { cheap = true } = opts;
  const endpoint = new URL(HARVEST_API_URL);
  endpoint.searchParams.set("url", linkedinUrl);
  if (cheap) endpoint.searchParams.set("main", "true");

  let lastStatus = 0;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(endpoint.toString(), {
        headers: { "X-API-Key": HARVESTAPI_KEY },
      });
    } catch (err) {
      console.warn("[harvestClient] fetch error for", linkedinUrl, err);
      return null;
    }

    if (resp.ok) {
      let raw: Record<string, unknown>;
      try {
        raw = await resp.json();
      } catch {
        console.warn("[harvestClient] invalid JSON for", linkedinUrl);
        return null;
      }
      return normalizeHarvestProfile(raw);
    }

    lastStatus = resp.status;
    const retryable = resp.status === 429 || resp.status === 503;
    if (!retryable || attempt === RETRY_DELAYS_MS.length) break;

    const delay = RETRY_DELAYS_MS[attempt];
    console.warn(
      `[harvestClient] ${resp.status} for ${linkedinUrl} — retry ${attempt + 1} in ${delay}ms`,
    );
    await new Promise((r) => setTimeout(r, delay));
  }

  console.warn(
    "[harvestClient] non-OK response",
    lastStatus,
    "for",
    linkedinUrl,
  );
  return null;
}

function normalizeHarvestProfile(raw: Record<string, unknown>): HarvestProfile {
  const skills = Array.isArray(raw.skills)
    ? (raw.skills as unknown[]).flatMap((s) =>
        typeof s === "string" ? [s] : [],
      )
    : [];

  const certifications = Array.isArray(raw.certifications)
    ? (raw.certifications as unknown[]).flatMap((c) => {
        if (typeof c === "string") return [c];
        if (
          c &&
          typeof c === "object" &&
          "name" in c &&
          typeof (c as Record<string, unknown>).name === "string"
        )
          return [(c as Record<string, unknown>).name as string];
        return [];
      })
    : [];

  // Free incidental emails — parse if present; no findEmail=true used.
  // Sort personal-first only when type metadata is available on items.
  const rawEmails = Array.isArray(raw.emails) ? (raw.emails as unknown[]) : [];
  let emails: string[] = [];
  if (rawEmails.length > 0) {
    if (typeof rawEmails[0] === "string") {
      emails = rawEmails as string[];
    } else {
      // Objects with .email and optional .type fields
      const typed = rawEmails.filter(
        (e): e is Record<string, unknown> =>
          e !== null && typeof e === "object",
      );
      const hasType = typed.some((e) => typeof e.type === "string");
      if (hasType) {
        typed.sort((a, b) => {
          const rank = (t: unknown) =>
            t === "personal" ? 0 : t === "work" ? 1 : 2;
          return rank(a.type) - rank(b.type);
        });
      }
      emails = typed.flatMap((e) =>
        typeof e.email === "string" ? [e.email] : [],
      );
    }
  }

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
    certifications: certifications.length > 0 ? certifications : undefined,
    emails: emails.length > 0 ? emails : undefined,
    experiences,
    educations,
  };
}

// ── enrichCandidatesWithHarvestSkills ─────────────────────────────────────────

export type HarvestSkillsEnrichment = {
  skills: string[];
  certifications?: string[];
  photoUrl: string | null;
  email: string | null;
};

/**
 * Enrich a list of LinkedIn URLs with Harvest skills/certifications/photo/email.
 * Uses cheap mode (main=true) and HARVEST_CONCURRENCY limit (default 1).
 * Every input URL appears in the returned Map; failed lookups get empty defaults.
 */
export async function enrichCandidatesWithHarvestSkills(
  linkedinUrls: string[],
): Promise<Map<string, HarvestSkillsEnrichment>> {
  const results = new Map<string, HarvestSkillsEnrichment>();
  if (!HARVESTAPI_KEY || linkedinUrls.length === 0) return results;

  const tasks = linkedinUrls.map((url) => async () => {
    const profile = await fetchHarvestProfile(url, { cheap: true });
    results.set(url, {
      skills: profile?.skills ?? [],
      certifications: profile?.certifications?.length
        ? profile.certifications
        : undefined,
      photoUrl: profile?.profilePictureUrl ?? null,
      email: profile?.emails?.[0] ?? null,
    });
  });

  await runWithConcurrency(tasks, HARVEST_CONCURRENCY);
  return results;
}

// ── Legacy batch helper (keep for backward compat) ────────────────────────────

/**
 * Enrich a batch of LinkedIn URLs with Harvest profiles, bounded concurrency.
 * Returns a Map from linkedin_url → HarvestProfile | null.
 * @deprecated Use enrichCandidatesWithHarvestSkills for new callers.
 */
export async function batchEnrichFromHarvest(
  linkedinUrls: string[],
  concurrency = 5,
): Promise<Map<string, HarvestProfile | null>> {
  const legacyResults = new Map<string, HarvestProfile | null>();
  if (!HARVESTAPI_KEY || linkedinUrls.length === 0) return legacyResults;

  const tasks = linkedinUrls.map((url) => async () => {
    legacyResults.set(url, await enrichProfileFromHarvest(url));
  });
  await runWithConcurrency(tasks, concurrency);
  return legacyResults;
}

/** Fetch a single LinkedIn profile from Harvest API. Returns null on any error.
 * @deprecated Use fetchHarvestProfile instead (adds retry + cheap mode).
 */
export async function enrichProfileFromHarvest(
  linkedinUrl: string,
): Promise<HarvestProfile | null> {
  return fetchHarvestProfile(linkedinUrl, { cheap: false });
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
