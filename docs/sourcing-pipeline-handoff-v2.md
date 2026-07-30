# Agent H — Sourcing Pipeline Handoff (v2)

**Date:** 2026-07-30
**Status:** Build-ready. Supersedes `AGENT_H_SOURCING_STRATEGY_DECISIONS_2026-07-30.md` for
everything about the sourcing pipeline itself — that doc's vendor cost table is still valid,
but its build order is superseded by §9 below. This is the one doc to hand Cursor now.

---

## HARD GATE — only §1 this wave (unless §1 finishes clean and small §1-adjacent items fit)

**Nothing else in the handoff ships until §1 is fixed and test-proven.** Do NOT start Harvest enrichment, radius, photo column, ranking reorder, pooling, credit UI, or route unification in this wave.

---

## §1 — CRITICAL (confirmed in repo)

Recruiters use `startCalibrationSourcing` / `calibrationNextBatch` → `calibration-session` → `searchCrustdataForRoleBrief()` in `_shared/crustdataClient.ts`.

`buildCalibrationFilters()` builds title/location/seniority/YoE/one skill — **zero exclude handling** (grep confirms). Ranking only annotates conflicts in why_fit — does not drop. `source-candidates-discovery/crustdataQueryBuilder.ts` already has real `excludedCompanies` / `exclusionKeywords` not-contains — but discovery isn't the live pull path.

`excludePostFilter.ts` may exist from a prior wave — **wire it into calibration-session** if not already; query-time exclude is still required.

`resolve-search-intent` persistIntent claims to back-fill flat columns but Harsha observed refine updates jsonb intent without flat `excluded_companies`. Fix so back-fill **always** writes those columns from intent exclude conditions (use `excluded_companies: excludedCompanies` even when empty array, so clears sync too — don't only spread when length > 0 if that leaves stale/empty divergence). Verify the deployed code path actually PATCHes.

### Required implementation (in order)

1. **Unify query build for calibration pull onto real exclude support**
   - Preferred: `searchCrustdataForRoleBrief` / calibration path builds filters via `crustdataQueryBuilder.ts` `CrustdataSearchCriteria` (or share exclude-building helpers) instead of the narrow `CalibrationRoleBrief` filter builder — so excludes aren't a third divergent model.
   - Pass `excluded_companies` + `exclusion_keywords` from the deal brief / SearchIntent into that builder on every calibration search.
   - Also read excludes from `role_brief_search_intent.current.conditions` (company/title exclude) as source of truth, merging with flat columns so refine-only jsonb still enforces even if flat backfill lagged.

2. **Post-fetch safety net** in `calibration-session` before `rank-discovery-batch`:
   - Reuse `applyExcludeFilter` from `_shared/excludePostFilter.ts` (extend if needed for current company/title fields on Crustdata result shape).
   - Drop matching candidates before ranking.

3. **`resolve-search-intent` flat column sync** — always persist `excluded_companies` / `exclusion_keywords` from intent conditions on every successful refine (including empty arrays to clear).

4. **Tests**
   - Unit: calibration filter build includes company/title not-contains for excludes.
   - Unit: post-filter drops excluded company from a mock batch.
   - Corpus or unit: SearchIntent company/exclude → filters + post-filter.
   - Document live verify steps for Harsha: (a) JD paste exclude (b) Home chat exclude (c) role command bar `exclude TCS` → Start/Continue sourcing → zero matches from that company.

### Success criteria
- Excludes that exist in intent OR flat columns are enforced at **query time** on the calibration pull path AND post-filtered before rank.
- Refine via command bar updates flat columns.
- Deploy list: `calibration-session`, `resolve-search-intent`, and any shared modules bundled with them.

### After §1 only if clean and small
If §1 is solid and you have bandwidth, you may stub types/notes for §3 (radius, past excludes) in the shared builder **without** shipping Harvest/schema — otherwise stop after §1.

### Open items (document, don't decide against Harsha)
- PDL vs Harvest for Enrich button — flag in summary, don't build §4 yet
- Phone gap stays open

### Return
- Confirm root cause (calibration path had no excludes)
- Files changed
- Deploy commands
- Exact live verify checklist for Windows (`git pull`, `npm run dev`, which functions to deploy)
- Explicit: pooling/enrichment NOT started
