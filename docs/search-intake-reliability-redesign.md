# Agent H — Search & Intake Reliability Redesign

**Date:** 2026-07-30
**Status:** Build-ready spec. Written for implementation by any agent (Cursor,
Claude, or a human) without needing the rest of the chat history that produced
it — everything an implementer needs to make the same decisions is inline
below, with exact file references against the current repo.
**Author context:** Follows from a product/architecture review of the JD
Intake → SearchIntent chips → Crustdata filter flow. Read this whole doc
before touching code — Sections 1–2 are the "why," Sections 3–7 are the "what
to build," Section 8 is "how we know it worked."

## 0. One-paragraph summary

Search quality bugs today (wrong seniority filters, broken location excludes,
zero-result searches) get fixed one JD at a time and don't stay fixed, because
the system has no canonical vocabulary — it matches raw, LLM-parsed text
straight against the vendor API. This proposal replaces free-text matching
with table-driven lookups for the closed-vocabulary fields (seniority,
location, company), separates "must be true" from "makes someone a better
fit" so a search never returns a blank screen, consolidates two duplicate
filter compilers into one, and adds a standing regression corpus so a fix
can't silently break something else. None of this requires new vendor
data or new UI paradigms — it's entirely about making the existing pipeline
deterministic where it can be, and honest about where it can't.

## 1. Root cause: why fixes don't generalize

Three specific, already-confirmed bugs, all with the same shape:

- **Seniority.** `JdIntakePage.tsx`'s `SENIORITY_OPTIONS` are internal enum
  tokens (`entry_level`, `mid_level`, `staff`, ...). `parsedBriefToConditions.ts`
  pushes `brief.seniority` straight into a `seniority/require` chip. On the
  backend, `crustdataIntentValidator.ts` (`case "seniority"`) turns that into
  a `(.)`-contains match against Crustdata's seniority field. A real profile
  will never contain the literal string `mid_level` — so this filter is
  silently unmatchable for most roles today.
- **Location.** Same file, `case "location"`: whether a value is treated as a
  country (`=` exact match) or a city (`(.)` contains match) is decided by
  `!value.includes(",") && value.split(/\s+/).length <= 3` — a word-count
  heuristic. "San Francisco" (2 words, no comma) gets treated as a country
  and exact-matched against the country field: zero results, no error.
  Exclude-location is worse — it *always* compiles to a city not-contains,
  so excluding "India" checks whether a city field contains the word "India,"
  which will essentially never match: a filter that looks enforced but is
  actually a no-op.
- **Skills.** Every `skill/require` chip becomes its own AND'd condition with
  no upper bound and no warning. `BuildSearchPage.tsx`'s Skills section
  explicitly warns "Too many AND skills → zero results. Keep to 2–3 critical
  ones" — but that warning only exists in the read-only sandbox page, not in
  `SearchIntentEditor.tsx`, which is what actually drives live sourcing.

None of these are JD-specific bugs. They're all instances of the same
mistake: a **classification decision (is this a seniority level? a country?
a city? a real hard requirement?) is being made by guessing from the shape
of a string, at query-compile time, instead of by looking it up in a
reference table built and tested once.** Guessing from string shape has an
infinite input space (every JD phrases things differently), so it can never
converge — you fix the phrasing in front of you and the next JD invents a
new one. A table lookup has a finite, closed input space — once "Staff
Engineer" → `staff` is in the table, it's correct for every JD forever.

**Second root cause: there's no standing test corpus.** Every fix today is
validated against the one JD that triggered it. Nothing catches a fix that
helps JD #47 and breaks JD #12. Section 7 fixes this.

**Third root cause: two independent filter compilers for one vendor.**
`crustdataIntentValidator.ts` (chips → filters, drives real sourcing) and
`crustdataFilterCompiler.ts` (`FilterDraft` → filters, drives the
`/build-search` sandbox) duplicate the entire AND/OR semantics table and
field-mapping logic with zero shared code — `types.ts` even says so in
its own comment ("Mirrors `_shared/crustdataFilterCompiler.ts` FilterDraft —
kept in sync manually; no shared import"). A bug fixed in one has no
mechanism to propagate to the other. Section 5 merges them.

## 2. Design principle for everything below

**Replace "guess from string shape" with "look up in a table you control."**
Every fix produced by this proposal should be addable as a data row (a new
taxonomy entry, a new corpus JD), never as a new `if` branch in the compiler.
If an implementer finds themselves writing a new heuristic to handle a case,
that's a signal the taxonomy is missing an entry, not that the code needs a
special case.

## 3. Canonicalization layer

New shared module: `supabase/functions/_shared/taxonomies/` (new directory).
Each taxonomy is a plain TypeScript module exporting a lookup table + a
`resolve()` function — no Deno-specific APIs, so it's usable from both edge
functions and (via a thin re-export, same pattern as `searchIntent.ts`
already uses — "No Deno-specific imports — Vitest-compatible") the frontend
where needed for validation/autocomplete.

### 3.1 Seniority taxonomy — `taxonomies/seniority.ts`

```ts
export type CanonicalSeniority =
  | "intern" | "entry_level" | "mid_level" | "senior"
  | "staff" | "principal" | "manager" | "director" | "executive";

// Maps ANY known phrasing → canonical value. Grows only by adding rows.
export const SENIORITY_ALIASES: Record<string, CanonicalSeniority> = {
  "staff engineer": "staff", "staff": "staff", "l5": "staff", "ic5": "staff",
  "senior": "senior", "sr": "senior", "sr.": "senior",
  "principal": "principal", "principal engineer": "principal",
  "lead": "staff", // JD-vocabulary decision — see open question in §9
  // ... full list populated from the JD corpus (§7), not invented up front
};

export function resolveSeniority(raw: string): CanonicalSeniority | null {
  const key = raw.trim().toLowerCase();
  return SENIORITY_ALIASES[key] ?? null;
}
```

**Behavior change required in `crustdataIntentValidator.ts`:** the
`case "seniority"` branch must call `resolveSeniority()` first. If it
resolves, use the **canonical value's known Crustdata-vocabulary synonyms**
(a second small table: canonical → the actual words that show up in real
profiles, e.g. `staff` → `["Staff", "Staff Engineer", "L5", "Senior Staff"]`,
OR'd together) instead of the raw enum token. If it does NOT resolve (a
phrasing the table hasn't seen yet), route it to `unenforceable_constraints`
with a clear reason ("Seniority phrase '{raw}' not yet recognized — filtered
out, added to review queue") rather than silently sending a broken filter —
**and log it** (§3.4) so it becomes a taxonomy entry instead of a recurring
support ticket.

**Behavior change required in `JdIntakePage.tsx`:** `SENIORITY_OPTIONS`
(the dropdown) should populate from `Object.keys(SENIORITY_ALIASES)`
canonical values, not a separately-hardcoded list — one source of truth.

### 3.2 Location taxonomy — `taxonomies/location.ts`

Replace the word-count heuristic with a real reference list: countries (all
~195, with common aliases: "US"/"USA"/"United States"/"America" → `USA`) and
a curated city list seeded from the corpus (§7) plus any city Crustdata's
own autocomplete (`autocompleteCrustdataField`, already wired in
`BuildSearchPage.tsx`) has returned in a real search — i.e., the city list
grows from live usage, not from a static import.

```ts
export type ResolvedLocation =
  | { kind: "country"; canonical: string }   // e.g. "United States"
  | { kind: "city"; canonical: string; country?: string }
  | { kind: "unknown"; raw: string };

export function resolveLocation(raw: string): ResolvedLocation { ... }
```

**Behavior change required in `crustdataIntentValidator.ts`:** `case
"location"` calls `resolveLocation()` and branches on `.kind`, not on word
count. `kind: "unknown"` routes to `unenforceable_constraints` (never
silently sent as a broken filter) and is logged (§3.4).

**Exclude-location bug fix:** once `resolveLocation` distinguishes
country/city, the exclude branch must use the *matching* field (country
not-equal for a resolved country, city not-contains for a resolved city) —
today it always uses city not-contains regardless of what was excluded.

**Also fix `parsedBriefToConditions.ts`:** it currently emits a single
generic `location` chip category with no country/city distinction at parse
time either (it just splits on `/` for multiple cities). Once §5's chip
schema extension lands, the parser should call `resolveLocation()` at parse
time and store the resolved kind on the chip, so the ambiguity is resolved
once, at intake, not re-guessed every time the compiler runs.

### 3.3 Company taxonomy — extend `company_intelligence`

You already have `supabase/schemas/*_agent_h_company_intelligence*.sql`
(product/services/gcc classification, global not tenant-scoped, 23 seed
companies). Extend this table with an `aliases text[]` column (e.g. `Meta`
→ `["Facebook", "FB", "Meta Platforms"]`) and use it for company-name
resolution in both `expandCompanyAcronym` (already exists in
`crustdataIntentValidator.ts` for FAANG-style acronyms — this generalizes
that exact pattern to single-company aliasing) and for company excludes in
`JudgmentPacks`. Same table, same maintenance model you already run for
product/services/gcc tagging — this is additive, not a new system.

### 3.4 Skills taxonomy — grows from flagged gaps, not built up front

Skills are open-ended, so don't pre-populate a skills ontology. Instead:

1. `normalizeSkillTokens()` in `parsedBriefToConditions.ts` already does
   token cleanup (splitting, filler-stripping). Add a second pass: check
   each cleaned token against a `taxonomies/skills.ts` alias table (seeded
   empty, or seeded from O*NET's technology-skills list as a starting point
   — see the earlier job-platform-APIs research in this thread, O*NET Web
   Services is free and DOL-sponsored).
2. Any token that doesn't resolve is **not blocked** — it still becomes a
   chip (skills are genuinely open-ended, unlike seniority/location which
   are closed vocabularies) — but it gets logged to a new table,
   `unresolved_taxonomy_terms` (`term text, category text, deal_id, jd_text_excerpt,
   created_at`), the same landing spot seniority/location unknowns log to.
3. A weekly (or on-demand) review of `unresolved_taxonomy_terms` is how the
   skills table grows — a human (or an LLM-assisted batch pass) promotes
   recurring unresolved terms into aliases. This converts "a skill got
   mangled in this JD" from a code-review finding into a data-entry task,
   which is the whole point of this proposal.

### 3.5 The logging table — one shared sink

```sql
create table unresolved_taxonomy_terms (
  id bigint generated always as identity primary key,
  category text not null check (category in ('seniority','location','company','skill')),
  raw_term text not null,
  deal_id bigint references deals(id),
  occurred_at timestamptz not null default now()
);
```

Every taxonomy `resolve()` function that fails to match writes here (fire
and forget, non-blocking). This single table becomes the punch list for
"what taxonomy entries are we missing," replacing the current situation
where a miss just silently produces a bad filter and someone eventually
notices candidates look wrong.

## 4. Require/Prefer separation + ranking + relaxation ladder

### 4.1 Default disposition — change what the LLM parse defaults to

Today, `parse-job-description`'s system prompt (not reviewed in this doc —
implementer should locate it under `supabase/functions/parse-job-description/`)
presumably extracts most stated requirements as `required_skills`/
`must_have_keywords`, which `parsedBriefToConditions.ts` maps straight to
`skill/require`. Change the default: **only skills the recruiter explicitly
marks, or that the JD states with unambiguous hard language ("must have,"
"required," "non-negotiable") stay Require; everything else the parser
extracts defaults to Prefer.** This is a prompt change in the parse function
plus a corresponding default in `parsedBriefToConditions.ts` (currently
`required_skills` + `must_have_keywords` both hard-map to `skill/require` —
change so only a smaller, explicitly-flagged subset does).

### 4.2 Ranking pass — the missing piece that makes Prefer meaningful

Currently `routePrefer()` in `crustdataIntentValidator.ts` moves every
`prefer` condition to `unenforceable_constraints` with the reason "will
inform why-fit scoring instead" — but no ranking pass consumes that
information today (per the earlier Agentic Canvas review: ranking is
flagged as net-new work, not yet built). This is the single highest-leverage
build item in this whole proposal, because without it, Prefer chips are
inert and the whole Require/Prefer split doesn't actually solve the
volume-vs-precision problem — it just moves where the noise/silence
tradeoff happens.

Build a ranking function (new: `supabase/functions/_shared/rankCandidates.ts`)
that takes the full Require+Exclude-filtered candidate set and the `prefer`
conditions, scores each candidate (weighted match count is an acceptable v1
— does not need to be ML), and returns a ranked list with, for each
candidate, which `prefer` conditions matched and (reusing the existing
`quote_verifications` anti-hallucination pattern already built for
`candidate_scores`/`candidate_fit_assessments`) a substring-checkable quote
from their profile as evidence. This is additive to schema already in place
— no new tables required beyond what `candidate_scores`/
`candidate_fit_assessments` already carry.

### 4.3 Relaxation ladder — apply at on-demand search time, not just continuous mode

The continuous-sourcing relaxation ladder (allowlisted relaxable fields,
logged relaxation events, hard cap on steps, never silent) was already
designed for the overnight/scheduled trigger mode. Extend the same function
to run synchronously on a thin Require-set result: if `continueSourcingForDeal`
(or its Crustdata-path equivalent) returns below a floor (e.g. < 5 candidates),
relax one allowlisted field (same allowlist: company size, YoE, must-have
downgrade — never `required_skills`'s truly-hard subset or `excluded_companies`),
re-run, and surface to the recruiter exactly what was relaxed, same
one-line-disclosure UX already speced ("widened company size after 3 quiet
nights" → "widened SIEM to include Splunk/QRadar equivalents for this
search"). No new backend concept — this is reusing an already-designed
mechanism in a new trigger context.

## 5. Compiler consolidation — one canonical filter model

Merge `SearchIntentCondition` (`supabase/functions/_shared/searchIntent.ts`)
and `FilterDraft` (`supabase/functions/_shared/crustdataFilterCompiler.ts` /
`src/components/atomic-crm/types.ts`) into one model. Concretely:

1. Extend `SearchIntentCondition` categories to carry the structure
   `FilterDraft` has that chips currently lack — e.g. `location` conditions
   gain a `locationKind: "country" | "city" | "state"` field (populated by
   §3.2's `resolveLocation` at parse/edit time), and add categories for
   `headcount_range`, `connections_min`, `education_school`,
   `education_degree`, `education_field`, `headline_keyword` — i.e., every
   field `FilterDraft` has that `SearchIntentCondition` doesn't, promoted
   into the canonical model as new `category` values or new optional fields
   on the existing condition shape (implementer's call which is cleaner —
   likely new categories, following the existing pattern).
2. Delete `crustdataFilterCompiler.ts`. `crustdataIntentValidator.ts` becomes
   the **only** compiler — it must now handle the newly-added categories
   (headcount, education, etc.) that only `FilterDraft` used to support.
3. `BuildSearchPage.tsx` stops calling `searchCrustdataFilters` with a
   `FilterDraft`; it becomes the "Advanced" expansion on the same page/record
   that edits `SearchIntentCondition[]` directly (still using its existing
   `TagInput`/`AutocompleteTagInput` components — those don't need to change,
   only what they write to changes). Its results **do** feed back —
   `onSave`/`onContinue` call the same `saveSearchIntent` path
   `JdIntakePage.tsx` already uses, so tuning in Advanced mode is never
   thrown away.
4. Delete `BuildSearchTabLegacy` in `BuildSearchTab.tsx` (the ~360-line
   dead function already tagged "TASK-039 will remove it" — this proposal
   is that ticket).
5. `intentToDraft()` / `dealBriefToDraft()` in `BuildSearchTab.tsx` are no
   longer needed once there's only one model to prefill from — delete them,
   `BuildSearchPage.tsx` reads `deal.role_brief_search_intent.current.conditions`
   directly.

## 6. Unified intake surface

Merge the free-text command bar (`runFreeTextCommand` in `JdIntakePage.tsx`,
which today calls `parseAgentCommand`) and the JD-paste flow
(`handleParse`, calling `parseJobDescription`) into one input affordance:
a single text area that accepts a pasted JD, a one-line ask, or (already
wired per `useVoiceInput.ts`) voice, and always resolves to the same
`ParsedRoleBrief` → chips pipeline. Implementer decision: the simplest
version is a length/shape heuristic in the frontend (a paste over ~200
words routes to `parseJobDescription`; anything shorter routes to
`parseAgentCommand`'s `create_role` path first, which can itself call
`parseJobDescription`-equivalent logic if it detects enough structure) —
this is a UI/routing simplification, not a new backend capability, since
both paths already terminate in the same chip model.

Clarifying-question behavior (`clarifying_questions` in `ParsedRoleBrief`,
already built) should fire more often for short inputs and rarely for full
JDs — no code change needed here if `parse-job-description`'s prompt already
asks clarifying questions proportional to information gaps; verify this is
actually the current behavior before assuming it needs work.

## 7. Regression corpus — the standing test set

New directory: `supabase/functions/_shared/__fixtures__/jd-corpus/` — 30–50
real, anonymized JDs actually used to source against (pull from `deals.jd_text`
in the live project, strip company-identifying details, keep the structure
that caused past problems — tiered-preference JDs like the Epiq example
already referenced in code comments, GCC-exclusion JDs, the fintech-security
example from this proposal's own design conversation).

For each corpus JD, a fixture file records: the JD text, the expected
resolved chips (category/disposition/value, including which should land in
`unenforceable_constraints`), and the expected compiled Crustdata filter
shape for the Require/Exclude subset. A new test,
`crustdataIntentValidator.corpus.test.ts`, runs every corpus JD's expected
chips through `validateAndAssembleIntent()` and asserts the compiled output
matches — this is a snapshot/golden-file test, not hand-asserted per field,
so adding a new corpus JD is cheap.

**Process requirement, not just a test file:** any PR touching
`crustdataIntentValidator.ts`, `parsedBriefToConditions.ts`, or any
`taxonomies/*.ts` file must run the full corpus, not just the JD that
motivated the change. Per this repo's own `.claude/rules/validation-commands.md`,
test execution is already automated via the `validate-on-stop.mjs` hook —
this corpus test just needs to be part of that same suite so it's not an
extra manual step.

## 8. Acceptance criteria

Concrete, testable, and directly tied to the bugs in §1:

1. A JD requiring `"Mid-Level"` seniority (any real-world phrasing: "mid
   level," "Mid-Level," "3-5 years, non-senior") compiles to a filter that
   matches actual Crustdata seniority-field vocabulary — verified by the
   seniority corpus fixtures, not by manual spot-check.
2. A JD excluding candidates in "India" (a country) produces a filter that
   actually excludes India-based candidates, verified against a fixture
   with a known India-based test profile.
3. A JD excluding candidates in "San Francisco" (a city) is not
   misclassified as a country.
4. A JD with 6+ stated "must-have" skills does not produce a zero-candidate
   search by default — at most 2–3 stay Require, the rest rank.
5. Every corpus JD's parse output contains zero conditions that would have
   silently failed under the pre-fix heuristics (spot-checked once at
   corpus-build time, then guarded permanently by the snapshot test).
6. `crustdataFilterCompiler.ts`, `BuildSearchTabLegacy`, `intentToDraft`,
   `dealBriefToDraft` no longer exist in the codebase.
7. Tuning filters in `/build-search` Advanced mode and clicking Save/Continue
   demonstrably updates `deals.role_brief_search_intent` (verify via a test
   that asserts the deal row changed, not just that the UI didn't error).

## 9. Open decisions (choices made for v1 implementation)

- **"Lead" → `staff`:** Maps "Lead" to `staff` in the seniority taxonomy for
  v1. Noted in taxonomy comment; adjustable by adding/changing one alias row.
- **Location reference data:** Countries seeded from ISO 3166-1 aliases (+
  common aliases like US/USA/America); cities seeded from corpus JDs. No full
  GeoNames import in v1 — city list grows from live usage via Crustdata
  autocomplete.
- **Ranking algorithm v1:** Weighted prefer-match count + quote substring
  check where possible. No ML. Ship simple, iterate.

## 10. Suggested build order

1. Taxonomy modules + logging table (§3) — smallest, most isolated, fixes
   the two confirmed live bugs immediately.
2. Regression corpus (§7) — build this *before* the compiler consolidation
   so the merge in §5 has a safety net while it happens, not after.
3. Compiler consolidation (§5) — now protected by the corpus.
4. Require/Prefer default change + ranking pass (§4) — the biggest single
   product-quality lever, sequenced after the filter layer is trustworthy.
5. Relaxation ladder at on-demand time (§4.3) — depends on ranking existing.
6. Unified intake surface (§6) — purely additive UI simplification, can
   land any time after step 1, doesn't block or get blocked by the rest.

---

*Implementation note for whoever picks this up (Cursor or otherwise): every
file path above was verified against the current repo as of 2026-07-30.
If a referenced file has moved or been renamed since, treat the described
*behavior* as the source of truth, not the literal path.*
