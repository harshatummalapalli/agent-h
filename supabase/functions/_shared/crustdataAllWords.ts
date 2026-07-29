// crustdataAllWords — shared Crustdata `(.)` all-words condition builder.
//
// Crustdata People Search `(.)` is a case-insensitive ALL-WORDS match: every
// word in the value must appear in the target field, in any order, with no
// adjacency required. A piped value ("a|b") is NOT an OR — Crustdata splits
// on the pipe and requires ALL resulting words too (AND).
// Source: https://docs.crustdata.com/person-docs/search/reference
// (x-api-version: 2025-11-01).
//
// Live comparison 2026-07-29 (`scripts/crustdata-live-search.mjs --compare-dot-ops`
// against "Machine Learning Engineer"):
//   (a) full-phrase `(.)`          → 65,685  (relevant ML Engineer titles)
//   (b) 2-word shingle OR-group    → 102,862 (over-broad: Heads/Founders)
//   (c) pipe-joined shingles       → 65,685  (same as (a); pipe = AND of words)
// Winner: (a) full phrase as one `(.)` condition — no shingle OR, no pipe-join.
//
// Pure TypeScript — no Deno imports; Vitest-testable.
// Used by crustdataQueryBuilder, crustdataIntentValidator, crustdataFilterCompiler.

/** Leaf `(.)` condition. */
export type AllWordsCondition = {
  field: string;
  type: "(.)";
  value: string;
};

/** OR-group of `(.)` conditions (multiple alternative phrases). */
export type AllWordsGroup = {
  op: "or";
  conditions: AllWordsCondition[];
};

export type AllWordsFilter = AllWordsCondition | AllWordsGroup;

/**
 * Normalize a phrase for `(.)` all-words matching:
 * trim, treat `&` as space, collapse whitespace.
 * Does NOT split on `/` `|` — callers that want alternatives must split first.
 */
export function normalizeAllWordsPhrase(raw: string): string {
  return raw
    .trim()
    .replace(/\s*&\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build a single Crustdata `(.)` condition for one user phrase.
 * Sends the full normalized phrase as ONE value (all-words AND).
 * Returns null for blank input.
 */
export function buildAllWordsCondition(
  field: string,
  phrase: string,
): AllWordsCondition | null {
  const value = normalizeAllWordsPhrase(phrase);
  if (!value) return null;
  return { field, type: "(.)", value };
}

/**
 * OR-group of full-phrase `(.)` conditions — one condition per phrase.
 * Dedupes by normalized value. Returns the bare condition when only one
 * phrase survives; null when none do.
 *
 * Use this when the caller has multiple alternative phrases
 * (title synonyms, slash-split compounds). Never pipe-join alternatives
 * into one value (pipe = AND of words, not OR).
 */
export function buildAllWordsOrGroup(
  field: string,
  phrases: string[],
): AllWordsFilter | null {
  const seen = new Set<string>();
  const conditions: AllWordsCondition[] = [];
  for (const phrase of phrases) {
    const cond = buildAllWordsCondition(field, phrase);
    if (!cond || seen.has(cond.value)) continue;
    seen.add(cond.value);
    conditions.push(cond);
  }
  if (conditions.length === 0) return null;
  if (conditions.length === 1) return conditions[0];
  return { op: "or", conditions };
}
