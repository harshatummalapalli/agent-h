# ADR: Table-driven taxonomy lookups + single filter compiler

**Date:** 2026-07-30
**Status:** Accepted
**Context:** Agent H — Search & Intake Reliability Redesign (spec: `docs/search-intake-reliability-redesign.md`)

---

## Context and problem

Three confirmed bugs all had the same root cause:

1. **Seniority** — `crustdataIntentValidator.ts` forwarded the raw internal enum token (`mid_level`) as a Crustdata filter value. No real profile ever contains the literal string `mid_level`; the filter matched nothing silently.
2. **Location** — country vs. city classification was a word-count heuristic (`!value.includes(",") && split(/\s+/).length <= 3`). "San Francisco" (2 words, no comma) was mis-classified as country-like and exact-matched against the country field → zero results. The exclude branch ALWAYS used city not-contains regardless of input, making "exclude India" a no-op.
3. **Filter compiler duplication** — `crustdataFilterCompiler.ts` (used by `/build-search`) and `crustdataIntentValidator.ts` (used by real sourcing) were independent compilers for the same vendor API. Bug fixes applied to one silently left the other broken.

The underlying structural problem: **classification decisions (is this a seniority level? a country? a city?) were made by guessing from string shape at query-compile time** instead of by looking up a reference table built and tested once. Guessing from string shape has an infinite input space — it cannot converge.

---

## Decision

### 1. Table-driven taxonomy lookups for closed vocabularies

New module: `supabase/functions/_shared/taxonomies/` — plain TypeScript, no Deno-specific APIs, Vitest-compatible.

- **`seniority.ts`**: `SENIORITY_ALIASES` (alias → canonical) + `SENIORITY_CRUSTDATA_VOCAB` (canonical → real vocab terms in Crustdata profiles). `resolveSeniority()` returns `CanonicalSeniority | null`.
- **`location.ts`**: `COUNTRY_ALIASES` + `CITY_ALIASES` → `ResolvedLocation` with `kind: "country" | "city" | "unknown"`. `resolveLocation()` resolves at parse time; the compiler uses the pre-resolved `locationKind` field on the condition.
- **`skills.ts`**: `SKILL_ALIASES` for normalization. Skills are open-ended (unlike seniority/location); unresolved skills still become chips but are logged.

**Key principle**: Adding a new phrasing = adding a row to an alias table. Never add a new compiler `if`-branch for a vocabulary case.

### 2. Single filter compiler

**Delete `crustdataFilterCompiler.ts`** (581 lines). `crustdataIntentValidator.ts` becomes the only compiler for all Crustdata filter assembly.

- `SearchIntentCondition` extended with 8 new categories (`headcount_range`, `connections_min`, `education_school`, `education_degree`, `education_field`, `headline_keyword`, `language`, `company_industry`) and `locationKind?: "country" | "city" | "state"`.
- `crustdataIntentValidator.ts` handles all categories the old `FilterDraft` compiler handled.
- `BuildSearchPage.tsx` converts its form state → `SearchIntentCondition[]` (via `draftToConditions()`) before calling the edge function or `saveSearchIntent`.
- `BuildSearchTab.tsx` reduced to a thin link-out; `BuildSearchTabLegacy`, `intentToDraft`, `dealBriefToDraft` deleted.

### 3. Regression corpus

`supabase/functions/_shared/__fixtures__/jd-corpus/corpus.ts` — 12 fixtures covering the confirmed bugs and key edge cases. `crustdataIntentValidator.corpus.test.ts` — snapshot + named invariant tests. Required for any PR touching the compiler, taxonomies, or `parsedBriefToConditions.ts`.

---

## Open decisions documented

| Decision | Choice | Rationale |
|---|---|---|
| "Lead" → which canonical seniority? | `staff` | JD vocabulary "Lead Engineer"/"Tech Lead" maps closest to Staff IC in Crustdata's ladder. Single row in `SENIORITY_ALIASES` to change later. |
| Location reference data source | Static curated list (aliases + corpus cities) | GeoNames import deferred for v1 — the corpus covers all real JD cities encountered. City list grows via `resolveLocation()` returning `unknown` → log → alias-table PR. |
| Ranking algorithm v1 | Weighted prefer-match count (no ML) | `rankCandidates.ts`: score = number of prefer conditions that substring-match in normalized profile fields. Sufficient for v1; ML ranking deferred. |

---

## Consequences

**Positive:**
- Seniority and location bugs are fixed for all JDs, not just the ones that triggered the bug report.
- Adding "Growthleader III" as a recognized seniority level = one row in `SENIORITY_ALIASES`, not a code change.
- Any PR touching the compiler fails the corpus test if it silently regresses a fixture.
- One compiler means one place to fix filter bugs.

**Negative / trade-offs:**
- The taxonomy alias tables must be maintained; unrecognized terms go to `unenforceable_constraints` and the `unresolved_taxonomy_terms` log table. Occasional taxonomy-maintenance PRs are expected.
- `BuildSearchPage.tsx` now has a local `draftToConditions()` function that must stay in sync with `crustdataIntentValidator.ts`'s handling of the new categories. If a new category is added to the validator, `draftToConditions` needs a corresponding line. This is documented in a comment in `BuildSearchPage.tsx`.
- `require/prefer` capping at `MAX_REQUIRE=3` skills changes behavior for JDs with many stated must-haves. Recruiters who relied on 6+ hard AND-skills getting a specific filter shape will see overflow skills shift to `prefer`. This is intentional (acceptance criterion 4) but may surprise existing users.
