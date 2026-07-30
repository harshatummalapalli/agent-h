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
  current_employer_company_name?: string | null;
  title?: string | null;
  headline?: string | null;
  [key: string]: unknown;
};

/**
 * Hard-filter candidates against company and title exclude conditions.
 *
 * Checks (all case-insensitive substring):
 *   company/exclude → current_employer_company_name
 *   title/exclude   → title OR headline
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
    const company = (candidate.current_employer_company_name ?? "").toLowerCase();
    const title = (candidate.title ?? "").toLowerCase();
    const headline = (candidate.headline ?? "").toLowerCase();

    if (companyExcludes.some((ex) => ex && company.includes(ex))) return false;
    if (titleExcludes.some((ex) => ex && (title.includes(ex) || headline.includes(ex)))) return false;
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
      conditions.push({ category: "company", disposition: "exclude", value: c });
    }
  }
  for (const k of exclusionKeywords ?? []) {
    if (k?.trim()) {
      conditions.push({ category: "title", disposition: "exclude", value: k });
    }
  }
  return conditions;
}
