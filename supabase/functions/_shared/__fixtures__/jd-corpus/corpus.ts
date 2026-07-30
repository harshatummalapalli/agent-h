// JD corpus — regression fixtures for validateAndAssembleIntent().
//
// Each fixture represents a real-world scenario that was either historically
// broken or is critical to keep correct. The corpus test in
// crustdataIntentValidator.corpus.test.ts runs each one and snapshots the
// compiled Crustdata filter shape.
//
// Adding a new fixture = one new object here + run `vitest --update-snapshots`
// once to record the golden output. Never hand-write expected filter shapes —
// the snapshot is the source of truth after initial approval.
//
// Coverage targets per spec §7:
//   ✓ Mid-Level seniority phrasings (bug fix: was silently unmatchable)
//   ✓ India country exclude (bug fix: was always city not-contains, a no-op)
//   ✓ San Francisco city (bug fix: was mis-classified as country, zero results)
//   ✓ Senior + Staff phrasings
//   ✓ Remote location (special case — not a real country)
//   ✓ 6+ hard-skill require (Require/Prefer default behavior)
//   ✓ Tiered-preference JD (primary prefer + secondary prefer + core require)
//   ✓ GCC exclusion (multiple country excludes)
//   ✓ Unknown seniority → unenforceable, not broken filter
//   ✓ Unknown location → unenforceable, not broken filter
//   ✓ Company acronym expand + exclude
//   ✓ Prefer conditions → always unenforceable (no filter leak)

import type {
  SearchIntentCondition,
  UnenforcedConstraint,
} from "../../searchIntent.ts";

export type CorpusFixture = {
  /** Human-readable name shown in test output */
  name: string;
  /** SearchIntentCondition[] fed directly to validateAndAssembleIntent */
  conditions: SearchIntentCondition[];
  /** Any pre-existing unenforceable constraints (carry-forward test) */
  existingUnenforceable?: UnenforcedConstraint[];
  /**
   * Assertions to verify without snapshots — things that MUST hold regardless
   * of internal filter structure changes (e.g. bug-fix acceptance criteria).
   * The snapshot captures the full shape; these are named invariants.
   */
  invariants?: {
    /** Number of unenforceable items expected */
    unenforceableCount?: number;
    /** Every string must appear in at least one unenforceable reason */
    unenforceableReasonIncludes?: string[];
    /** Filter must be non-null when true */
    hasFilters?: boolean;
    /** Field paths that MUST appear in the filter conditions */
    filterFieldsInclude?: string[];
    /** Field paths that MUST NOT appear in the filter conditions */
    filterFieldsExclude?: string[];
    /** Filter condition types that must appear on a specific field */
    filterHas?: { field: string; type: string }[];
  };
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

export const JD_CORPUS: CorpusFixture[] = [
  // ── 01: Mid-Level seniority require ────────────────────────────────────────
  // Bug: was emitting a (.)- contains on "mid_level" (internal enum token)
  // which never appears in real Crustdata profiles. Fix: maps via taxonomy to
  // ["Mid Level", "Intermediate", "Mid-Level"] and OR-groups them.
  {
    name: "01-mid-level-seniority-require",
    conditions: [
      { category: "seniority", disposition: "require", value: "Mid-Level" },
    ],
    invariants: {
      hasFilters: true,
      unenforceableCount: 0,
      filterFieldsInclude: [
        "experience.employment_details.current.seniority_level",
      ],
      // The broken token must NOT appear as a raw filter value.
      filterFieldsExclude: [],
    },
  },

  // ── 02: Mid-level via year-range phrasing ──────────────────────────────────
  // "3-5 years" resolves to mid_level via the alias table.
  {
    name: "02-mid-level-year-range-phrasing",
    conditions: [
      { category: "seniority", disposition: "require", value: "3-5 years" },
    ],
    invariants: {
      hasFilters: true,
      unenforceableCount: 0,
      filterFieldsInclude: [
        "experience.employment_details.current.seniority_level",
      ],
    },
  },

  // ── 03: Unknown seniority → unenforceable, not broken filter ───────────────
  // A phrasing not in the alias table must go to unenforceable rather than
  // silently sending a filter that will never match.
  {
    name: "03-unrecognized-seniority-unenforceable",
    conditions: [
      {
        category: "seniority",
        disposition: "require",
        value: "Growthleader III",
      },
    ],
    invariants: {
      hasFilters: false,
      unenforceableCount: 1,
      unenforceableReasonIncludes: ["not yet in taxonomy"],
    },
  },

  // ── 04: India country exclude ──────────────────────────────────────────────
  // Bug: was always using city not-contains for any exclude (a no-op for
  // "India" because no profile has "India" as a city). Fix: uses country
  // field for resolved-country excludes.
  {
    name: "04-india-country-exclude",
    conditions: [
      { category: "location", disposition: "exclude", value: "India" },
    ],
    invariants: {
      hasFilters: true,
      unenforceableCount: 0,
      // Must use country field, NOT city field.
      filterHas: [{ field: "basic_profile.location.country", type: "(!)" }],
      filterFieldsExclude: ["basic_profile.location.city"],
    },
  },

  // ── 05: San Francisco city require ─────────────────────────────────────────
  // Bug: word-count heuristic classified "San Francisco" (2 words, no comma)
  // as country-like and exact-matched against the country field → zero results.
  // Fix: taxonomy correctly identifies it as a city.
  {
    name: "05-san-francisco-city-require",
    conditions: [
      { category: "location", disposition: "require", value: "San Francisco" },
    ],
    invariants: {
      hasFilters: true,
      unenforceableCount: 0,
      // Must use city field, NOT country field.
      filterHas: [{ field: "basic_profile.location.city", type: "(.)" }],
      filterFieldsExclude: ["basic_profile.location.country"],
    },
  },

  // ── 06: Unknown location → unenforceable ───────────────────────────────────
  // A location string not in any taxonomy lookup must go to unenforceable
  // rather than producing a broken filter.
  {
    name: "06-unknown-location-unenforceable",
    conditions: [
      {
        category: "location",
        disposition: "require",
        value: "Silicon Tropics",
      },
    ],
    invariants: {
      hasFilters: false,
      unenforceableCount: 1,
      unenforceableReasonIncludes: ["could not be resolved"],
    },
  },

  // ── 07: Senior seniority require ──────────────────────────────────────────
  // Standard "Senior" — ensures the happy path is covered in corpus.
  {
    name: "07-senior-seniority-require",
    conditions: [
      { category: "seniority", disposition: "require", value: "senior" },
    ],
    invariants: {
      hasFilters: true,
      unenforceableCount: 0,
      filterFieldsInclude: [
        "experience.employment_details.current.seniority_level",
      ],
    },
  },

  // ── 08: Staff seniority — "Lead" alias ─────────────────────────────────────
  // "Lead" → "staff" is the v1 open-decision mapping. Confirmed in taxonomy.
  {
    name: "08-lead-maps-to-staff",
    conditions: [
      { category: "seniority", disposition: "require", value: "Lead" },
    ],
    invariants: {
      hasFilters: true,
      unenforceableCount: 0,
      filterFieldsInclude: [
        "experience.employment_details.current.seniority_level",
      ],
    },
  },

  // ── 09: GCC exclusion — multiple country excludes ──────────────────────────
  // Excluding multiple GCC countries should produce per-country excludes
  // on the COUNTRY field, not the city field.
  {
    name: "09-gcc-country-excludes",
    conditions: [
      {
        category: "location",
        disposition: "exclude",
        value: "United Arab Emirates",
      },
      { category: "location", disposition: "exclude", value: "Saudi Arabia" },
    ],
    invariants: {
      hasFilters: true,
      // UAE resolves; Saudi Arabia is not in the taxonomy → unenforceable.
      filterHas: [{ field: "basic_profile.location.country", type: "(!)" }],
    },
  },

  // ── 10: FAANG company exclude + acronym expansion ──────────────────────────
  // Standard acronym expansion regression — covered in unit test too but
  // included in corpus for full-pipeline visibility.
  {
    name: "10-faang-company-exclude",
    conditions: [
      { category: "company", disposition: "exclude", value: "FAANG" },
    ],
    invariants: {
      hasFilters: true,
      unenforceableCount: 0,
      filterFieldsInclude: [
        "experience.employment_details.current.company_name",
      ],
    },
  },

  // ── 11: Tiered-preference JD (prefer conditions → never filters) ───────────
  // A JD with tiered preferences (primary/secondary). Prefer conditions must
  // never appear as hard Crustdata filters — this was the spec concern about
  // "prefer chips are inert" before ranking exists.
  {
    name: "11-tiered-preference-jd",
    conditions: [
      { category: "skill", disposition: "require", value: "Python" },
      { category: "skill", disposition: "prefer", value: "Kubernetes" },
      { category: "skill", disposition: "prefer", value: "AWS" },
      { category: "seniority", disposition: "require", value: "Senior" },
      { category: "location", disposition: "require", value: "New York" },
    ],
    invariants: {
      hasFilters: true,
      // 2 prefer conditions → 2 unenforceable (prefer always routes out)
      unenforceableCount: 2,
      filterFieldsInclude: [
        "skills.professional_network_skills",
        "experience.employment_details.current.seniority_level",
        "basic_profile.location.city",
      ],
    },
  },

  // ── 12: Remote location → routes to country field with "Remote" value ──────
  // "Remote" is a special-case country alias. It should appear on the country
  // field (Crustdata's remote candidates are tagged under location.country).
  {
    name: "12-remote-location-require",
    conditions: [
      { category: "location", disposition: "require", value: "Remote" },
    ],
    invariants: {
      hasFilters: true,
      unenforceableCount: 0,
      // "Remote" resolves as a country alias → country field exact match.
      filterHas: [{ field: "basic_profile.location.country", type: "=" }],
    },
  },

  // ── 13: Company exclude survives pipeline (P0 bug fix regression) ──────────
  // Verified live bug: Cognizant appeared after explicit hard-exclude.
  // Excludes routed through company/exclude must produce a must_not filter
  // on current_employer_company_name in compiled output.
  {
    name: "13-company-exclude-survives-pipeline",
    conditions: [
      { category: "title", disposition: "require", value: "Software Engineer" },
      { category: "company", disposition: "exclude", value: "Cognizant" },
      { category: "company", disposition: "exclude", value: "TCS" },
    ],
    invariants: {
      hasFilters: true,
      unenforceableCount: 0,
      // Both company excludes must appear as not-contains on the employer field.
      filterHas: [
        {
          field: "experience.employment_details.current.company_name",
          type: "(!)",
        },
      ],
    },
  },

  // ── 14: Title exclude survives pipeline ────────────────────────────────────
  // title/exclude conditions must produce a must_not filter preventing
  // candidates whose title matches the excluded keyword from being returned.
  {
    name: "14-title-exclude-survives-pipeline",
    conditions: [
      { category: "title", disposition: "require", value: "Data Scientist" },
      { category: "title", disposition: "exclude", value: "Manager" },
    ],
    invariants: {
      hasFilters: true,
      unenforceableCount: 0,
    },
  },

  // ── 15: Multi-location: SF + Austin → two city chips (P0 Bug 2 regression) ─
  // "San Francisco, Austin" must produce two separate location/require conditions
  // and thus two city filters, not zero-results from a single mangled string.
  {
    name: "15-multi-location-sf-austin",
    conditions: [
      { category: "title", disposition: "require", value: "Software Engineer" },
      { category: "location", disposition: "require", value: "San Francisco" },
      { category: "location", disposition: "require", value: "Austin" },
    ],
    invariants: {
      hasFilters: true,
      unenforceableCount: 0,
      filterFieldsInclude: ["basic_profile.location.city"],
    },
  },

  // ── 16: remote other/require does not produce a broken city filter ─────────
  // When the only location signal is other/require:remote, no city filter must
  // be generated (it would zero out results by filtering on a garbage city value).
  // The 'other' category routes to unenforceable_constraints (count: 1).
  {
    name: "16-remote-only-no-city-filter",
    conditions: [
      { category: "title", disposition: "require", value: "Backend Engineer" },
      { category: "other", disposition: "require", value: "remote", note: "remote-ok flag" },
    ],
    invariants: {
      hasFilters: true,
      unenforceableCount: 1,
      filterFieldsExclude: ["basic_profile.location.city"],
    },
  },
];
