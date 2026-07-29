// crustdataFilterCompiler — pure compiler: UI filter draft → Crustdata filter tree.
//
// Takes a structured FilterDraft (typed form fields from the Build Search page) and
// compiles it to a Crustdata boolean filter tree suitable for POST /person/search.
//
// Unlike crustdataIntentValidator (which maps SearchIntent conditions → filters),
// this module maps explicit form fields directly — no NLP, no ambiguity, pure
// field-by-field translation. Unit-testable with no Deno imports.
//
// Re-uses CRUSTDATA_FIELDS from the capability manifest.
//
// Title matching: Crustdata `(.)` is case-insensitive ALL-WORDS (every word must
// appear, any order). We send each user title as one full-phrase condition —
// NOT 2-word shingle ORs. Shingle-OR turned "AI Software Engineer" into
// ("AI Software" OR "Software Engineer"), which matched every Software Engineer.
//
// Multi-value boolean semantics (documented in UI helper text):
//   currentTitlesInclude   — OR (any matching title counts)
//   currentTitlesExclude   — AND (all exclusions enforced)
//   pastTitlesInclude      — OR
//   locationCountries      — OR (candidate in ANY of the listed countries)
//   locationCities         — OR
//   locationStates         — OR
//   skillsRequired         — AND (every listed skill is mandatory)
//   skillsNiceToHave       — OR (any matching skill counts)
//   currentCompaniesInclude — OR
//   currentCompaniesExclude — AND
//   pastCompaniesInclude   — OR
//   companyIndustries      — OR
//   educationSchools       — OR
//   educationDegrees       — OR
//   educationFieldsOfStudy — OR
//   headlineKeywordsInclude — OR
//   headlineKeywordsExclude — AND
//   languages              — OR (any listed language)
//   currentSeniorities     — OR

import { CRUSTDATA_FIELDS } from "./crustdataCapabilityManifest.ts";
import { COUNTRY_ALIASES } from "./crustdataClient.ts";

// ─── Re-exported types (callers use these, avoids duplicate declarations) ─────

/** Value shape for geo_distance / geo_exclude conditions. */
export type CrustdataGeoValue = {
  location?: string;
  lat_lng?: [number, number];
  distance: number;
  unit?: "km" | "mi" | "miles" | "m" | "meters" | "ft" | "feet";
};

export type CrustdataCondition = {
  field: string;
  type:
    | "="
    | "!="
    | "(.)"
    | "(!)"
    | "not_in"
    | "=<"
    | "=>"
    | "in"
    | "[.]"
    | "geo_distance"
    | "geo_exclude";
  value: string | number | boolean | string[] | number[] | CrustdataGeoValue;
};

export type CrustdataGroup = {
  op: "and" | "or";
  conditions: Array<CrustdataCondition | CrustdataGroup>;
};

export type CrustdataFilters = CrustdataCondition | CrustdataGroup;

// ─── FilterDraft — the structured form the UI submits ─────────────────────────

export type FilterDraft = {
  // ── Titles ────────────────────────────────────────────────────────────────
  /** Include terms for current title. Each non-empty string → a (.) condition; all OR'd. */
  currentTitlesInclude?: string[];
  /** Keywords that must NOT appear in current title. Each → (!) condition; all AND'd. */
  currentTitlesExclude?: string[];
  /** Include terms for past title. Each non-empty string → a (.) condition; all OR'd. */
  pastTitlesInclude?: string[];

  // ── Location ──────────────────────────────────────────────────────────────
  /**
   * Countries (multi). Each → exact = condition; all OR'd.
   * Use full country names e.g. "India", "United States". Alias-normalised.
   * Supersedes the single-value locationCountry for new code; both are supported.
   */
  locationCountries?: string[];
  /**
   * Cities (multi). Each → (.) condition; all OR'd.
   * @deprecated Use locationCities for new code.
   */
  locationCountry?: string;
  /** City/metro contains-match (single). @deprecated Use locationCities for new code. */
  locationCity?: string;
  /** Cities (multi). Each → (.) condition; all OR'd. */
  locationCities?: string[];
  /** States / regions (multi). Each → (.) condition; all OR'd. */
  locationStates?: string[];

  // ── Skills ────────────────────────────────────────────────────────────────
  /** Must-have skills. Each skill → a (.) condition; all AND'd (every skill required). */
  skillsRequired?: string[];
  /** Nice-to-have / any-of skills. Single OR-group of (.) conditions. */
  skillsNiceToHave?: string[];

  // ── Experience / seniority ────────────────────────────────────────────────
  /**
   * Seniority level (single). Fuzzy (.) match.
   * @deprecated Use currentSeniorities for new code.
   */
  seniority?: string;
  /** Current seniority levels (multi OR). Each → (.) condition. */
  currentSeniorities?: string[];
  /** Minimum years of experience (inclusive). Emits => condition. */
  yoeMin?: number | null;
  /** Maximum years of experience (inclusive). Emits =< condition. */
  yoeMax?: number | null;

  // ── Companies ─────────────────────────────────────────────────────────────
  /** Current company names to include. Each → (.) condition; all OR'd. */
  currentCompaniesInclude?: string[];
  /** Current company names to exclude. Each → (!) condition; all AND'd. */
  currentCompaniesExclude?: string[];
  /** Past company names to include. Each → (.) condition; all OR'd. */
  pastCompaniesInclude?: string[];
  /**
   * Company industries to include. Each → (.) condition; all OR'd.
   * Values are industry labels e.g. "Computer Software", "Financial Services".
   */
  companyIndustries?: string[];
  /**
   * Current employer HQ country. Exact = match.
   * Value format: ISO 3166-1 alpha-3 code e.g. "USA", "IND", "GBR".
   */
  companyHQCountry?: string;
  /** Minimum current company headcount. Emits => condition. */
  headcountMin?: number | null;
  /** Maximum current company headcount. Emits =< condition. */
  headcountMax?: number | null;

  // ── Education ─────────────────────────────────────────────────────────────
  /** School names (multi OR). Each → (.) condition on education.schools.school. */
  educationSchools?: string[];
  /** Degree names (multi OR). Each → (.) condition on education.schools.degree. */
  educationDegrees?: string[];
  /** Fields of study (multi OR). Each → (.) condition on education.schools.field_of_study. */
  educationFieldsOfStudy?: string[];

  // ── Headline & other ──────────────────────────────────────────────────────
  /** Headline keywords to include (multi OR). Each → (.) condition on basic_profile.headline. */
  headlineKeywordsInclude?: string[];
  /** Headline keywords to exclude (multi AND). Each → (!) condition on basic_profile.headline. */
  headlineKeywordsExclude?: string[];
  /**
   * Spoken languages (multi OR). Each → (.) condition on basic_profile.languages.
   * Use full language names e.g. "English", "Spanish", "Hindi".
   */
  languages?: string[];
  /**
   * Minimum LinkedIn connections count (inclusive). Emits => condition.
   * Uses professional_network.connections field.
   */
  connectionsMin?: number | null;
  /**
   * When true, require Crustdata's recently_changed_jobs flag
   * (people who recently started a new role).
   */
  recentlyChangedJobs?: boolean;

  // ── Title match mode ──────────────────────────────────────────────────────
  /**
   * Controls the operator used for currentTitlesInclude conditions.
   * "all_words" (default) → (.) — all words must appear, any order.
   * "exact_phrase" → [.] — words must appear in exact sequence.
   */
  titleMatchMode?: "all_words" | "exact_phrase";

  // ── Geo ───────────────────────────────────────────────────────────────────
  /** Center location string for geo radius filter (e.g. "San Francisco, CA"). */
  geoNear?: string | null;
  /** Radius distance for geo filter. Requires geoNear. */
  geoDistance?: number | null;
  /** Distance unit (default "mi"). */
  geoUnit?: "km" | "mi";
  /**
   * When true, uses geo_exclude (exclude within radius) instead of geo_distance
   * (include within radius).
   */
  geoExcludeNear?: boolean;

  // ── Location continents ───────────────────────────────────────────────────
  /** Continents (multi OR). Each → (.) condition on locationContinent. */
  locationContinents?: string[];

  // ── Function categories ───────────────────────────────────────────────────
  /** Current function categories (multi OR). Each → (.) on currentFunctionCategory. */
  functionCategories?: string[];

  // ── Employment types ──────────────────────────────────────────────────────
  /** Current employment types (multi OR). Each → (.) on currentEmploymentType. */
  employmentTypes?: string[];

  // ── Company website domains ───────────────────────────────────────────────
  /**
   * Current employer website domains (bare, no scheme). e.g. "stripe.com".
   * Single → = condition; multiple → in condition.
   */
  currentCompanyDomains?: string[];

  // ── Past company exclude ──────────────────────────────────────────────────
  /** Past company names to exclude. Each → (!) condition; all AND'd. */
  pastCompaniesExclude?: string[];

  // ── Open-to cards ─────────────────────────────────────────────────────────
  /**
   * Open-to signal codes (enum multi). Emits a single "in" condition.
   * Values: "CAREER_INTEREST", "HIRING_MANAGER", "VOLUNTEERING".
   */
  openToCards?: Array<"CAREER_INTEREST" | "HIRING_MANAGER" | "VOLUNTEERING">;

  // ── Followers / connections ───────────────────────────────────────────────
  /** Maximum LinkedIn connections count (inclusive). Emits =< condition. */
  connectionsMax?: number | null;
  /** Minimum LinkedIn follower count (inclusive). Emits => on followers field. */
  followersMin?: number | null;

  // ── Sort ──────────────────────────────────────────────────────────────────
  /**
   * Field to sort results by. Must be one of the allowlisted sortable fields
   * (see SORTABLE_FIELDS). Not compiled into filters; exported via CompileResult.
   */
  sortField?: string | null;
  /** Sort order (default "desc"). */
  sortOrder?: "asc" | "desc";
};

// ─── Phrase helpers ───────────────────────────────────────────────────────────

/** Normalize a user phrase: strip & punctuation noise, collapse whitespace. */
function normalizePhrase(raw: string): string {
  return raw
    .trim()
    .replace(/\s*&\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Expand a skill chip into OR alternatives Crustdata is likely to index.
 *
 * Autocomplete / typed values often diverge from indexed forms:
 *   - "Lang Chain" vs "LangChain" (space vs camelCase)
 *   - "Retrieval-Augmented Generation (RAG)" → full phrase + acronym
 *   - "LangChain / LangGraph" → slash alternatives
 *   - hyphens vs spaces
 *
 * Within one chip → OR; across must-have chips → AND (caller).
 */
function expandSkillAlternatives(raw: string): string[] {
  const alts = new Set<string>();

  const add = (s: string) => {
    const t = s.trim();
    if (t.length > 0) alts.add(t);
  };

  for (const part of raw.split(/\s*[/|&]\s*/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    add(trimmed);

    // "Foo Bar (FB)" → "Foo Bar" + "FB"
    const paren = trimmed.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (paren) {
      add(paren[1]);
      add(paren[2]);
    }

    // "Lang Chain" → also "LangChain" (indexed camelCase / glued form)
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words.length <= 4) {
      add(words.join(""));
    }

    // Hyphen variants: "Retrieval-Augmented" ↔ "Retrieval Augmented"
    if (trimmed.includes("-")) {
      add(trimmed.replace(/-/g, " "));
      add(trimmed.replace(/-/g, ""));
    }
  }

  return Array.from(alts);
}

// ─── Condition builders ───────────────────────────────────────────────────────

function contains(field: string, value: string): CrustdataCondition {
  return { field, type: "(.)", value };
}

function notContains(field: string, value: string): CrustdataCondition {
  return { field, type: "(!)", value };
}

function exact(field: string, value: string): CrustdataCondition {
  return { field, type: "=", value };
}

function gte(field: string, value: number): CrustdataCondition {
  return { field, type: "=>", value };
}

function lte(field: string, value: number): CrustdataCondition {
  return { field, type: "=<", value };
}

/** Wrap a single condition or array into an OR-group. Returns the condition if there's
 *  only one (no redundant wrapping). Returns null for an empty array. */
function orGroup(
  conds: Array<CrustdataCondition | CrustdataGroup>,
): CrustdataCondition | CrustdataGroup | null {
  if (conds.length === 0) return null;
  if (conds.length === 1) return conds[0];
  return { op: "or", conditions: conds };
}

/**
 * OR-group of full-phrase conditions — one condition per user term.
 * Used for titles/cities/education. Does NOT shingle-decompose (see file header).
 * @param matchType "(.) " (default, all-words) or "[.]" (exact phrase, for titles when titleMatchMode="exact_phrase")
 */
function phraseOrGroup(
  field: string,
  terms: string[],
  matchType: "(.)" | "[.]" = "(.)",
): CrustdataCondition | CrustdataGroup | null {
  const cleaned = terms.map(normalizePhrase).filter(Boolean);
  if (cleaned.length === 0) return null;
  if (matchType === "[.]") {
    return orGroup(
      cleaned.map((t) => ({ field, type: "[.]" as const, value: t })),
    );
  }
  return orGroup(cleaned.map((t) => contains(field, t)));
}

/**
 * Build a simple OR-group of (.) conditions for a list of terms (trim only).
 * Used for short-valued fields like languages, industries.
 */
function simpleOrGroup(
  field: string,
  terms: string[],
): CrustdataCondition | CrustdataGroup | null {
  const cleaned = terms.map((t) => t.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  return orGroup(cleaned.map((t) => contains(field, t)));
}

/**
 * Build an OR-group of exact (=) conditions for multiple values of a scalar field.
 */
function exactOrGroup(
  field: string,
  values: string[],
): CrustdataCondition | CrustdataGroup | null {
  const cleaned = values.map((v) => v.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  return orGroup(cleaned.map((v) => exact(field, v)));
}

// ─── Sortable fields allowlist ────────────────────────────────────────────────

/** Fields Crustdata supports as sort keys (confirmed 2026-07-29). */
const SORTABLE_FIELDS = new Set([
  "recently_changed_jobs",
  "professional_network.connections",
  "professional_network.followers",
  "years_of_experience_raw",
  "experience.employment_details.start_date",
]);

// ─── Main compiler ────────────────────────────────────────────────────────────

export type CompileResult = {
  /** The compiled Crustdata filter tree. Null when the draft is empty. */
  filters: CrustdataGroup | null;
  /** Human-readable summary of which filter groups were applied. */
  appliedGroups: string[];
  /** Sort spec when sortField is set to an allowlisted field. */
  sorts?: Array<{ field: string; order: "asc" | "desc" }>;
};

/**
 * Compile a FilterDraft into a Crustdata boolean filter tree.
 *
 * Returns { filters, appliedGroups }. `filters` is null when the draft
 * is effectively empty (all fields blank / undefined / empty arrays).
 */
export function compileFilterDraft(draft: FilterDraft): CompileResult {
  const topLevel: Array<CrustdataCondition | CrustdataGroup> = [];
  const appliedGroups: string[] = [];

  // ── Current title include ────────────────────────────────────────────────
  const titleIncludes = (draft.currentTitlesInclude ?? []).filter(Boolean);
  if (titleIncludes.length > 0) {
    const titleMatchType =
      draft.titleMatchMode === "exact_phrase" ? "[.]" : ("(.)" as const);
    const g = phraseOrGroup(
      CRUSTDATA_FIELDS.currentTitle,
      titleIncludes,
      titleMatchType,
    );
    if (g) {
      topLevel.push(g);
      appliedGroups.push("current title include");
    }
  }

  // ── Current title exclude (keyword exclusions) ───────────────────────────
  const titleExcludes = (draft.currentTitlesExclude ?? []).filter(Boolean);
  for (const kw of titleExcludes) {
    const trimmed = kw.trim();
    if (trimmed) {
      topLevel.push(notContains(CRUSTDATA_FIELDS.currentTitle, trimmed));
    }
  }
  if (titleExcludes.length > 0) appliedGroups.push("current title exclude");

  // ── Past title include ───────────────────────────────────────────────────
  const pastTitles = (draft.pastTitlesInclude ?? []).filter(Boolean);
  if (pastTitles.length > 0) {
    const g = phraseOrGroup(CRUSTDATA_FIELDS.pastTitle, pastTitles);
    if (g) {
      topLevel.push(g);
      appliedGroups.push("past title include");
    }
  }

  // ── Location: countries (multi, exact, alias-normalised, OR) ────────────
  const countries = (draft.locationCountries ?? [])
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => COUNTRY_ALIASES[c.toLowerCase()] ?? c);
  if (countries.length > 0) {
    const g = exactOrGroup(CRUSTDATA_FIELDS.locationCountry, countries);
    if (g) {
      topLevel.push(g);
      appliedGroups.push("countries");
    }
  }

  // ── Location: single country (legacy, alias-normalised) ─────────────────
  // Kept for backward compatibility; superseded by locationCountries.
  const countryRaw = draft.locationCountry?.trim();
  if (countryRaw && countries.length === 0) {
    const country = COUNTRY_ALIASES[countryRaw.toLowerCase()] ?? countryRaw;
    topLevel.push(exact(CRUSTDATA_FIELDS.locationCountry, country));
    appliedGroups.push("country");
  }

  // ── Location: cities (multi, OR) ────────────────────────────────────────
  const cities = (draft.locationCities ?? []).filter(Boolean);
  if (cities.length > 0) {
    const g = phraseOrGroup(CRUSTDATA_FIELDS.locationCity, cities);
    if (g) {
      topLevel.push(g);
      appliedGroups.push("cities");
    }
  }

  // ── Location: single city (legacy) ──────────────────────────────────────
  const city = draft.locationCity?.trim();
  if (city && cities.length === 0) {
    const normalized = normalizePhrase(city);
    if (normalized) {
      topLevel.push(contains(CRUSTDATA_FIELDS.locationCity, normalized));
      appliedGroups.push("city");
    }
  }

  // ── Location: states (multi, OR) ────────────────────────────────────────
  const states = (draft.locationStates ?? []).filter(Boolean);
  if (states.length > 0) {
    const g = phraseOrGroup(CRUSTDATA_FIELDS.locationState, states);
    if (g) {
      topLevel.push(g);
      appliedGroups.push("states");
    }
  }

  // ── Skills: must-have (AND across chips; OR within expanded alternatives) ─
  const skillsRequired = (draft.skillsRequired ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (skillsRequired.length > 0) {
    for (const skill of skillsRequired) {
      const alts = expandSkillAlternatives(skill);
      const g = orGroup(alts.map((a) => contains(CRUSTDATA_FIELDS.skills, a)));
      if (g) topLevel.push(g);
    }
    appliedGroups.push("skills");
  }

  // ── Skills: nice-to-have (OR — any matching skill / alternative counts) ─
  const skillsNiceToHave = (draft.skillsNiceToHave ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (skillsNiceToHave.length > 0) {
    const conds = skillsNiceToHave.flatMap((s) =>
      expandSkillAlternatives(s).map((a) =>
        contains(CRUSTDATA_FIELDS.skills, a),
      ),
    );
    const g = orGroup(conds);
    if (g) {
      topLevel.push(g);
      appliedGroups.push("skills nice-to-have");
    }
  }

  // ── Seniority: single (legacy) ──────────────────────────────────────────
  const seniority = draft.seniority?.trim();
  if (seniority && !(draft.currentSeniorities ?? []).length) {
    topLevel.push(contains(CRUSTDATA_FIELDS.currentSeniorityLevel, seniority));
    appliedGroups.push("seniority");
  }

  // ── Seniority: multi-value (OR) ─────────────────────────────────────────
  const seniorities = (draft.currentSeniorities ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (seniorities.length > 0) {
    const g = orGroup(
      seniorities.map((s) =>
        contains(CRUSTDATA_FIELDS.currentSeniorityLevel, s),
      ),
    );
    if (g) {
      topLevel.push(g);
      appliedGroups.push("seniority");
    }
  }

  // ── Years of experience ──────────────────────────────────────────────────
  const yoeMin = draft.yoeMin != null && draft.yoeMin > 0 ? draft.yoeMin : null;
  const yoeMax = draft.yoeMax != null && draft.yoeMax > 0 ? draft.yoeMax : null;
  if (yoeMin !== null) {
    topLevel.push(gte(CRUSTDATA_FIELDS.yearsOfExperience, yoeMin));
    appliedGroups.push("yoe min");
  }
  if (yoeMax !== null) {
    topLevel.push(lte(CRUSTDATA_FIELDS.yearsOfExperience, yoeMax));
    appliedGroups.push("yoe max");
  }

  // ── Current company include (OR-group) ───────────────────────────────────
  const companyIncludes = (draft.currentCompaniesInclude ?? []).filter(Boolean);
  if (companyIncludes.length > 0) {
    const conds = companyIncludes
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => contains(CRUSTDATA_FIELDS.currentCompanyName, c));
    const g = orGroup(conds);
    if (g) {
      topLevel.push(g);
      appliedGroups.push("current company include");
    }
  }

  // ── Current company exclude ──────────────────────────────────────────────
  const companyExcludes = (draft.currentCompaniesExclude ?? []).filter(Boolean);
  for (const co of companyExcludes) {
    const trimmed = co.trim();
    if (trimmed) {
      topLevel.push(notContains(CRUSTDATA_FIELDS.currentCompanyName, trimmed));
    }
  }
  if (companyExcludes.length > 0) appliedGroups.push("current company exclude");

  // ── Past company include (OR-group) ─────────────────────────────────────
  const pastCompanyIncludes = (draft.pastCompaniesInclude ?? []).filter(
    Boolean,
  );
  if (pastCompanyIncludes.length > 0) {
    const conds = pastCompanyIncludes
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => contains(CRUSTDATA_FIELDS.pastCompanyName, c));
    const g = orGroup(conds);
    if (g) {
      topLevel.push(g);
      appliedGroups.push("past company include");
    }
  }

  // ── Company industries (OR-group) ────────────────────────────────────────
  const industries = (draft.companyIndustries ?? [])
    .map((i) => i.trim())
    .filter(Boolean);
  if (industries.length > 0) {
    const g = simpleOrGroup(
      CRUSTDATA_FIELDS.currentCompanyIndustries,
      industries,
    );
    if (g) {
      topLevel.push(g);
      appliedGroups.push("company industries");
    }
  }

  // ── Company HQ country (exact, ISO-3) ────────────────────────────────────
  const hqCountry = draft.companyHQCountry?.trim();
  if (hqCountry) {
    topLevel.push(
      exact(CRUSTDATA_FIELDS.currentCompanyHQCountry, hqCountry.toUpperCase()),
    );
    appliedGroups.push("company HQ country");
  }

  // ── Headcount min/max ────────────────────────────────────────────────────
  const hcMin =
    draft.headcountMin != null && draft.headcountMin > 0
      ? draft.headcountMin
      : null;
  const hcMax =
    draft.headcountMax != null && draft.headcountMax > 0
      ? draft.headcountMax
      : null;
  if (hcMin !== null) {
    topLevel.push(gte(CRUSTDATA_FIELDS.currentCompanyHeadcount, hcMin));
    appliedGroups.push("headcount min");
  }
  if (hcMax !== null) {
    topLevel.push(lte(CRUSTDATA_FIELDS.currentCompanyHeadcount, hcMax));
    appliedGroups.push("headcount max");
  }

  // ── Education: schools (OR-group) ────────────────────────────────────────
  const schools = (draft.educationSchools ?? []).filter(Boolean);
  if (schools.length > 0) {
    const g = phraseOrGroup(CRUSTDATA_FIELDS.educationSchool, schools);
    if (g) {
      topLevel.push(g);
      appliedGroups.push("education schools");
    }
  }

  // ── Education: degrees (OR-group) ────────────────────────────────────────
  const degrees = (draft.educationDegrees ?? []).filter(Boolean);
  if (degrees.length > 0) {
    const g = phraseOrGroup(CRUSTDATA_FIELDS.educationDegree, degrees);
    if (g) {
      topLevel.push(g);
      appliedGroups.push("education degrees");
    }
  }

  // ── Education: fields of study (OR-group) ────────────────────────────────
  const fieldsOfStudy = (draft.educationFieldsOfStudy ?? []).filter(Boolean);
  if (fieldsOfStudy.length > 0) {
    const g = phraseOrGroup(
      CRUSTDATA_FIELDS.educationFieldOfStudy,
      fieldsOfStudy,
    );
    if (g) {
      topLevel.push(g);
      appliedGroups.push("education fields of study");
    }
  }

  // ── Headline keywords include (OR-group) ─────────────────────────────────
  const headlineIncludes = (draft.headlineKeywordsInclude ?? []).filter(
    Boolean,
  );
  if (headlineIncludes.length > 0) {
    const g = simpleOrGroup(CRUSTDATA_FIELDS.headline, headlineIncludes);
    if (g) {
      topLevel.push(g);
      appliedGroups.push("headline include");
    }
  }

  // ── Headline keywords exclude (AND) ──────────────────────────────────────
  const headlineExcludes = (draft.headlineKeywordsExclude ?? []).filter(
    Boolean,
  );
  for (const kw of headlineExcludes) {
    const trimmed = kw.trim();
    if (trimmed) {
      topLevel.push(notContains(CRUSTDATA_FIELDS.headline, trimmed));
    }
  }
  if (headlineExcludes.length > 0) appliedGroups.push("headline exclude");

  // ── Languages (OR-group) ────────────────────────────────────────────────
  const languages = (draft.languages ?? [])
    .map((l) => l.trim())
    .filter(Boolean);
  if (languages.length > 0) {
    const g = simpleOrGroup(CRUSTDATA_FIELDS.languages, languages);
    if (g) {
      topLevel.push(g);
      appliedGroups.push("languages");
    }
  }

  // ── Min connections ──────────────────────────────────────────────────────
  const connectionsMin =
    draft.connectionsMin != null && draft.connectionsMin > 0
      ? draft.connectionsMin
      : null;
  if (connectionsMin !== null) {
    topLevel.push(gte(CRUSTDATA_FIELDS.connections, connectionsMin));
    appliedGroups.push("connections min");
  }

  // ── Recently changed jobs (boolean flag) ─────────────────────────────────
  if (draft.recentlyChangedJobs === true) {
    topLevel.push({
      field: CRUSTDATA_FIELDS.recentlyChangedJobs,
      type: "=",
      value: true,
    });
    appliedGroups.push("recently changed jobs");
  }

  // ── Location: continents (multi OR) ──────────────────────────────────────
  const continents = (draft.locationContinents ?? []).filter(Boolean);
  if (continents.length > 0) {
    const g = simpleOrGroup(CRUSTDATA_FIELDS.locationContinent, continents);
    if (g) {
      topLevel.push(g);
      appliedGroups.push("continents");
    }
  }

  // ── Geo distance / exclude ────────────────────────────────────────────────
  const geoCenter = draft.geoNear?.trim();
  const geoDist =
    draft.geoDistance != null && draft.geoDistance > 0
      ? draft.geoDistance
      : null;
  if (geoCenter && geoDist !== null) {
    const geoVal: CrustdataGeoValue = {
      location: geoCenter,
      distance: geoDist,
      unit: draft.geoUnit ?? "mi",
    };
    const geoType = draft.geoExcludeNear ? "geo_exclude" : "geo_distance";
    topLevel.push({
      field: CRUSTDATA_FIELDS.geoLocationRaw,
      type: geoType,
      value: geoVal,
    });
    appliedGroups.push(draft.geoExcludeNear ? "geo exclude" : "geo distance");
  }

  // ── Function categories (OR-group) ────────────────────────────────────────
  const functionCats = (draft.functionCategories ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (functionCats.length > 0) {
    const g = simpleOrGroup(
      CRUSTDATA_FIELDS.currentFunctionCategory,
      functionCats,
    );
    if (g) {
      topLevel.push(g);
      appliedGroups.push("function categories");
    }
  }

  // ── Employment types (OR-group) ───────────────────────────────────────────
  const empTypes = (draft.employmentTypes ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (empTypes.length > 0) {
    const g = simpleOrGroup(CRUSTDATA_FIELDS.currentEmploymentType, empTypes);
    if (g) {
      topLevel.push(g);
      appliedGroups.push("employment types");
    }
  }

  // ── Current company domains (= or in) ─────────────────────────────────────
  const domains = (draft.currentCompanyDomains ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (domains.length === 1) {
    topLevel.push(
      exact(CRUSTDATA_FIELDS.currentCompanyWebsiteDomain, domains[0]),
    );
    appliedGroups.push("company domain");
  } else if (domains.length > 1) {
    topLevel.push({
      field: CRUSTDATA_FIELDS.currentCompanyWebsiteDomain,
      type: "in",
      value: domains,
    });
    appliedGroups.push("company domains");
  }

  // ── Past company exclude (AND) ────────────────────────────────────────────
  const pastCompanyExcludes = (draft.pastCompaniesExclude ?? []).filter(
    Boolean,
  );
  for (const co of pastCompanyExcludes) {
    const trimmed = co.trim();
    if (trimmed) {
      topLevel.push(notContains(CRUSTDATA_FIELDS.pastCompanyName, trimmed));
    }
  }
  if (pastCompanyExcludes.length > 0)
    appliedGroups.push("past company exclude");

  // ── Open-to cards (single "in" condition) ─────────────────────────────────
  const openToCards = (draft.openToCards ?? []).filter(Boolean);
  if (openToCards.length > 0) {
    topLevel.push({
      field: CRUSTDATA_FIELDS.openToCards,
      type: "in",
      value: openToCards,
    });
    appliedGroups.push("open-to cards");
  }

  // ── Max connections ───────────────────────────────────────────────────────
  const connectionsMax =
    draft.connectionsMax != null && draft.connectionsMax > 0
      ? draft.connectionsMax
      : null;
  if (connectionsMax !== null) {
    topLevel.push(lte(CRUSTDATA_FIELDS.connections, connectionsMax));
    appliedGroups.push("connections max");
  }

  // ── Min followers ─────────────────────────────────────────────────────────
  const followersMin =
    draft.followersMin != null && draft.followersMin > 0
      ? draft.followersMin
      : null;
  if (followersMin !== null) {
    topLevel.push(gte(CRUSTDATA_FIELDS.followers, followersMin));
    appliedGroups.push("followers min");
  }

  // ── Assemble ─────────────────────────────────────────────────────────────
  if (topLevel.length === 0) {
    return { filters: null, appliedGroups: [] };
  }

  // ── Sort ──────────────────────────────────────────────────────────────────
  const sortField = draft.sortField?.trim() ?? null;
  const sorts =
    sortField && SORTABLE_FIELDS.has(sortField)
      ? [{ field: sortField, order: draft.sortOrder ?? "desc" }]
      : undefined;

  return {
    filters: { op: "and", conditions: topLevel },
    appliedGroups,
    ...(sorts ? { sorts } : {}),
  };
}

/**
 * Progressive relaxation of an over-constrained FilterDraft.
 * Each step drops one class of constraint that commonly zeros Crustdata.
 * Returns null when no further relaxation is possible.
 */
export function relaxFilterDraft(
  draft: FilterDraft,
): { draft: FilterDraft; dropped: string } | null {
  // 1. Nice-to-have skills (soft signal — shouldn't hard-filter)
  if ((draft.skillsNiceToHave ?? []).some((s) => s.trim())) {
    return {
      draft: { ...draft, skillsNiceToHave: [] },
      dropped: "nice-to-have skills",
    };
  }

  // 2. Company excludes (FAANG excludes wipe most Hyderabad/India AI talent)
  if ((draft.currentCompaniesExclude ?? []).some((s) => s.trim())) {
    return {
      draft: { ...draft, currentCompaniesExclude: [] },
      dropped: "company excludes",
    };
  }

  // 3. Extra must-have skills — keep only the first (matches calibration)
  const must = (draft.skillsRequired ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (must.length > 1) {
    return {
      draft: { ...draft, skillsRequired: [must[0]] },
      dropped: `extra must-have skills (kept "${must[0]}")`,
    };
  }

  // 4. Years of experience band
  if (
    (draft.yoeMin != null && draft.yoeMin > 0) ||
    (draft.yoeMax != null && draft.yoeMax > 0)
  ) {
    return {
      draft: { ...draft, yoeMin: null, yoeMax: null },
      dropped: "years of experience",
    };
  }

  // 5. City/state/geo (keep country/continent)
  const hasGeo =
    !!draft.geoNear?.trim() &&
    draft.geoDistance != null &&
    draft.geoDistance > 0;
  if (
    (draft.locationCities ?? []).some((s) => s.trim()) ||
    draft.locationCity?.trim() ||
    (draft.locationStates ?? []).some((s) => s.trim()) ||
    hasGeo
  ) {
    return {
      draft: {
        ...draft,
        locationCities: [],
        locationCity: undefined,
        locationStates: [],
        geoNear: null,
        geoDistance: null,
      },
      dropped: "city/state/geo (kept country)",
    };
  }

  // 6. Remaining must-have skill
  if (must.length === 1) {
    return {
      draft: { ...draft, skillsRequired: [] },
      dropped: "must-have skills",
    };
  }

  // 7. Headline / education / languages / connections extras
  if (
    (draft.headlineKeywordsInclude ?? []).some((s) => s.trim()) ||
    (draft.headlineKeywordsExclude ?? []).some((s) => s.trim()) ||
    (draft.educationSchools ?? []).some((s) => s.trim()) ||
    (draft.educationDegrees ?? []).some((s) => s.trim()) ||
    (draft.educationFieldsOfStudy ?? []).some((s) => s.trim()) ||
    (draft.languages ?? []).some((s) => s.trim()) ||
    (draft.connectionsMin != null && draft.connectionsMin > 0) ||
    (draft.connectionsMax != null && draft.connectionsMax > 0) ||
    (draft.followersMin != null && draft.followersMin > 0) ||
    (draft.companyIndustries ?? []).some((s) => s.trim()) ||
    draft.companyHQCountry?.trim() ||
    (draft.headcountMin != null && draft.headcountMin > 0) ||
    (draft.headcountMax != null && draft.headcountMax > 0) ||
    draft.seniority?.trim() ||
    (draft.currentSeniorities ?? []).some((s) => s.trim()) ||
    (draft.functionCategories ?? []).some((s) => s.trim()) ||
    (draft.employmentTypes ?? []).some((s) => s.trim()) ||
    (draft.currentCompanyDomains ?? []).some((s) => s.trim()) ||
    (draft.locationContinents ?? []).some((s) => s.trim())
  ) {
    return {
      draft: {
        ...draft,
        headlineKeywordsInclude: [],
        headlineKeywordsExclude: [],
        educationSchools: [],
        educationDegrees: [],
        educationFieldsOfStudy: [],
        languages: [],
        connectionsMin: null,
        connectionsMax: null,
        followersMin: null,
        companyIndustries: [],
        companyHQCountry: undefined,
        headcountMin: null,
        headcountMax: null,
        seniority: undefined,
        currentSeniorities: [],
        functionCategories: [],
        employmentTypes: [],
        currentCompanyDomains: [],
        locationContinents: [],
      },
      dropped: "extra filters (education/headline/seniority/etc.)",
    };
  }

  // 7.5 Open-to cards with other filters remaining — drop if not alone
  if ((draft.openToCards ?? []).length > 0) {
    return {
      draft: { ...draft, openToCards: [] },
      dropped: "open-to cards",
    };
  }

  // 8. Recently changed jobs (user asked for it — drop last)
  if (draft.recentlyChangedJobs === true) {
    return {
      draft: { ...draft, recentlyChangedJobs: false },
      dropped: "recently changed jobs",
    };
  }

  return null;
}
