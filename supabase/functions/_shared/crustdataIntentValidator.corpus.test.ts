// Corpus test for crustdataIntentValidator.
//
// Golden / snapshot-style: each fixture in JD_CORPUS is compiled through
// validateAndAssembleIntent() and its output is stored as a Vitest snapshot.
// The snapshots serve as the standing test set — any change to the compiler,
// taxonomy, or field mappings that silently alters behavior will fail here.
//
// To add a new corpus fixture:
//   1. Add a new entry to __fixtures__/jd-corpus/corpus.ts
//   2. Run `vitest --update-snapshots` once to record the golden output
//   3. Review the snapshot diff in CR — it IS the acceptance test
//
// To update a snapshot after an intentional compiler change:
//   vitest run --update-snapshots supabase/functions/_shared/crustdataIntentValidator.corpus.test.ts
//
// Process requirement (per spec §7): any PR touching crustdataIntentValidator.ts,
// parsedBriefToConditions.ts, or any taxonomies/*.ts file must run this suite.

import { describe, it, expect } from "vitest";
import { validateAndAssembleIntent } from "./crustdataIntentValidator.ts";
import type { VersionedSearchIntent } from "./searchIntent.ts";
import { JD_CORPUS } from "./__fixtures__/jd-corpus/corpus.ts";
import type {
  CrustdataCondition,
  CrustdataGroup,
} from "./crustdataIntentValidator.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIntent(
  conditions: VersionedSearchIntent["conditions"],
  unenforceable_constraints: VersionedSearchIntent["unenforceable_constraints"] = [],
): VersionedSearchIntent {
  return {
    version: 1,
    updated_at: "2026-01-01T00:00:00.000Z",
    conditions,
    unenforceable_constraints,
  };
}

/** Flatten a CrustdataGroup (any nesting) into leaf conditions. */
function flattenFilters(
  node: CrustdataCondition | CrustdataGroup | null | undefined,
): CrustdataCondition[] {
  if (!node) return [];
  if ("field" in node) return [node as CrustdataCondition];
  return (node as CrustdataGroup).conditions.flatMap(flattenFilters);
}

// ─── Snapshot tests (one per fixture) ────────────────────────────────────────

describe("crustdataIntentValidator corpus — snapshot", () => {
  for (const fixture of JD_CORPUS) {
    it(fixture.name, () => {
      const intent = makeIntent(
        fixture.conditions,
        fixture.existingUnenforceable ?? [],
      );
      const result = validateAndAssembleIntent(intent);
      // Snapshot the entire result so any structural change is caught.
      expect(result).toMatchSnapshot();
    });
  }
});

// ─── Named invariant tests (acceptance criteria) ──────────────────────────────
//
// These are explicit named assertions on top of the snapshots — they document
// which properties are load-bearing so reviewers see the intent, not just a
// snapshot diff. Both must pass: snapshots catch unexpected changes, invariants
// catch intentional regressions that happen to satisfy a new snapshot.

describe("crustdataIntentValidator corpus — invariants", () => {
  for (const fixture of JD_CORPUS) {
    const { invariants } = fixture;
    if (!invariants) continue;

    it(`${fixture.name} — invariants`, () => {
      const intent = makeIntent(
        fixture.conditions,
        fixture.existingUnenforceable ?? [],
      );
      const result = validateAndAssembleIntent(intent);
      const leaves = flattenFilters(result.filters);

      if (invariants.unenforceableCount !== undefined) {
        expect(result.unenforceable).toHaveLength(
          invariants.unenforceableCount,
        );
      }

      if (invariants.unenforceableReasonIncludes) {
        const allReasons = result.unenforceable.map((u) => u.reason).join(" ");
        for (const phrase of invariants.unenforceableReasonIncludes) {
          expect(allReasons).toContain(phrase);
        }
      }

      if (invariants.hasFilters === true) {
        expect(result.filters).not.toBeNull();
      } else if (invariants.hasFilters === false) {
        expect(result.filters).toBeNull();
      }

      if (invariants.filterFieldsInclude) {
        const fields = new Set(leaves.map((c) => c.field));
        for (const field of invariants.filterFieldsInclude) {
          expect(fields).toContain(field);
        }
      }

      if (invariants.filterFieldsExclude) {
        const fields = new Set(leaves.map((c) => c.field));
        for (const field of invariants.filterFieldsExclude) {
          expect(fields).not.toContain(field);
        }
      }

      if (invariants.filterHas) {
        for (const { field, type } of invariants.filterHas) {
          const match = leaves.find(
            (c) => c.field === field && c.type === type,
          );
          expect(
            match,
            `Expected filter on field="${field}" type="${type}"`,
          ).toBeDefined();
        }
      }
    });
  }
});
