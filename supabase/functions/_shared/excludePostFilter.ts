// excludePostFilter.ts — defense-in-depth exclude application.
//
// After ANY candidate set returns from any tier or any route, call
// applyExcludeFilter() before returning candidates to the frontend.
// This guards against Crustdata query-layer exclude failures (confirmed live:
// Cognizant appeared after explicit hard-exclude in P0 investigation).
//
// Does NOT replace query-layer excludes — runs in addition to them.
// No Deno-specific imports; Vitest-compatible.

import type { SearchIntentCondition } from "./searchIntent.ts";

export type MinimalCandidate = {
  // Company field aliases — all checked for company/exclude conditions.
  // Covers Coresignal-normalised field (current_employer_company_name),
  // raw Crustdata field (job_company_name), and generic alias (company_name).
  current_employer_company_name?: string | null;
  job_company_name?: string | null;
  company_name?: string | null;
  // Title field aliases — all checked for title/exclude conditions.
  // Covers Coresignal-normalised field (title), raw Crustdata field
  // (job_title), and LinkedIn headline field (headline).
  title?: string | null;
  job_title?: string | null;
  headline?: string | null;
  [key: string]: unknown;
};

/**
 * Hard-filter candidates against company and title exclude conditions.
 *
 * Company check (case-insensitive substring, any alias hits → excluded):
 *   current_employer_company_name | job_company_name | company_name
 *
 * Title check (case-insensitive substring, any alias hits → excluded):
 *   title | job_title | headline
 *
 * Accepts RawCalibrationCandidate (job_company_name / job_title) directly
 * without a rename map — the alias set covers both Crustdata and
 * Coresignal-normalised field names.
 *
 * Returns candidates that do NOT match any exclude condition.
 * Short-circuits to the original array when there are no exclude conditions.
 */
export function applyExcludeFilter<T extends MinimalCandidate>(
  candidates: T[],
  conditions: SearchIntentCondition[],
): T[] {
  const companyExcludes = conditions
    .filter((c) => c.category === "company" && c.disposition === "exclude")
    .map((c) => c.value.toLowerCase().trim());
  const titleExcludes = conditions
    .filter((c) => c.category === "title" && c.disposition === "exclude")
    .map((c) => c.value.toLowerCase().trim());

  if (companyExcludes.length === 0 && titleExcludes.length === 0) {
    return candidates;
  }

  return candidates.filter((candidate) => {
    // Build non-empty lowercase strings for each field alias.
    const companyFields = [
      candidate.current_employer_company_name,
      candidate.job_company_name,
      candidate.company_name,
    ]
      .map((v) => (typeof v === "string" ? v.toLowerCase() : ""))
      .filter(Boolean);

    const titleFields = [
      candidate.title,
      candidate.job_title,
      candidate.headline,
    ]
      .map((v) => (typeof v === "string" ? v.toLowerCase() : ""))
      .filter(Boolean);

    if (
      companyExcludes.some(
        (ex) => ex && companyFields.some((f) => f.includes(ex)),
      )
    )
      return false;
    if (
      titleExcludes.some((ex) => ex && titleFields.some((f) => f.includes(ex)))
    )
      return false;
    return true;
  });
}

/**
 * Derive exclude conditions from flat role brief columns (fallback when no
 * SearchIntent is available). Produces the same shape as SearchIntentConditions
 * so applyExcludeFilter() works uniformly.
 */
export function excludeConditionsFromFlat(
  excludedCompanies: string[] | null | undefined,
  exclusionKeywords: string[] | null | undefined,
): SearchIntentCondition[] {
  const conditions: SearchIntentCondition[] = [];
  for (const c of excludedCompanies ?? []) {
    if (c?.trim()) {
      conditions.push({
        category: "company",
        disposition: "exclude",
        value: c,
      });
    }
  }
  for (const k of exclusionKeywords ?? []) {
    if (k?.trim()) {
      conditions.push({ category: "title", disposition: "exclude", value: k });
    }
  }
  return conditions;
}
