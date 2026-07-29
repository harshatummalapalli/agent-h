// crustdataFilterCompiler — pure compiler: UI filter draft → Crustdata filter tree.
//
// Takes a structured FilterDraft (typed form fields from the Build Search tab) and
// compiles it to a Crustdata boolean filter tree suitable for POST /person/search.
//
// Unlike crustdataIntentValidator (which maps SearchIntent conditions → filters),
// this module maps explicit form fields directly — no NLP, no ambiguity, pure
// field-by-field translation. Unit-testable with no Deno imports.
//
// Re-uses CRUSTDATA_FIELDS from the capability manifest and applies the shingle
// decomposition rule for long title phrases.

import {
  CRUSTDATA_FIELDS,
  PHRASE_DECOMPOSITION,
} from "./crustdataCapabilityManifest.ts";
import { COUNTRY_ALIASES } from "./crustdataClient.ts";

// ─── Re-exported types (callers use these, avoids duplicate declarations) ─────

export type CrustdataCondition = {
  field: string;
  type: "=" | "!=" | "(.)" | "(!)" | "not_in" | "=<" | "=>";
  value: string | number | string[] | number[];
};

export type CrustdataGroup = {
  op: "and" | "or";
  conditions: Array<CrustdataCondition | CrustdataGroup>;
};

export type CrustdataFilters = CrustdataCondition | CrustdataGroup;

// ─── FilterDraft — the structured form the UI submits ─────────────────────────

export type FilterDraft = {
  /** Include terms for current title. Each non-empty string → a (.) condition; all OR'd. */
  currentTitlesInclude?: string[];
  /** Keywords that must NOT appear in current title. Each → (!) condition; all AND'd. */
  currentTitlesExclude?: string[];
  /** Include terms for past title. Each non-empty string → a (.) condition; all OR'd. */
  pastTitlesInclude?: string[];
  /** Country exact match ("India", "United States", …). Uses COUNTRY_ALIASES normalisation. */
  locationCountry?: string;
  /** City/metro contains-match. Long phrases are shingle-decomposed. */
  locationCity?: string;
  /** Must-have skills. Each skill → a (.) condition; all AND'd (every skill required). */
  skillsRequired?: string[];
  /** Seniority level. Fuzzy (.) match — exact value vocabulary unconfirmed. */
  seniority?: string;
  /** Minimum years of experience (inclusive). Emits => condition. */
  yoeMin?: number | null;
  /** Maximum years of experience (inclusive). Emits =< condition. */
  yoeMax?: number | null;
  /** Current company names to include. Each → (.) condition; all OR'd. */
  currentCompaniesInclude?: string[];
  /** Current company names to exclude. Each → (!) condition; all AND'd. */
  currentCompaniesExclude?: string[];
  /** Minimum current company headcount. Emits => condition. */
  headcountMin?: number | null;
  /** Maximum current company headcount. Emits =< condition. */
  headcountMax?: number | null;
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

  // ── Location: country (exact, alias-normalised) ──────────────────────────
  const countryRaw = draft.locationCountry?.trim();
  if (countryRaw) {
    const country = COUNTRY_ALIASES[countryRaw.toLowerCase()] ?? countryRaw;
    topLevel.push(exact(CRUSTDATA_FIELDS.locationCountry, country));
    appliedGroups.push("country");
  }

  // ── Location: city (contains) ────────────────────────────────────────────
  const city = draft.locationCity?.trim();
  if (city) {
    // City is usually short (1-2 words) so simple (.) is fine; decompose if long.
    const cityTerms = expandTerm(city);
    const g = orGroup(
      cityTerms.map((t) => contains(CRUSTDATA_FIELDS.locationCity, t)),
    );
    if (g) {
      topLevel.push(g);
      appliedGroups.push("city");
    }
  }

  // ── Skills (AND — each listed skill is must-have) ────────────────────────
  const skills = (draft.skillsRequired ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (skills.length > 0) {
    for (const skill of skills) {
      topLevel.push(contains(CRUSTDATA_FIELDS.skills, skill));
    }
    appliedGroups.push("skills");
  }

  // ── Seniority (fuzzy contains) ───────────────────────────────────────────
  const seniority = draft.seniority?.trim();
  if (seniority) {
    topLevel.push(contains(CRUSTDATA_FIELDS.currentSeniorityLevel, seniority));
    appliedGroups.push("seniority");
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

  // ── Assemble root AND-group ──────────────────────────────────────────────
  if (topLevel.length === 0) {
    return { filters: null, appliedGroups: [] };
  }

  const filters: CrustdataGroup =
    topLevel.length === 1
      ? { op: "and", conditions: topLevel }
      : { op: "and", conditions: topLevel };

  return { filters, appliedGroups };
}
