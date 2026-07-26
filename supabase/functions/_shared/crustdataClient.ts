// Minimal Crustdata client shared between source-candidates-discovery and
// calibration-session.  Only the subset actually needed for a role-brief
// based candidate search: filter building, HTTP call, normalisation.
//
// The full query-builder (crustdataQueryBuilder.ts in
// source-candidates-discovery/) owns the advanced criteria: learned
// criteria, past titles/companies, company-size bands, seniority term
// mapping, shingle decomposition.  Here we cover the common path:
// title OR (or) title keywords, location, seniority containment,
// required-skill OR-groups and experience-year bounds.
//
// API: POST https://api.crustdata.com/person/search
// Header: Authorization: Bearer <key>, x-api-version: 2025-11-01
// Body: { filters: Condition | Group, limit }

export const CRUSTDATA_SEARCH_URL = "https://api.crustdata.com/person/search";
export const CRUSTDATA_API_VERSION = "2025-11-01";

// ── Field paths (from Crustdata PersonSearchCondition enum) ──────────────

const F = {
  currentTitle: "experience.employment_details.current.title",
  currentSeniority: "experience.employment_details.current.seniority_level",
  locationCity: "basic_profile.location.city",
  yearsOfExperience: "years_of_experience",
  currentSkills: "skills.professional_network_skills",
} as const;

// ── Filter types (minimal subset) ────────────────────────────────────────

type Condition = {
  field: string;
  type: "(.)" | "=>" | "=<" | "in" | "=";
  value: string | number | string[];
};
type Group = { op: "and" | "or"; conditions: Array<Condition | Group> };
type Filters = Condition | Group;

// ── Seniority mapping ────────────────────────────────────────────────────

const SENIORITY_TERMS: Record<string, string | null> = {
  intern: "Intern",
  entry_level: "Junior",
  senior: "Senior",
  staff: "Staff",
  principal: "Principal",
  manager: "Manager",
  director: "Director",
  executive: "VP",
};

// ── Role-brief → filters ─────────────────────────────────────────────────

export type CalibrationRoleBrief = {
  name?: unknown;
  seniority?: unknown;
  location?: unknown;
  required_skills?: unknown;
  must_have_keywords?: unknown;
  years_experience_min?: unknown;
  years_experience_max?: unknown;
};

/** Build Crustdata filters from a role-brief snapshot.  Returns null when
 *  there is not enough information to form a useful query (no title, no
 *  skills). */
export function buildCalibrationFilters(
  brief: CalibrationRoleBrief,
): Filters | null {
  const conditions: Array<Condition | Group> = [];

  // Title: use the role name as a contains match.
  const title = typeof brief.name === "string" ? brief.name.trim() : null;
  if (title) {
    conditions.push({ field: F.currentTitle, type: "(.)", value: title });
  }

  // Location
  const location =
    typeof brief.location === "string" ? brief.location.trim() : null;
  if (location && !/remote/i.test(location)) {
    conditions.push({
      field: F.locationCity,
      type: "(.)",
      value: location,
    });
  }

  // Seniority
  const seniority =
    typeof brief.seniority === "string" ? brief.seniority.toLowerCase() : null;
  if (seniority && SENIORITY_TERMS[seniority]) {
    conditions.push({
      field: F.currentSeniority,
      type: "(.)",
      value: SENIORITY_TERMS[seniority]!,
    });
  }

  // Years-of-experience bounds
  const yoeMin =
    typeof brief.years_experience_min === "number"
      ? brief.years_experience_min
      : null;
  const yoeMax =
    typeof brief.years_experience_max === "number"
      ? brief.years_experience_max
      : null;
  if (yoeMin != null) {
    conditions.push({ field: F.yearsOfExperience, type: "=>", value: yoeMin });
  }
  if (yoeMax != null) {
    conditions.push({ field: F.yearsOfExperience, type: "=<", value: yoeMax });
  }

  // Required skills: at least one must appear (OR group)
  const skills = Array.isArray(brief.required_skills)
    ? (brief.required_skills as unknown[])
        .filter(
          (s): s is string => typeof s === "string" && s.trim().length > 0,
        )
        .slice(0, 5)
    : [];
  if (skills.length > 0) {
    const skillConds: Condition[] = skills.map((s) => ({
      field: F.currentSkills,
      type: "(.)",
      value: s.trim(),
    }));
    conditions.push(
      skillConds.length === 1
        ? skillConds[0]
        : { op: "or", conditions: skillConds },
    );
  }

  if (conditions.length === 0) return null;
  if (conditions.length === 1) return conditions[0];
  return { op: "and", conditions };
}

// ── Normalise raw Crustdata profile ──────────────────────────────────────

function numericOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && !Number.isNaN(Number(value)))
    return Number(value);
  return null;
}

function crustdataYearsExperience(raw: Record<string, unknown>): number | null {
  const bp = (raw.basic_profile ?? {}) as Record<string, unknown>;
  return (
    numericOrNull(bp.years_of_experience) ??
    numericOrNull(raw.years_of_experience)
  );
}

export type RawCalibrationCandidate = {
  id: string;
  full_name: string | null;
  job_title: string | null;
  job_company_name: string | null;
  location_name: string | null;
  skills: string[];
  linkedin_url: string | null;
  years_experience: number | null;
  _source_vendor: "crustdata";
};

export function normalizeCrustdataProfile(
  raw: Record<string, unknown>,
): RawCalibrationCandidate {
  const basicProfile = (raw.basic_profile ?? {}) as Record<string, unknown>;
  const experience = (raw.experience ?? {}) as Record<string, unknown>;
  const employmentDetails = (experience.employment_details ?? {}) as Record<
    string,
    unknown
  >;
  const currentPositions = Array.isArray(employmentDetails.current)
    ? (employmentDetails.current as Array<Record<string, unknown>>)
    : [];
  const currentPosition = currentPositions[0] ?? {};

  const location = (basicProfile.location ?? {}) as Record<string, unknown>;
  const locationName =
    typeof location.raw === "string" && location.raw.length > 0
      ? location.raw
      : [location.city, location.state, location.country]
          .filter((v): v is string => typeof v === "string" && v.length > 0)
          .join(", ") || null;

  const socialHandles = (raw.social_handles ?? {}) as Record<string, unknown>;
  const pni = (socialHandles.professional_network_identifier ?? {}) as Record<
    string,
    unknown
  >;
  const rawLinkedin =
    typeof pni.profile_url === "string" ? pni.profile_url : null;

  const personId =
    typeof raw.crustdata_person_id === "number" ||
    typeof raw.crustdata_person_id === "string"
      ? String(raw.crustdata_person_id)
      : "";

  return {
    id: personId,
    full_name: typeof basicProfile.name === "string" ? basicProfile.name : null,
    job_title:
      typeof basicProfile.current_title === "string"
        ? basicProfile.current_title
        : typeof currentPosition.title === "string"
          ? currentPosition.title
          : null,
    job_company_name:
      typeof currentPosition.name === "string" ? currentPosition.name : null,
    location_name: locationName,
    skills: [],
    linkedin_url: rawLinkedin ? rawLinkedin.replace(/^https?:\/\//i, "") : null,
    years_experience: crustdataYearsExperience(raw),
    _source_vendor: "crustdata",
  };
}

// ── HTTP search ───────────────────────────────────────────────────────────

/** Search Crustdata for candidates matching a role brief.
 *  Returns an empty array on any error (non-fatal for calibration gate). */
export async function searchCrustdataForRoleBrief(
  roleBrief: CalibrationRoleBrief,
  limit: number,
  apiKey: string,
): Promise<RawCalibrationCandidate[]> {
  const filters = buildCalibrationFilters(roleBrief);
  if (!filters) return [];

  try {
    const response = await fetch(CRUSTDATA_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "x-api-version": CRUSTDATA_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filters, limit }),
    });
    if (!response.ok) return [];
    const result = (await response.json()) as {
      profiles?: Array<Record<string, unknown>>;
    };
    return (result.profiles ?? []).map(normalizeCrustdataProfile);
  } catch {
    return [];
  }
}
