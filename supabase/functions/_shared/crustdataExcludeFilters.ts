// crustdataExcludeFilters.ts — single shared implementation of Crustdata
// "(!)" exclude logic, used by both crustdataQueryBuilder.ts (discovery)
// and crustdataClient.ts (calibration-session).
//
// Before this module existed, each file maintained its own inline exclude loop,
// causing the two paths to diverge silently. Any future change to exclude
// behavior (operator, field paths, trimming) now has one place to update.
//
// No Deno-specific imports — Vitest-safe.

// ── Field paths (mirrors CRUSTDATA_FIELDS in crustdataQueryBuilder.ts) ────
// Authoritative copy of the three fields used for hard-exclusion so callers
// don't need to import crustdataQueryBuilder.ts (which would create a circular
// dependency from _shared back into source-candidates-discovery/).

export const EXCLUDE_FIELDS = {
  currentCompanyName: "experience.employment_details.current.company_name",
  currentTitle: "experience.employment_details.current.title",
  skills: "skills.professional_network_skills",
} as const;

// ── Core condition type ───────────────────────────────────────────────────

export type ExcludeCondition = {
  field: string;
  type: "(!)";
  value: string;
};

// ── Broad union that both callers' condition arrays satisfy structurally ──
// crustdataQueryBuilder uses CrustdataFilterCondition | CrustdataFilterGroup;
// crustdataClient uses its local Condition | Group.  Both are structurally
// assignable to this wider union, so appendCompanyAndKeywordExcludes can
// accept either without a cast at the call site.
type AnyFilterItem =
  | {
      field: string;
      type: string;
      value: string | number | (string | number)[];
    }
  | { op: string; conditions: unknown[] };

// ── buildExcludeCondition ─────────────────────────────────────────────────

/**
 * Build a single Crustdata "(!)" (not-contains) condition.
 *
 * "(!)" is a literal substring-not-contains operator (case-insensitive,
 * confirmed live against Crustdata). No shingle decomposition is applied:
 * an exclude should stay precise — excluding too broadly is the wrong
 * failure direction for a hard must_not.
 */
export function buildExcludeCondition(
  field: string,
  phrase: string,
): ExcludeCondition {
  return { field, type: "(!)", value: phrase.trim() };
}

// ── appendCompanyAndKeywordExcludes ───────────────────────────────────────

/**
 * Push "(!)" exclude conditions into `conditions` for every excluded company
 * and exclusion keyword.
 *
 * Company → currentCompanyName "(!)"
 * Keyword → currentTitle "(!)" AND skills "(!)"  (same dual-field logic as
 *   crustdataQueryBuilder lines ~517–537 and crustdataClient's prior inline loop)
 *
 * Blank/empty strings are silently skipped.
 * Null or undefined arrays are treated as empty.
 */
export function appendCompanyAndKeywordExcludes(
  conditions: AnyFilterItem[],
  params: {
    excludedCompanies?: string[] | null;
    exclusionKeywords?: string[] | null;
  },
): void {
  const { excludedCompanies, exclusionKeywords } = params;

  for (const company of excludedCompanies ?? []) {
    if (company.trim()) {
      conditions.push(
        buildExcludeCondition(EXCLUDE_FIELDS.currentCompanyName, company),
      );
    }
  }

  for (const keyword of exclusionKeywords ?? []) {
    if (keyword.trim()) {
      conditions.push(
        buildExcludeCondition(EXCLUDE_FIELDS.currentTitle, keyword),
      );
      conditions.push(buildExcludeCondition(EXCLUDE_FIELDS.skills, keyword));
    }
  }
}
