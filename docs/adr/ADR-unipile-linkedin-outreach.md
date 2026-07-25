# ADR: Unipile LinkedIn Outreach

**Status:** Accepted  
**Date:** 2026-07-25  
**Scope:** Replace email-first candidate outreach and dormant discovery vendors with Unipile-powered LinkedIn sequences, grounded in [Unipile's documented API](https://developer.unipile.com/) (hosted auth, profile fetch, connection requests, InMail, checkpoints).

## Context

Agent H currently spreads candidate discovery and contact across several vendors:

| Vendor | Role today | Phase 1 action |
|--------|------------|----------------|
| **Crustdata** | Person search (`/person/search`) | **Sole active discovery vendor** |
| **Coresignal** | Discovery, criteria-impact repricing, Collect API | **Disabled** (code kept) |
| **Apollo** | Dormant discovery; contact-enrichment fallback | **Disabled** (code kept) |
| **Hunter** | Contact-enrichment first step | **Disabled** (code kept; only lives in `enrich-candidate-contact`) |
| **PDL** | Dormant discovery; full-profile fallback | Unchanged (dormant) |
| **Resend** | Email (resume request, offer, booking, first outreach) | Kept for non-LinkedIn flows until Phase 4 |

Two edge-function folders (`enrich-candidate-contact`, `enrich-candidate-devsignals`) were OneDrive junctions on Windows and broke Supabase bundler/deploy — same class of bug as `save-sourced-candidate` (fixed 2026-07-24). **Fixing those junctions is a prerequisite** before assuming Hunter code is missing.

Unipile replaces LinkedIn-session-based outreach (connection note ≤300 chars, open-profile InMail when `is_open_profile` is true per Unipile profile endpoint, scheduled follow-ups, daily send cap).

## Decision

Implement in **four ordered phases**. Do not start a later phase until the prior one is shippable.

### Phase 0 — Edge-function directory hygiene (prerequisite)

Replace OneDrive junctions with real directories for:

- `supabase/functions/enrich-candidate-contact/`
- `supabase/functions/enrich-candidate-devsignals/`

(Same pattern as `save-sourced-candidate` in commit `48d2901`.)

### Phase 1 — Vendor consolidation (this PR)

**Goal:** Crustdata is the sole **active** discovery vendor; stop spending Apollo/Coresignal/Hunter credits while keeping all vendor code for one-line re-enable.

Changes:

1. **`DISCOVERY_PROVIDERS`** in `source-candidates-discovery/index.ts` → `[crustdataProvider]` only.
2. **Calibration blast-radius + criteria-impact repricing** → use `getPrimaryDiscoveryProvider()` (Crustdata), not hardwired `coresignalProvider.search`.
3. **`enrich-candidate-contact`** → `CONTACT_ENRICHMENT_VENDORS_ENABLED = false`; return disclosed `not_found` with note (Hunter/Apollo code untouched).
4. **`enrich-candidate-workhistory`** → `CORESIGNAL_COLLECT_ENABLED = false`; PDL fallback may still run (PDL was already dormant for discovery).

**Not in Phase 1:** Unipile wiring, candidate-card styling, outreach sequences.

### Phase 2 — Candidate-card styling cleanup ✅

`SourceCandidatesPage` status badges and callout panels now use semantic `ah-status-*` / `ah-callout-*` classes from `agent-h-theme.css` instead of hardcoded Tailwind color scales.

### Phase 3 — Unipile account connection ✅ (initial)

- Hosted auth link generation (`create-unipile-hosted-auth-link`)
- Notify webhook (`unipile-hosted-auth-notify`) stores `unipile_account_id` on `sales`
- Status sync + seat-type detection (`get-unipile-linkedin-account`)
- Checkpoint solve UI (`solve-unipile-checkpoint`) on Profile page

Secrets: `UNIPILE_API_KEY`, `UNIPILE_DSN`, `UNIPILE_WEBHOOK_SECRET`, `CRM_BASE_URL`.

Deploy: `create-unipile-hosted-auth-link`, `unipile-hosted-auth-notify`, `get-unipile-linkedin-account`, `solve-unipile-checkpoint`. Apply migration `20260725143000_agent_h_unipile_linkedin.sql`.

### Phase 4 — LinkedIn outreach sequence

Replace Resend `send-first-outreach` for LinkedIn-sourced candidates with Unipile:

1. **Connection request** with note — enforce **300-character limit** (LinkedIn + Unipile constraint).
2. **Open-profile routing** — when Unipile profile returns `is_open_profile: true`, auto-route to free InMail instead of connection request (field confirmed on Unipile profile endpoint).
3. **Scheduled follow-ups** — queue next step after N days if no accept/reply.
4. **Daily send cap** — configurable per seat; LinkedIn restricts accounts pushed too hard.

Tier-3 human-in-the-loop approval (Phase C ADR) applies: recruiter sees and edits the connection note / InMail body before send.

## Consequences

- Discovery searches require `CRUSTDATA_API_KEY`; missing key fails fast with updated error copy.
- "Enrich contact" returns a clear disabled message until Phase 4 / alternate path.
- "View full profile" skips Coresignal Collect; may still use PDL if configured.
- CI deploy workflow should eventually get Supabase secrets so function deploys don't silently skip — not blocking manual deploy.

## References

- Unipile API docs: https://developer.unipile.com/
- Phase C approval: `docs/adr/ADR-617f-phase-c-human-in-the-loop-approval.md`
- Prior discovery consolidation notes: `source-candidates-discovery/index.ts` header, `DISCOVERY_PROVIDERS`
