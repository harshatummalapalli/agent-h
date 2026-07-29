# Handoff to Cursor — CoreSignal / Enrichment / Unipile evaluation

**From:** Claude (Cowork), 2026-07-28  
**Picked up by:** Cursor cloud agent (`bc-81f21a19-73fa-43a8-838e-ae2ae3e8617f`), 2026-07-28

## Standing brief (order)

1. **CoreSignal evaluation** — DONE in Cowork sandbox (deployed as `calibration-session` v27). Source files were **not** present in this git workspace when Cursor picked up — see "Task 1 git gap" below.
2. **Enrichment APIs** — Crustdata People Enrich vs PDL. IN PROGRESS on this branch.
3. **Unipile beyond messaging** — NOT STARTED.

Standing instruction: confirm real API shape/docs before writing query code; conserve vendor credits.

## Task 1 — CoreSignal: DONE (deployed), missing from git

**Recommendation (from Cowork report):** keep Crustdata primary. Do not enable CoreSignal for live recruiter search yet — zero candidates for the Hyderabad brief after progressive broadening; only non-Indian hits when location dropped.

**Deployed (independent of git):** `calibration-session` v27 on Supabase project `fbkdypullttetardrgdu` with `discovery_vendor: "crustdata" | "coresignal"`.

### Task 1 git gap (confirmed 2026-07-28)

When this Cursor workspace checked out `main`, these paths were **absent**:

- `supabase/functions/_shared/coresignalClient.ts`
- CoreSignal / `discovery_vendor` edits in `calibration-session/index.ts`
- Frontend `?vendor=coresignal` + Vendor diagnostics panel
- `docs/CORESIGNAL_VS_CRUSTDATA_COMPARISON.md`

Cowork could not `git commit` (sandbox shell wedged). Supabase deploy went through MCP with inline file content. **Recover CoreSignal source from the Cowork machine that deployed v27, or re-pull from that session's local tree, before treating Task 1 as synced to git.**

Live re-test (when source is restored): `/#/roles/14?vendor=coresignal` → "Show more from search" → Vendor diagnostics panel.

## Task 2 — Enrichment: research status

See `docs/ENRICHMENT_RESEARCH_NOTES.md` (docs-confirmed schemas) and
`supabase/functions/_shared/crustdataEnrichClient.ts` +
`supabase/functions/compare-enrichment-vendors/` (comparison harness).

**Blocker for live credit-using calls in this Cursor environment:** no
`CRUSTDATA_API_KEY` / `PDL_API_KEY` in the pod. Keys live as Supabase Edge
Function secrets. Deploy `compare-enrichment-vendors` and invoke it with a
recruiter JWT to run permission probe + Deal 14 comparison.

## Task 3 — Unipile beyond messaging

Not started. Read `docs/adr/ADR-unipile-linkedin-outreach.md` first (messaging-only Phase 4 shipped).
