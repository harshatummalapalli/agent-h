# Sourcing Strategy Reliability Decisions

**Date:** 2026-07-30
**Status:** Build-ready spec. Supersedes `docs/search-intake-reliability-redesign.md`.
**Branch:** `cursor/premium-ux-leak-fixes-617f`
**Author context:** Follows from a live-test review of the current JD-paste → SearchIntent → Crustdata pipeline. Confirmed two live bugs (Cognizant appearing after explicit exclude; multi-location collapsing to garbage). Extends Wave 1–5 work (taxonomies, corpus, compiler consolidation, relaxation, unified intake).

---

## §0. Path

Fix two confirmed live bugs before anything new. Then candidate-pooling via sequential relaxation ladder (not parallel 3-tier — cost). Keep conversational Route 1 reliable meantime; invest JD-paste so it becomes primary. Build Search = refinement layer under both, not third start.

---

## §1. Route strategy

- **Primary target:** JD-paste unified with conversational engine (same chat surface, answerable clarifying Qs, recap-with-deltas). Retire old `/jd-intake` separate interaction model (dropdown-only seniority, dismiss-only clarifying Qs) — paste lands in same chat as home free-text.
- **Keep** home conversational box as reliable fallback while fixing JD-paste.
- **Build Search** not a third start: copy "Fine-tune this search" when `deal_id` present; "Build a search from scratch" only when no role.

---

## §2. P0 — blocking bugs (SHIP FIRST)

### Bug 1: Exclude conditions silently dropped on every route

**Live evidence:** Cognizant appeared after explicit hard-exclude. `unresolved_taxonomy_terms` empty → drop is upstream of taxonomy.

**Root cause:** `resolve-search-intent` edge function only updates `role_brief_search_intent` (jsonb). It does NOT back-fill `excluded_companies` / `exclusion_keywords` flat columns. `source-candidates-discovery` reads the flat columns, so conversational "exclude Cognizant" is silently ignored.

**Fix ALL call sites:**
- `resolve-search-intent/index.ts` `persistIntent`: also PATCH `excluded_companies` and `exclusion_keywords` derived from current conditions
- `resolve-search-intent/resolveSearchIntentPrompt.ts`: add explicit exclude-language examples to system prompt
- `parsedBriefToConditions`: already maps `excluded_companies`/`exclusion_keywords` if present — ensure conversational path also writes company/title exclude chips
- `refine_search_intent` / `resolve-search-intent` handler: honor "exclude Cognizant", "no MAANG" etc. → persist `company/exclude` conditions → flat backfill
- Add corpus fixtures asserting exclude chips survive BOTH JD-paste and conversational refine paths

### Bug 2: Multi-location collapses into one broken value

**Live evidence:** "San Francisco, Austin, or fully remote within the United States" → single chip `Remote, United States` (SF/Austin dropped; remote concatenated garbage).

**Root cause:** `parsedBriefToConditions` only splits on ` / ` (slash), not on `,` or ` or `.

**Fix:**
- Handle comma/or-separated cities in `parsedBriefToConditions`
- Treat **remote as its own non-geographic flag** (`other/require` with value `remote`) — not a location token, not a city string
- Corpus fixture for the exact failing phrase
- Compiled filters must not zero-out from multi-location input

### Bug 3: App-layer Exclude post-filter (NEW, mandatory)

After ANY candidate set returns (any tier, any route), hard-filter again in backend against role Exclude list (companies + title keywords) before render. Defense in depth — do not rely on Crustdata query alone.

- Apply in `source-candidates-discovery` / `search-crustdata-filters` / continue sourcing paths as appropriate
- Shared helper preferred: `supabase/functions/_shared/excludePostFilter.ts`
- Unit tests required

---

## §3. P1 — candidate pooling ("never show same person twice")

- Pull once per role into backend-owned pool; rank; serve strict first; close fits from same pool on refinement without new vendor call every turn.
- Default initial pull **30–50** (not 100). Config constant: `INITIAL_POOL_SIZE = 40`.
- **Sequential relaxation ladder** for pool-building: one search → if below floor, relax one allowlisted field → pull again. Never relax true-hard `required_skills` subset or Exclude. Floor: config constant `POOL_FLOOR = 30`.
- Dedup via `candidate_identity_matches` before ranking.
- "Show more like this" must return unmatched-so-far from pool — add test.
- New paid search only when pool can't answer (new hard Require not in original query); soft tweaks = re-rank at $0.
- UX language: always say **"ran a new search"** even for re-rank of cache (product decision).

**Implementation note:** Prefer extending existing `role_discovery_cache` / deal discovery scroll cache rather than building a new pool table (Ponytail). If schema needed → declarative schemas + PD-ASK at end.

---

## §4. P1 — credit governance

- Config: default pull 30–50; hard per-role spend ceiling **$1.50** default (constant: `CREDIT_CEILING_USD = 1.50`).
- Stop auto-relax and ask recruiter when ceiling crossed.
- **Open billing question (document, don't block):** Crustdata rate verification still open ($0.10 vs $0.30; per-returned vs enriched; 0.03 credits/record). Engineering uses configurable constants based on $0.30 / 0.03 assumption until vendor confirms.
- Do NOT implement parallel 3-tier pulls.

---

## §5. P2 UX (intentDelta ships WITH P0)

- Wire `intentDelta` into conversational UI: every refine turn shows "+3 excludes: TCS, …" style deltas
- Recap shows category counts including zero: "Require 7 · Prefer 7 · Exclude 0"
- Multi-location as separate removable chips once §2.2 ships
- Zero-result help: location-specific cause
- "8–∞ years" → "8+ years"
- Unify JD-paste with conversational engine (§1)
- Build Search copy by state (§1)

---

## §6. Build order (mandatory)

1. **P0 (§2) + intentDelta/counts recap (§5 bullets that catch excludes)** ← this wave
2. Pooling + sequential ladder (§3)
3. Credit governance config (§4) alongside 2
4. Remaining UX (§5)
5. Route unification JD-paste → conversational primary (§1)

---

## §7. Open (document, don't block)

- Vendor billing confirm (Crustdata rate)
- Finalize ceiling/floor constants after vendor confirms
- Seniority list completeness audit
- Location data source for city-tier classification

---

## §8. Already on branch (reuse)

Taxonomies, `crustdataIntentValidator` location/seniority fixes, jd-corpus 12 fixtures, single compiler, `MAX_REQUIRE=3`, `rankCandidates`, `search-crustdata-filters` thin-result relax, unified Parse/Send on `JdIntakePage`, `docs/search-intake-reliability-redesign.md`.

---

## §9. Deploy list for Harsha

After P0 wave merges to `cursor/premium-ux-leak-fixes-617f`:

1. **Deploy edge functions** (no migration needed for Bug 1–3 fixes):
   - `supabase/functions/resolve-search-intent/` (exclude backfill + prompt)
   - `supabase/functions/source-candidates-discovery/` (post-filter applied)
   - `supabase/functions/search-crustdata-filters/` (post-filter applied)
   - Deploy command: `npx supabase functions deploy resolve-search-intent source-candidates-discovery search-crustdata-filters`

2. **Deploy frontend** (Vite build → hosting):
   - `src/components/atomic-crm/jd-intake/parsedBriefToConditions.ts` (multi-location fix)
   - `src/components/atomic-crm/home/HomePage.tsx` (intentDelta display, 8+ years)
   - Build + deploy as normal

3. **No database migration** for P0 fixes — all changes are application-layer.

4. **Verify (Windows try steps):**
   - Open an existing role, type "exclude Cognizant" in the refine box → submit
   - Open Supabase Dashboard → deals table → confirm `excluded_companies` column updated
   - Run sourcing → confirm Cognizant candidates not returned
   - Create role with location "San Francisco, Austin, or fully remote within the United States" → confirm 3 chips

---

*If pooling (§3) or credit governance (§4) require a database schema change, a PD-ASK confirmation will be triggered before migration is applied.*
