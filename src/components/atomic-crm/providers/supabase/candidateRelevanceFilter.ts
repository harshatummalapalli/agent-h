// Agent H (2026-07-20): relevance pre-filter for auto-saved sourcing results.
//
// continueSourcingForDeal (dataProvider.ts) used to auto-save every result
// from the free-portal/Exa search with no relevance check. Live testing on
// the AI Engineer role surfaced Hugging Face/Kaggle model-author profiles
// that only matched on the loose keyword "Python" -- nothing else about
// the role. This module is the guardrail: a candidate must clear the
// deal's own required_skills/must_have_keywords, and must not trip
// excluded_companies/exclusion_keywords, before it's eligible to auto-save.
//
// Deliberately reuses criteria the recruiter already set on the role
// (deals.required_skills etc.) rather than inventing a new relevance
// concept -- see the "Genuine schema gaps" note in the sourcing
// architecture proposal for why deals already carries this IR.

export type SourcedCandidateForRelevanceCheck = {
  job_title?: string;
  job_company_name?: string;
  skills?: string[];
};

export type DealRelevanceCriteria = {
  required_skills?: string[] | null;
  must_have_keywords?: string[] | null;
  exclusion_keywords?: string[] | null;
  excluded_companies?: string[] | null;
};

const normalize = (value: string) => value.trim().toLowerCase();

const buildSearchableText = (candidate: SourcedCandidateForRelevanceCheck) =>
  normalize(
    [candidate.job_title, ...(candidate.skills ?? [])]
      .filter(Boolean)
      .join(" "),
  );

const anyTermMatches = (terms: string[], text: string) =>
  terms.some((term) => term.trim().length > 0 && text.includes(normalize(term)));

/**
 * Returns true if a sourced candidate is relevant enough to the deal's own
 * criteria to be auto-saved without recruiter review.
 *
 * Rules:
 * - excluded_companies / exclusion_keywords: an exact-ish match disqualifies
 *   the candidate outright, regardless of anything else.
 * - required_skills / must_have_keywords: if the deal has any of these set,
 *   the candidate must match at least one (across either list combined) in
 *   its title or skills. If the deal has neither set, no positive filter is
 *   applied -- this matches how these fields already work as optional
 *   criteria elsewhere (e.g. Coresignal search), not a new requirement.
 */
export function isCandidateRelevantToDeal(
  candidate: SourcedCandidateForRelevanceCheck,
  deal: DealRelevanceCriteria,
): boolean {
  const excludedCompanies = (deal.excluded_companies ?? []).filter(Boolean);
  if (
    candidate.job_company_name &&
    excludedCompanies.length > 0 &&
    excludedCompanies.some((company) =>
      normalize(candidate.job_company_name!).includes(normalize(company)),
    )
  ) {
    return false;
  }

  const exclusionKeywords = (deal.exclusion_keywords ?? []).filter(Boolean);
  const searchableText = buildSearchableText(candidate);
  if (exclusionKeywords.length > 0 && anyTermMatches(exclusionKeywords, searchableText)) {
    return false;
  }

  const positiveCriteria = [
    ...(deal.required_skills ?? []),
    ...(deal.must_have_keywords ?? []),
  ].filter(Boolean);

  if (positiveCriteria.length === 0) {
    // Role has no required_skills/must_have_keywords set -- nothing to
    // filter on beyond exclusions, so don't block the save.
    return true;
  }

  return anyTermMatches(positiveCriteria, searchableText);
}
