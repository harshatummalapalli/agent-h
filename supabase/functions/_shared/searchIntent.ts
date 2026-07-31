// SearchIntent — canonical type for taxonomy-aware sourcing intent.
//
// Represents what the recruiter/JD requires, excludes, or prefers, expressed
// as open tagged conditions rather than a fixed named-field schema. This
// allows new requirement categories to be added without a type change.
//
// Both resolve-search-intent (LLM output) and crustdataIntentValidator
// (deterministic assembler) import this module — they reason about the
// same type. Do NOT duplicate or diverge the type definition.
//
// No Deno-specific imports — Vitest-compatible.

// ─── Core condition type ──────────────────────────────────────────────────────

export type IntentCategory =
  | "seniority" // e.g. "Staff", "Senior", "IC5"
  | "company" // specific company name (current or past)
  | "title" // job title phrase (current by default; note="past" for past titles)
  | "skill" // technical or domain skill
  | "experience_range" // years of experience (value: "min:5" or "max:10" or "5-10")
  | "location" // city, country, or region — see locationKind for sub-type
  // ── Extended categories (from compiler consolidation) ──────────────────────
  | "headcount_range" // company headcount (value: "min:N", "max:N", or "N-M")
  | "connections_min" // minimum LinkedIn connections (value: plain integer string)
  | "education_school" // university / school name
  | "education_degree" // degree type (e.g. "MBA", "BS", "PhD")
  | "education_field" // field of study
  | "headline_keyword" // LinkedIn headline contains/not-contains keyword
  | "language" // spoken language
  | "company_industry" // company industry tag
  | "other"; // anything that doesn't map cleanly

export type IntentDisposition =
  | "require" // hard filter — must match
  | "exclude" // hard exclusion — must not match
  | "prefer"; // soft preference — informs ranking/why-fit but cannot be a hard filter

export type SearchIntentCondition = {
  category: IntentCategory;
  disposition: IntentDisposition;
  value: string;
  /**
   * Optional clarifying note.
   * For `location`: use locationKind instead for country/city/state sub-type.
   * For `title`: "past" to indicate a past-title condition.
   * Otherwise: free-text note (e.g. "from JD phrase: '...'").
   */
  note?: string;
  /**
   * For `location` conditions only: resolved kind from taxonomy.
   * Populated by resolveLocation() at parse/edit time so the compiler never
   * re-guesses country vs. city at filter-assembly time.
   */
  locationKind?: "country" | "city" | "state";
};

// ─── Unenforceable constraints ─────────────────────────────────────────────────
//
// Conditions the recruiter expressed but Crustdata cannot represent as a hard
// filter. These are surfaced to the recruiter (T6 UI) and used in why-fit
// explanations (T4) — never silently dropped, never sent to the API.

export type UnenforcedConstraint = {
  /** Human-readable description of what was asked */
  description: string;
  /** Why it cannot be enforced as a filter */
  reason: string;
};

// ─── Versioned envelope ───────────────────────────────────────────────────────
//
// Each call to resolve-search-intent produces a new version. The deal stores
// { current: VersionedSearchIntent, history: VersionedSearchIntent[] } in
// deals.role_brief_search_intent (jsonb). Version 1 is the intake parse;
// subsequent versions come from recalibration feedback.

export type VersionedSearchIntent = {
  version: number; // 1-based, increments on each resolve-search-intent call
  updated_at: string; // ISO 8601 timestamp
  conditions: SearchIntentCondition[];
  unenforceable_constraints: UnenforcedConstraint[];
};

// ─── Persisted shape on deals.role_brief_search_intent ───────────────────────

export type SearchIntentRecord = {
  current: VersionedSearchIntent;
  history: VersionedSearchIntent[]; // previous versions, oldest first
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a fresh version-1 intent (intake call). */
export function makeInitialIntent(
  conditions: SearchIntentCondition[],
  unenforceable_constraints: UnenforcedConstraint[],
): VersionedSearchIntent {
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    conditions,
    unenforceable_constraints,
  };
}

/**
 * Produce the next version of an existing intent, replacing conditions
 * and unenforceable_constraints with the new values.
 */
export function bumpIntent(
  previous: VersionedSearchIntent,
  conditions: SearchIntentCondition[],
  unenforceable_constraints: UnenforcedConstraint[],
): VersionedSearchIntent {
  return {
    version: previous.version + 1,
    updated_at: new Date().toISOString(),
    conditions,
    unenforceable_constraints,
  };
}

/**
 * Add a new version to the record and return the updated record.
 * The previous current becomes the last history entry.
 */
export function updateSearchIntentRecord(
  record: SearchIntentRecord | null,
  next: VersionedSearchIntent,
): SearchIntentRecord {
  if (!record) {
    return { current: next, history: [] };
  }
  return {
    current: next,
    history: [...record.history, record.current],
  };
}

/**
 * Compute the delta between two consecutive versions for UI display.
 * Returns { added, removed } condition arrays.
 */
export function intentDelta(
  prev: VersionedSearchIntent,
  curr: VersionedSearchIntent,
): { added: SearchIntentCondition[]; removed: SearchIntentCondition[] } {
  const prevKeys = new Set(prev.conditions.map(conditionKey));
  const currKeys = new Set(curr.conditions.map(conditionKey));
  const added = curr.conditions.filter((c) => !prevKeys.has(conditionKey(c)));
  const removed = prev.conditions.filter((c) => !currKeys.has(conditionKey(c)));
  return { added, removed };
}

function conditionKey(c: SearchIntentCondition): string {
  return `${c.category}:${c.disposition}:${c.value.toLowerCase()}`;
}
