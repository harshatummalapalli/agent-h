// crustdataIntentValidator — deterministic validator/assembler for SearchIntent.
//
// Takes a VersionedSearchIntent, checks each condition against the capability
// manifest, assembles a valid Crustdata filter tree for enforceable conditions,
// and routes unenforceable ones to unenforceable_constraints with a reason.
//
// NEVER silently drops or sends a malformed filter. Any condition that cannot
// be expressed as a real Crustdata hard filter is moved to the unenforceable
// list with a human-readable reason — the recruiter sees it in T6 UI.
//
// No Deno-specific imports — pure, Vitest-testable.

import { CRUSTDATA_FIELDS } from "./crustdataCapabilityManifest.ts";
import type { SearchIntentCondition, VersionedSearchIntent, UnenforcedConstraint } from "./searchIntent.ts";

// ─── Re-exported types (callers can import from here) ─────────────────────────

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

export type ValidatorResult = {
  filters: CrustdataGroup | null;     // null when nothing is enforceable
  unenforceable: UnenforcedConstraint[];
};

// ─── Company acronym expansion table ──────────────────────────────────────────
// Maps common shorthand → real company names. Used so "exclude FAANG" produces
// per-company excludes rather than matching the literal acronym.

const COMPANY_ACRONYMS: Record<string, string[]> = {
  FAANG: ["Facebook", "Meta", "Apple", "Amazon", "Netflix", "Google"],
  MAANG: ["Meta", "Apple", "Amazon", "Netflix", "Google"],
  MAMAA: ["Meta", "Apple", "Microsoft", "Amazon", "Alphabet"],
  MANGA: ["Meta", "Apple", "Netflix", "Google", "Amazon"],
  GAFAM: ["Google", "Apple", "Facebook", "Amazon", "Microsoft"],
  FANG:  ["Facebook", "Amazon", "Netflix", "Google"],
};

/** Expand an acronym to real company names. Returns [value] unchanged if not an acronym. */
export function expandCompanyAcronym(value: string): string[] {
  const upper = value.trim().toUpperCase();
  return COMPANY_ACRONYMS[upper] ?? [value.trim()];
}

// ─── Unenforceable pattern detection ─────────────────────────────────────────

// Patterns that indicate a skill RECENCY requirement (Crustdata cannot filter on this).
const RECENCY_PATTERNS = [
  /\b(\d+)\s*(years?|yrs?)\s+(of\s+)?(experience\s+(in|with)|in|using|of)\b/i,
  /\brecent(ly)?\b/i,
  /\blast\s+\d+\s*years?\b/i,
  /\bin\s+the\s+last\s+\d+/i,
];

function looksLikeRecencyConstraint(value: string): boolean {
  return RECENCY_PATTERNS.some((r) => r.test(value));
}

// ─── Condition assemblers ─────────────────────────────────────────────────────

/** Decompose a phrase into 2-word shingles (mirrors crustdataQueryBuilder). */
function decomposePhrase(phrase: string, maxTerms = 6): string[] {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 2) return words.length > 0 ? [phrase.trim()] : [];
  const shingles = new Set<string>();
  for (let i = 0; i + 2 <= words.length; i++) {
    shingles.add(`${words[i]} ${words[i + 1]}`);
  }
  return Array.from(shingles).slice(0, maxTerms);
}

/** Build a contains condition (or OR-group for multi-term phrases). */
function buildContains(field: string, phrase: string): CrustdataCondition | CrustdataGroup | null {
  const terms = decomposePhrase(phrase);
  if (terms.length === 0) return null;
  if (terms.length === 1) return { field, type: "(.)", value: terms[0] };
  return {
    op: "or",
    conditions: terms.map((t) => ({ field, type: "(.)", value: t }) as CrustdataCondition),
  };
}

/** Build a not-contains condition for a keyword. */
function buildNotContains(field: string, phrase: string): CrustdataCondition {
  return { field, type: "(!)", value: phrase.trim() };
}

/** Build a numeric range condition. Accepts "min:N", "max:N", or "N-M" format. */
function buildExperienceRange(value: string): CrustdataCondition[] {
  const minMatch = value.match(/min:(\d+)/i) || value.match(/^(\d+)-/);
  const maxMatch = value.match(/max:(\d+)/i) || value.match(/-(\d+)$/);
  const conditions: CrustdataCondition[] = [];
  if (minMatch) conditions.push({ field: CRUSTDATA_FIELDS.yearsOfExperience, type: "=>", value: Number(minMatch[1]) });
  if (maxMatch) conditions.push({ field: CRUSTDATA_FIELDS.yearsOfExperience, type: "=<", value: Number(maxMatch[1]) });
  return conditions;
}

// ─── Main validator ───────────────────────────────────────────────────────────

/** Route a prefer condition — prefer is inherently soft; can never be a hard Crustdata filter. */
function routePrefer(cond: SearchIntentCondition): UnenforcedConstraint {
  return {
    description: `Prefer ${cond.category}: "${cond.value}"`,
    reason: "Crustdata only supports hard AND/OR filters; 'prefer' (soft/ranking) cannot be expressed as a filter. This will inform why-fit scoring instead.",
  };
}

/**
 * Validate and assemble a VersionedSearchIntent into a Crustdata filter tree.
 * Enforceable conditions → filters. Non-filterable → unenforceable list.
 */
export function validateAndAssembleIntent(intent: VersionedSearchIntent): ValidatorResult {
  const assembled: Array<CrustdataCondition | CrustdataGroup> = [];
  const unenforceable: UnenforcedConstraint[] = [...intent.unenforceable_constraints];

  for (const cond of intent.conditions) {
    // All "prefer" conditions are inherently unenforceable as hard filters.
    if (cond.disposition === "prefer") {
      unenforceable.push(routePrefer(cond));
      continue;
    }

    const isExclude = cond.disposition === "exclude";

    switch (cond.category) {
      case "seniority": {
        if (isExclude) {
          // Exclude seniority: not-contains on seniority_level field.
          assembled.push(buildNotContains(CRUSTDATA_FIELDS.currentSeniorityLevel, cond.value));
        } else {
          // Require seniority: fuzzy contains (vocabulary unconfirmed, see manifest).
          const c = buildContains(CRUSTDATA_FIELDS.currentSeniorityLevel, cond.value);
          if (c) assembled.push(c);
        }
        break;
      }

      case "company": {
        const companies = expandCompanyAcronym(cond.value);
        if (isExclude) {
          for (const company of companies) {
            assembled.push(buildNotContains(CRUSTDATA_FIELDS.currentCompanyName, company));
          }
        } else {
          const groups = companies.map((c) => buildContains(CRUSTDATA_FIELDS.currentCompanyName, c)).filter(Boolean) as Array<CrustdataCondition | CrustdataGroup>;
          if (groups.length === 1) assembled.push(groups[0]);
          else if (groups.length > 1) assembled.push({ op: "or", conditions: groups });
        }
        break;
      }

      case "title": {
        if (isExclude) {
          assembled.push(buildNotContains(CRUSTDATA_FIELDS.currentTitle, cond.value));
        } else {
          const c = buildContains(CRUSTDATA_FIELDS.currentTitle, cond.value);
          if (c) assembled.push(c);
        }
        break;
      }

      case "skill": {
        // Check for skill recency — Crustdata cannot filter on this.
        if (looksLikeRecencyConstraint(cond.value)) {
          unenforceable.push({
            description: `${isExclude ? "Exclude" : "Require"} skill with recency: "${cond.value}"`,
            reason: "Crustdata has no skill-date or recency field. Only skill presence/absence can be filtered.",
          });
          break;
        }
        if (isExclude) {
          assembled.push(buildNotContains(CRUSTDATA_FIELDS.skills, cond.value));
        } else {
          const c = buildContains(CRUSTDATA_FIELDS.skills, cond.value);
          if (c) assembled.push(c);
        }
        break;
      }

      case "experience_range": {
        const rangeConds = buildExperienceRange(cond.value);
        if (rangeConds.length === 0) {
          unenforceable.push({
            description: `Experience range: "${cond.value}"`,
            reason: "Could not parse experience range. Use format: 'min:N', 'max:N', or 'N-M'.",
          });
        } else {
          assembled.push(...rangeConds);
        }
        break;
      }

      case "location": {
        // Route to either country (exact) or city (contains).
        const lower = cond.value.toLowerCase().trim();
        if (isExclude) {
          // Location excludes are unusual but supported via not-contains on city.
          assembled.push(buildNotContains(CRUSTDATA_FIELDS.locationCity, cond.value));
        } else {
          // Simple heuristic: short values (1-2 words, no comma) that are known
          // country aliases use the country field; others use city contains.
          const isCountryLike = !cond.value.includes(",") && cond.value.split(/\s+/).length <= 3;
          if (isCountryLike) {
            assembled.push({ field: CRUSTDATA_FIELDS.locationCountry, type: "=", value: cond.value.trim() });
          } else {
            const c = buildContains(CRUSTDATA_FIELDS.locationCity, cond.value);
            if (c) assembled.push(c);
          }
        }
        break;
      }

      case "other":
      default: {
        unenforceable.push({
          description: `${isExclude ? "Exclude" : "Require"} (other): "${cond.value}"`,
          reason: "Condition category 'other' cannot be mapped to a Crustdata field.",
        });
        break;
      }
    }
  }

  const filters: CrustdataGroup | null =
    assembled.length === 0 ? null : { op: "and", conditions: assembled };

  return { filters, unenforceable };
}
