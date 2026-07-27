// Crustdata capability manifest — versioned, authoritative catalog of what
// the Crustdata person-search API can and cannot express as hard filters.
//
// This is the single source of truth for LLM prompts (resolve-search-intent)
// AND the deterministic validator (crustdataIntentValidator). Both import
// this module so they always reason about the same surface.
//
// Field paths and operators taken from:
//   POST https://api.crustdata.com/person/search  (x-api-version: 2025-11-01)
//   Live OpenAPI spec fetched + live API testing 2026-07-23/24.
//
// No Deno-specific imports — Vitest-compatible.

export const MANIFEST_VERSION = "1.0.0";

// ─── Field paths ──────────────────────────────────────────────────────────────

export const CRUSTDATA_FIELDS = {
  currentTitle: "experience.employment_details.current.title",
  pastTitle: "experience.employment_details.past.title",
  currentCompanyName: "experience.employment_details.current.company_name",
  pastCompanyName: "experience.employment_details.past.company_name",
  currentSeniorityLevel: "experience.employment_details.current.seniority_level",
  currentCompanyHeadcount: "experience.employment_details.current.company_headcount_latest",
  locationCity: "basic_profile.location.city",
  locationCountry: "basic_profile.location.country",
  skills: "skills.professional_network_skills",
  yearsOfExperience: "years_of_experience",
} as const;

// ─── Operators ────────────────────────────────────────────────────────────────
//
// Spec enum (fetched live 2026-07-23):
//   =, !=, <, =<, >, =>, in, not_in, (.), (!), [.], geo_distance, geo_exclude
//
// Live-vs-spec discrepancy (disclosed, not silently fixed):
//   • Spec says "=<" and "=>" (not "<=" / ">="); live API also accepts "<="
//     and ">=" but spec explicitly warns to use "=<" / "=>". We emit spec
//     form (=<, =>) for numeric range filters.
//   • "has_all" observed to work live (nested-array cross-element match) but
//     is NOT in the live-fetched spec enum — kept in type union for awareness,
//     not emitted in any current filter.
//
// Operators used by this integration:
//   "="       — exact match (country field)
//   "!="      — exact exclusion (single value)
//   "not_in"  — exclusion set (array of values)
//   "(.)"     — contains / phrase-match (title, seniority, city, skills)
//   "(!)"     — not-contains (exclusion keywords in title/company)
//   "=<"      — ≤ (years_of_experience upper bound)
//   "=>"      — ≥ (years_of_experience lower bound)

export type CrustdataOperator =
  | "="
  | "!="
  | "=<"
  | "=>"
  | "not_in"
  | "(.)"
  | "(!)"
  | "in";

// ─── Phrase decomposition rule ────────────────────────────────────────────────
//
// WHY: Crustdata's "(.)" operator does LITERAL, non-word-split phrase matching.
//   A value like "AI Engineer|.NET AI|Azure OpenAI Engineer" returned 0 results
//   even though relevant candidates exist, because none of those exact 3-word
//   phrases appear verbatim in indexed titles. "AI Engineer" alone (2 words)
//   returned correct matches in the same live test (2026-07-24).
//
// RULE: Any phrase longer than SHINGLE_SIZE (2) words is broken into overlapping
//   2-word shingles. Short phrases (≤2 words) are kept as-is. Multiple
//   decomposed terms are combined as an explicit OR-group — never pipe-joined
//   inside a single condition value.
//
// WHY NOT pipe-join: live bisection 2026-07-24 confirmed pipe-joining multiple
//   title alternatives collapsed ANDed searches to zero even when each term
//   alone matched millions of profiles.

export const PHRASE_DECOMPOSITION = {
  shingleSize: 2,
  maxTerms: 6,
  rule: "Split compound phrases on /|&, and OR/AND keywords; shingle phrases > shingleSize words into overlapping shingleSize-word windows; combine as OR-group of separate (.) conditions — never pipe-join alternatives inside one value.",
} as const;

// ─── What Crustdata CAN enforce as hard filters ───────────────────────────────

export const CAN_FILTER = [
  "current job title (contains, phrase-match with decomposition)",
  "past job title (contains, phrase-match with decomposition)",
  "current company name (contains or exact)",
  "past company name (contains or exact)",
  "current seniority level (contains — vocabulary unconfirmed, use fuzzy (.); see SENIORITY_NOTE)",
  "location city (contains, phrase-match)",
  "location country (exact = match for known countries)",
  "skills (professional_network_skills, contains)",
  "years of experience (numeric range, =< and =>)",
  "current company headcount (numeric range)",
  "excluded titles via (!) not-contains",
  "excluded companies via (!) not-contains on company_name",
  "excluded keywords via (!) not-contains on title",
] as const;

// Seniority note: the seniority_level field exists and is real, but its exact
// value vocabulary was NOT confirmed live. We use "(.)" (contains, fuzzy) rather
// than "=" or "in" to tolerate vocabulary mismatches. The mapping
// (intern→["Intern"], senior→["Senior"], etc.) mirrors SENIORITY_TO_CRUSTDATA_TERMS
// in crustdataQueryBuilder.ts; mid_level is left unmapped (no honest equivalent).

// ─── What Crustdata CANNOT express as a hard filter ──────────────────────────
//
// These must be routed to unenforceable_constraints — never silently dropped
// or forced into a wrong-shaped filter (that risks zero-result over-narrowing).

export const CANNOT_FILTER = [
  {
    category: "skill_recency",
    description: "Skill recency or recency of experience (e.g. 'used React in last 2 years', '5 years in Go')",
    reason: "No date-of-skill or skill-duration field in the Crustdata person-search API. Only presence/absence via the skills field.",
  },
  {
    category: "ranking_soft",
    description: "Soft/ranking-only preferences (e.g. 'prefer candidates with startup background', 'nice to have ML experience')",
    reason: "Crustdata filters are hard AND conditions only; no boost/should/ranking operators exist in the filter API.",
  },
  {
    category: "school_degree",
    description: "Education: specific school, degree type, or GPA",
    reason: "No education field in the confirmed Crustdata PersonSearchCondition enum.",
  },
  {
    category: "compensation",
    description: "Salary range, compensation expectations, equity preferences",
    reason: "No compensation field in the Crustdata person-search API.",
  },
  {
    category: "availability",
    description: "Open to work, actively looking, notice period",
    reason: "No availability signal in the Crustdata person-search API.",
  },
] as const;

// ─── Exported manifest ────────────────────────────────────────────────────────

export const CRUSTDATA_CAPABILITY_MANIFEST = {
  version: MANIFEST_VERSION,
  fields: CRUSTDATA_FIELDS,
  operators: {
    exact: "=",
    notEqual: "!=",
    contains: "(.)",
    notContains: "(!)",
    notIn: "not_in",
    lte: "=<",
    gte: "=>",
  },
  phraseDecomposition: PHRASE_DECOMPOSITION,
  canFilter: CAN_FILTER,
  cannotFilter: CANNOT_FILTER,
} as const;

export type CrustdataCapabilityManifest = typeof CRUSTDATA_CAPABILITY_MANIFEST;
