// crustdataFilterCompiler — pure compiler: UI filter draft → Crustdata filter tree.
//
// Takes a structured FilterDraft (typed form fields from the Build Search page) and
// compiles it to a Crustdata boolean filter tree suitable for POST /person/search.
//
// Unlike crustdataIntentValidator (which maps SearchIntent conditions → filters),
// this module maps explicit form fields directly — no NLP, no ambiguity, pure
// field-by-field translation. Unit-testable with no Deno imports.
//
// Re-uses CRUSTDATA_FIELDS from the capability manifest and applies the shingle
// decomposition rule for long title/education phrases.
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

import {
  CRUSTDATA_FIELDS,
  PHRASE_DECOMPOSITION,
} from "./crustdataCapabilityManifest.ts";
import { COUNTRY_ALIASES } from "./crustdataClient.ts";

// ─── Re-exported types (callers use these, avoids duplicate declarations) ─────

export type CrustdataCondition = {
  field: string;
  type: "=" | "!=" | "(.)" | "(!)" | "not_in" | "=<" | "=>" | "in";
  value: string | number | string[] | number[];
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
};

// ─── Shingle decomposition (mirrors crustdataQueryBuilder + manifest rule) ────
//
// Crustdata (.) does LITERAL phrase matching — a 3+ word phrase may not appear
// verbatim in indexed titles. Decompose into overlapping 2-word windows.

function decomposePhrase(
  phrase: string,
  shingleSize = PHRASE_DECOMPOSITION.shingleSize,
  maxTerms = PHRASE_DECOMPOSITION.maxTerms,
): string[] {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  if (words.length <= shingleSize)
    return words.length > 0 ? [phrase.trim()] : [];
  const shingles = new Set<string>();
  for (let i = 0; i + shingleSize <= words.length; i++) {
    shingles.add(words.slice(i, i + shingleSize).join(" "));
  }
  return Array.from(shingles).slice(0, maxTerms);
}

/** Expand a single user-entered term into (possibly shingle-decomposed) terms. */
function expandTerm(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return decomposePhrase(trimmed);
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
 * Expand an array of user-entered title/company/skill terms, decompose long
 * phrases into shingles, and build an OR-group of (.) conditions.
 */
function titleOrGroup(
  field: string,
  terms: string[],
): CrustdataCondition | CrustdataGroup | null {
  const conditions: CrustdataCondition[] = [];
  for (const term of terms) {
    for (const expanded of expandTerm(term)) {
      conditions.push(contains(field, expanded));
    }
  }
  return orGroup(conditions);
}

/**
 * Build a simple OR-group of (.) conditions for a list of terms (no shingle decomp).
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

// ─── Main compiler ────────────────────────────────────────────────────────────

export type CompileResult = {
  /** The compiled Crustdata filter tree. Null when the draft is empty. */
  filters: CrustdataGroup | null;
  /** Human-readable summary of which filter groups were applied. */
  appliedGroups: string[];
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
    const g = titleOrGroup(CRUSTDATA_FIELDS.currentTitle, titleIncludes);
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
    const g = titleOrGroup(CRUSTDATA_FIELDS.pastTitle, pastTitles);
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
    const g = titleOrGroup(CRUSTDATA_FIELDS.locationCity, cities);
    if (g) {
      topLevel.push(g);
      appliedGroups.push("cities");
    }
  }

  // ── Location: single city (legacy) ──────────────────────────────────────
  const city = draft.locationCity?.trim();
  if (city && cities.length === 0) {
    const cityTerms = expandTerm(city);
    const g = orGroup(
      cityTerms.map((t) => contains(CRUSTDATA_FIELDS.locationCity, t)),
    );
    if (g) {
      topLevel.push(g);
      appliedGroups.push("city");
    }
  }

  // ── Location: states (multi, OR) ────────────────────────────────────────
  const states = (draft.locationStates ?? []).filter(Boolean);
  if (states.length > 0) {
    const g = titleOrGroup(CRUSTDATA_FIELDS.locationState, states);
    if (g) {
      topLevel.push(g);
      appliedGroups.push("states");
    }
  }

  // ── Skills: must-have (AND — each listed skill is required) ─────────────
  const skillsRequired = (draft.skillsRequired ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (skillsRequired.length > 0) {
    for (const skill of skillsRequired) {
      topLevel.push(contains(CRUSTDATA_FIELDS.skills, skill));
    }
    appliedGroups.push("skills");
  }

  // ── Skills: nice-to-have (OR — any matching skill counts) ───────────────
  const skillsNiceToHave = (draft.skillsNiceToHave ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (skillsNiceToHave.length > 0) {
    const g = orGroup(
      skillsNiceToHave.map((s) => contains(CRUSTDATA_FIELDS.skills, s)),
    );
    if (g) {
      topLevel.push(g);
      appliedGroups.push("skills nice-to-have");
    }
  }

  // ── Seniority: single (legacy) ──────────────────────────────────────────
  const seniority = draft.seniority?.trim();
  if (seniority && !(draft.currentSeniorities ?? []).length) {
    topLevel.push(
      contains(CRUSTDATA_FIELDS.currentSeniorityLevel, seniority),
    );
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
  const pastCompanyIncludes = (draft.pastCompaniesInclude ?? []).filter(Boolean);
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
    const g = titleOrGroup(CRUSTDATA_FIELDS.educationSchool, schools);
    if (g) {
      topLevel.push(g);
      appliedGroups.push("education schools");
    }
  }

  // ── Education: degrees (OR-group) ────────────────────────────────────────
  const degrees = (draft.educationDegrees ?? []).filter(Boolean);
  if (degrees.length > 0) {
    const g = titleOrGroup(CRUSTDATA_FIELDS.educationDegree, degrees);
    if (g) {
      topLevel.push(g);
      appliedGroups.push("education degrees");
    }
  }

  // ── Education: fields of study (OR-group) ────────────────────────────────
  const fieldsOfStudy = (draft.educationFieldsOfStudy ?? []).filter(Boolean);
  if (fieldsOfStudy.length > 0) {
    const g = titleOrGroup(
      CRUSTDATA_FIELDS.educationFieldOfStudy,
      fieldsOfStudy,
    );
    if (g) {
      topLevel.push(g);
      appliedGroups.push("education fields of study");
    }
  }

  // ── Headline keywords include (OR-group) ─────────────────────────────────
  const headlineIncludes = (draft.headlineKeywordsInclude ?? []).filter(Boolean);
  if (headlineIncludes.length > 0) {
    const g = simpleOrGroup(CRUSTDATA_FIELDS.headline, headlineIncludes);
    if (g) {
      topLevel.push(g);
      appliedGroups.push("headline include");
    }
  }

  // ── Headline keywords exclude (AND) ──────────────────────────────────────
  const headlineExcludes = (draft.headlineKeywordsExclude ?? []).filter(Boolean);
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

  // ── Assemble root AND-group ──────────────────────────────────────────────
  if (topLevel.length === 0) {
    return { filters: null, appliedGroups: [] };
  }

  const filters: CrustdataGroup = { op: "and", conditions: topLevel };

  return { filters, appliedGroups };
}
