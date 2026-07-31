# Role Workspace Redesign — 2026-07-31

**Scope:** Presentational / layout only. Fonts and colors are OUT OF SCOPE — use existing design tokens only, no new hex values or typefaces.

**Files in scope:**
- `src/components/atomic-crm/roles/RoleWorkspacePage.tsx`
- `src/components/atomic-crm/roles/SearchIntentDisplay.tsx`
- `src/components/atomic-crm/roles/CandidateCard.tsx` — minor use only
- `src/components/atomic-crm/layout/AppShell.tsx` — icon rail with labeled nav
- `src/components/atomic-crm/shell/AgentHShell.tsx` — context strip + command bar

**No data plumbing:** Do NOT touch resolve-search-intent, parse-job-description, or Stage 2→3 mapping. SearchIntentDisplay already reads `conditions` + `unenforceable_constraints` — this is a presentational rewrite only.

---

## Finding 1 — Empty "Active Criteria" block

**Problem:** `RoleWorkspacePage` renders an "Active Criteria" heading section that is empty or redundant when SearchIntentDisplay is already visible.

**Fix:** Delete the empty/redundant "Active Criteria" block from `RoleWorkspacePage` if present.

---

## Finding 2 — Duplicate "Must-haves" list

**Problem:** A separate "Must-haves" list duplicates what is already shown as "Require" skills in SearchIntentDisplay.

**Fix:** Delete the standalone "Must-haves" list. Require skills already live in SearchIntentDisplay.

---

## Finding 3 — Criteria panel layout (tabs → always-visible flat blocks)

**Problem:** Criteria are either hidden behind tabs or laid out in a way that requires interaction to compare Require / Prefer / Exclude at a glance.

**Fix — rewrite SearchIntentDisplay:**
- One flat always-visible block per disposition: **Require**, **Prefer**, **Exclude** (no tabs, no accordion)
- Fold `unenforceable_constraints` into the Prefer list with a small inline "approx." badge — the Prefer section must never appear empty when unenforceables exist
- Keep "After last feedback" delta as-is
- Pipeline count: show once as a large number at the top of the memory/criteria panel — NOT also in header subtitle or tab badge; remove duplication

---

## Finding 5 (highest value) — Candidates buried inside chat transcript

**Problem:** Candidate cards are rendered as primary content inside the conversation transcript, duplicating what already exists in the Review tab and making calibration awkward.

**Fix:**
- **Review tab** = persistent candidate list using `CandidateCard density="queue"`
- **Conversation/transcript** = dialogue only — stop rendering candidate cards as primary content in the transcript, or hide `candidate_card` turns from the transcript when the Review list already shows them (no double-render)
- Wire **Review / Pipeline / Search** tabs to real content; the calibration batch must drive the Review list, not chat
- **Calibration Yes/Not-a-fit** actions operate on the visible Review list items

---

## Finding 6 — Dual header lockups

**Problem:** The role workspace header shows two competing brand lockups (Agent H + TalentCursor) at equal visual weight.

**Fix:**
- One brand at product weight (Agent H)
- TalentCursor kept as secondary/small text only — not a second full header lockup

---

## Finding 7 — Too many primary buttons in header

**Problem:** Multiple filled primary buttons compete for attention in the header.

**Fix:**
- One filled primary button (likely **Add candidates** while sourcing)
- Pause, Copy link, settings → `⋯` overflow menu
- Archive at bottom of overflow, separated by a divider, styled destructive

---

## Finding 8 — Sidebar icon-only navigation

**Problem:** AppShell icon rail shows icons only; destinations require hover tooltips to identify.

**Fix:**
- Add visible text labels under or beside each icon (not tooltip-only)
- Collapse to ~3–4 destinations: **Home**, **Roles**, **Reports**, **Settings**
- Theme toggle → Settings page or footer — not equal primary nav weight
- Active route: accent background tint using existing token

---

## Finding 9 — Command bar copy (DEFERRED)

Typography, final chip colors, and command bar copy improvements are deferred to a future iteration.

---

## Avatar / photoUrl

No `CandidateCard` Avatar rewrite needed. Confirm `photoUrl` remains wired from enrichment if already present — no change required unless it is broken.

---

## Tests

Prefer smoke tests / typecheck. Light unit tests are acceptable if SearchIntentDisplay render helpers are extractable.

---

## Verify checklist for Harsha (what to check on `/roles/N`)

1. **Sidebar** — Labels visible beside/below icons without hover; 3–4 destinations; active route has accent tint; theme toggle not in primary nav.
2. **Header** — Single Agent H brand; one filled primary CTA; Pause + Copy link + settings in `⋯` menu; Archive at bottom with destructive styling; subtitle = state text only ("Actively searching" / "Paused" / "Ready to search").
3. **Criteria panel** — Three flat visible blocks (Require / Prefer / Exclude); no tabs; unenforceables appear in Prefer with "approx." badge; pipeline count appears once (top of panel), not in header subtitle or tab badges.
4. **Duplicate lists gone** — No standalone "Must-haves" list; no empty "Active Criteria" heading.
5. **Review tab** — Shows candidate cards (density="queue") from calibration batch; no duplicate cards in transcript; calibration Yes/Not-a-fit acts on Review list items.
6. **No data regressions** — Search intent criteria, pipeline stages, and calibration state unchanged.
