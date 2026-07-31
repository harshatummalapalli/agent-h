// Crustdata capability manifest — versioned, authoritative catalog of what
// the Crustdata person-search API can and cannot express as hard filters.
//
// This is the single source of truth for LLM prompts (resolve-search-intent)
// AND the deterministic validator (crustdataIntentValidator). Both import
// this module so they always reason about the same surface.
//
// Field paths and operators taken from:
//   POST https://api.crustdata.com/person/search  (x-api-version: 2025-11-01)
//   Autocomplete: POST https://api.crustdata.com/person/search/autocomplete
//   Live OpenAPI spec fetched + live API testing 2026-07-23/24.
//   Full field reference confirmed from docs.crustdata.com 2026-07-29.
//
// No Deno-specific imports — Vitest-compatible.

export const MANIFEST_VERSION = "2.0.0";

// ─── Field paths ──────────────────────────────────────────────────────────────
//
// All paths confirmed filterable per Crustdata Person Search reference
// (x-api-version: 2025-11-01). Notes on value formats are in JSDoc.

export const CRUSTDATA_FIELDS = {
  // ── Title fields ──────────────────────────────────────────────────────────
  currentTitle: "experience.employment_details.current.title",
  pastTitle: "experience.employment_details.past.title",

  // ── Company fields (current employer) ─────────────────────────────────────
  currentCompanyName: "experience.employment_details.current.company_name",
  currentSeniorityLevel:
    "experience.employment_details.current.seniority_level",
  currentCompanyHeadcount:
    "experience.employment_details.current.company_headcount_latest",
  /**
   * Current employer industries (string[]). Use (.) contains — multi-value via OR-group.
   * Values are industry labels e.g. "Computer Software", "Financial Services".
   */
  currentCompanyIndustries:
    "experience.employment_details.current.company_industries",
  /**
   * Current employer HQ country. Value format: ISO 3166-1 alpha-3 code
   * e.g. "USA", "IND", "GBR". NOT a full country name.
   */
  currentCompanyHQCountry:
    "experience.employment_details.current.company_headquarters_country",
  /** Current employer website domain (bare, no scheme): e.g. "stripe.com" */
  currentCompanyWebsiteDomain:
    "experience.employment_details.current.company_website_domain",
  currentFunctionCategory:
    "experience.employment_details.current.function_category",

  // ── Company fields (past employer) ────────────────────────────────────────
  pastCompanyName: "experience.employment_details.past.company_name",

  // ── Location (person) ─────────────────────────────────────────────────────
  locationCity: "basic_profile.location.city",
  locationState: "basic_profile.location.state",
  locationCountry: "basic_profile.location.country",
  locationContinent: "basic_profile.location.continent",

  // ── Skills ───────────────────────────────────────────────────────────────
  /** Filter-only (not returned in search response). Use (.) per skill. */
  skills: "skills.professional_network_skills",

  // ── Experience ────────────────────────────────────────────────────────────
  yearsOfExperience: "years_of_experience",

  // ── Basic profile ─────────────────────────────────────────────────────────
  headline: "basic_profile.headline",
  /**
   * Spoken languages (string[]). Use (.) per language name
   * e.g. "English", "Spanish". Case-insensitive.
   */
  languages: "basic_profile.languages",

  // ── Professional network ──────────────────────────────────────────────────
  /** LinkedIn connection count (integer). Use => / =< operators. */
  connections: "professional_network.connections",
  /**
   * Open-to signal codes (string[]). Use "in" operator with closed enum values:
   * "CAREER_INTEREST", "HIRING_MANAGER", "VOLUNTEERING".
   */
  openToCards: "professional_network.open_to_cards",

  // ── Education (confirmed filterable per Crustdata docs 2026-07-29) ────────
  /** School name. Use (.) phrase-match. */
  educationSchool: "education.schools.school",
  /** Degree name e.g. "Bachelor of Science", "MBA". Use (.) phrase-match. */
  educationDegree: "education.schools.degree",
  /** Field of study e.g. "Computer Science", "Finance". Use (.) phrase-match. */
  educationFieldOfStudy: "education.schools.field_of_study",
} as const;

// ─── Operators ────────────────────────────────────────────────────────────────
//
// Spec enum (fetched live 2026-07-23, confirmed 2026-07-29):
//   =, !=, <, =<, >, =>, in, not_in, (.), (!), [.], geo_distance, geo_exclude
//   all_of (cross-element nested-array), has_all
//
// Operators used by this integration:
//   "="       — exact match (country field)
//   "!="      — exact exclusion (single value)
//   "not_in"  — exclusion set (array of values)
//   "(.)"     — contains / phrase-match (title, seniority, city, skills, etc.)
//   "(!)"     — not-contains (exclusion keywords in title/company/headline)
//   "=<"      — ≤ (years_of_experience, connections upper bound)
//   "=>"      — ≥ (years_of_experience, connections lower bound)
//   "in"      — value in list (open_to_cards enum)

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
  "location state / region (contains, phrase-match)",
  "location country (exact = match for known countries; full country name)",
  "location continent (contains)",
  "skills (professional_network_skills, contains per skill)",
  "years of experience (numeric range, =< and =>)",
  "current company headcount (numeric range)",
  "current company industries (string[], contains per industry label)",
  "current company HQ country (exact = match, ISO 3166-1 alpha-3 code: USA, IND, GBR)",
  "current company website domain (bare domain e.g. stripe.com)",
  "current function category (contains)",
  "profile headline (contains / not-contains)",
  "spoken languages (basic_profile.languages, contains per language name)",
  "LinkedIn connection count (numeric range => / =<)",
  "open-to signal codes (in enum: CAREER_INTEREST, HIRING_MANAGER, VOLUNTEERING)",
  "education school name (contains, phrase-match)",
  "education degree (contains, phrase-match)",
  "education field of study (contains, phrase-match)",
  "excluded titles via (!) not-contains",
  "excluded companies via (!) not-contains on company_name",
  "excluded keywords via (!) not-contains on title or headline",
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
    category: "compensation",
    description: "Salary range, compensation expectations, equity preferences",
    reason: "No compensation field in the Crustdata person-search API.",
  },
  {
    category: "availability",
    description: "Open to work, actively looking, notice period",
    reason: "open_to_cards covers CAREER_INTEREST / HIRING_MANAGER / VOLUNTEERING codes only — no freeform availability signal.",
  },
] as const;

// ─── Autocomplete ─────────────────────────────────────────────────────────────
//
// Endpoint: POST https://api.crustdata.com/person/search/autocomplete
// Body: { field: string, query: string, limit?: number, filters?: ... }
// Response: { suggestions: [{ value: string }] }
// Free tier — no extra credit cost per call.

export const CRUSTDATA_AUTOCOMPLETE_URL =
  "https://api.crustdata.com/person/search/autocomplete";

/** Fields that support autocomplete (confirmed from Crustdata docs 2026-07-29). */
export const AUTOCOMPLETE_SUPPORTED_FIELDS = [
  CRUSTDATA_FIELDS.currentTitle,
  CRUSTDATA_FIELDS.locationCountry,
  CRUSTDATA_FIELDS.locationCity,
  CRUSTDATA_FIELDS.locationState,
  CRUSTDATA_FIELDS.currentCompanyName,
  CRUSTDATA_FIELDS.currentCompanyIndustries,
  CRUSTDATA_FIELDS.skills,
  CRUSTDATA_FIELDS.educationSchool,
  CRUSTDATA_FIELDS.languages,
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
    in: "in",
  },
  phraseDecomposition: PHRASE_DECOMPOSITION,
  canFilter: CAN_FILTER,
  cannotFilter: CANNOT_FILTER,
  autocomplete: {
    url: CRUSTDATA_AUTOCOMPLETE_URL,
    supportedFields: AUTOCOMPLETE_SUPPORTED_FIELDS,
  },
} as const;

export type CrustdataCapabilityManifest = typeof CRUSTDATA_CAPABILITY_MANIFEST;
