# Canvas route audit (Phase A → B)

**Date:** 2026-07-25  
**Status:** `/canvas/:dealId` remains registered; redirect deferred until bulk-table UX lives in `/roles/:id`.

## What Canvas still owns

`CanvasPage` is the per-role **bulk candidate table**: checkbox selection, j/k keyboard nav, reject/undo, outreach send, expandable score rows, criteria-impact drawer, activity panel, and its own CommandBar (not `AgentHShell`). `RoleWorkspacePage` embeds sourcing, pipeline (`DealCandidatesSection`), notes, and uploads — but **not** this table UX.

## Nav / route call sites (5)

| # | File | Usage | Redirect target when ready |
|---|------|-------|----------------------------|
| 1 | `inbox/InboxPage.tsx` | `openDecision` → `/canvas/${dealId}`; command `show_candidates` → same | `/roles/${dealId}` (pipeline or dedicated review panel) |
| 2 | `sourcing/useSourcingThread.ts` | `show_candidates` → `/canvas/${dealId}` | `/roles/${dealId}` |
| 3 | `layout/Header.tsx` | `matchPath("/canvas/*")` highlights Roles nav | `/roles/*` only (drop canvas match) |
| 4 | `root/CRM.tsx` | `<Route path={CanvasPage.path} />` (desktop + mobile) | Remove route after embed |
| 5 | `canvas/CanvasPage.tsx` | `CanvasPage.path = "/canvas/:dealId"` | Delete page |

## Additional references (non-nav)

- `parse-agent-command` prompt mentions Canvas as navigation target for `show_candidates`.
- `CommandBar.tsx`, `ShortcutsModal.tsx`, `agentActivityStore.ts` — shared with Canvas; migrate with table embed or retire Canvas-only activity UI.
- `RoleWorkspacePage` / `JdIntakePage` command handlers already prefer `/roles/:id` for `show_candidates`.

## Prerequisites before redirect + deletion

1. **Embed bulk table** in `RoleWorkspacePage` — tab, collapsible panel, or agent-opened surface; must preserve selection, keyboard grammar, reject/outreach, criteria drawer.
2. **Rewire call sites 1–2** to `/roles/:id` (optionally with hash/query e.g. `?panel=review`).
3. **Header** — remove `/canvas/*` match (site 3).
4. **Remove routes** in `CRM.tsx` (site 4) and delete `CanvasPage.tsx` (site 5).
5. **Regression pass** — inbox Enter on decisions, command bar “show candidates”, sourcing thread navigation.

## Recommended sequence

1. Phase B transcript + role shell (in progress).  
2. Extract Canvas table into `RoleCandidateReviewPanel` (or similar) consumed by RoleWorkspace.  
3. Flip nav call sites + add temporary redirect route `/canvas/:dealId` → `/roles/:dealId` for bookmarks.  
4. Delete Canvas page after one release with redirect.

## Locked product decision

Canonical role URL is `/roles/:id`. Canvas is deprecated **only after** bulk-table UX is embedded in roles — not before.
