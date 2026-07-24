// Per-candidate display fields extracted from vendor-specific discovery
// payloads for opt-in sorting on SourceCandidatesPage.

export function numericOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    !Number.isNaN(Number(value))
  ) {
    return Number(value);
  }
  return null;
}

export function monthsToYears(months: unknown): number | null {
  const numeric = numericOrNull(months);
  if (numeric == null) return null;
  return Math.round((numeric / 12) * 10) / 10;
}

export function coresignalYearsExperience(
  raw: Record<string, unknown>,
): number | null {
  return monthsToYears(raw.total_experience_duration_months);
}

export function coresignalCompanySize(
  raw: Record<string, unknown>,
): number | null {
  return (
    numericOrNull(raw.experience_company_employees_count) ??
    numericOrNull(raw.company_employees_count) ??
    numericOrNull(raw.active_experience_company_employees_count)
  );
}

export function crustdataYearsExperience(
  raw: Record<string, unknown>,
): number | null {
  const basicProfile = (raw.basic_profile ?? {}) as Record<string, unknown>;
  return (
    numericOrNull(basicProfile.years_of_experience) ??
    numericOrNull(raw.years_of_experience)
  );
}

export function crustdataCompanySize(
  raw: Record<string, unknown>,
): number | null {
  const experience = (raw.experience ?? {}) as Record<string, unknown>;
  const employmentDetails = (experience.employment_details ?? {}) as Record<
    string,
    unknown
  >;
  const currentPositions = Array.isArray(employmentDetails.current)
    ? (employmentDetails.current as Array<Record<string, unknown>>)
    : [];
  const currentPosition = currentPositions[0] ?? {};
  return numericOrNull(currentPosition.company_headcount_latest);
}

export function apolloYearsExperience(
  raw: Record<string, unknown>,
): number | null {
  return numericOrNull(raw.years_of_experience);
}

export function apolloCompanySize(raw: Record<string, unknown>): number | null {
  const org = (raw.organization ?? {}) as Record<string, unknown>;
  return (
    numericOrNull(org.estimated_num_employees) ??
    numericOrNull(org.num_employees)
  );
}
