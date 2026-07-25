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

### Phase 4 — LinkedIn outreach sequence ✅ (shipped 2026-07-25)

Replace Resend `send-first-outreach` for LinkedIn-sourced candidates with Unipile.

#### What shipped

**Schema** (`supabase/schemas/34_agent_h_linkedin_outreach.sql`, migration `20260725160000_agent_h_linkedin_outreach_phase4.sql`):
- `deal_candidates`: `outreach_channel` (email|linkedin_connection|linkedin_inmail), `outreach_message_body`, `outreach_approved_at`, `outreach_sent_at`, `linkedin_provider_id`
- `sales`: `linkedin_daily_send_cap` (default 80), `linkedin_sends_today`, `linkedin_sends_reset_date`
- New table `linkedin_outreach_follow_ups` (deal_candidate_id, scheduled_for, follow_up_type, status) — schema and insert logic shipped; cron/scheduled dispatch **deferred** (see below)

**Backend edge functions**:
- `prepare-first-outreach` (new): detects channel via Unipile profile fetch (`is_open_profile` → inmail vs connection), checks daily cap, drafts message with Claude (≤300 chars for connection request, fallback template if no API key), returns preview for recruiter approval. Falls back to email path when no `linkedin_url` or Unipile unconfigured.
- `send-first-outreach` (refactored): accepts `channel`, `message_body`, `linkedin_provider_id`. LinkedIn connection → `POST /api/v1/users/invite`; InMail → `POST /api/v1/chats` (multipart, `linkedin[inmail]=true`). Enforces daily cap, increments counter, queues follow-up stub, updates `deal_candidates` outreach columns. Email path unchanged for backward compatibility.

**Shared helpers** (`_shared/unipileClient.ts` + `_shared/unipileClientHelpers.ts`):
- `extractLinkedInSlug(url)` — extracts public identifier from linkedin_url
- `checkDailyCap(sale)` — pure cap check (safe for unit tests)
- `fetchUnipileUserProfile(accountId, identifier)` — `GET /api/v1/users/{identifier}?account_id=…`
- `sendUnipileConnectionInvite(accountId, providerId, message)` — `POST /api/v1/users/invite`
- `sendUnipileInMail(accountId, providerId, message)` — `POST /api/v1/chats` (multipart)

**Frontend**:
- `ConversationTurnMetadata.linkedin_preview` field: `{channel, message_body, char_count, is_open_profile, linkedin_provider_id, cap_remaining, drafted_by}`
- `getLatestLinkedInPreview()` mirrors `getLatestEmailPreview()` for refinement turn chain
- `buildTier3ProposalMetadata`: new `send_first_outreach` case calls `prepareFirstOutreach` and populates `linkedin_preview` (or `email_preview` for email channel)
- `approveTier3Proposal`: routes `send_first_outreach` through LinkedIn or email send based on available preview
- `refineTier3Proposal` + `PendingApprovalCard`: LinkedIn message body is editable (char count shown, over-limit blocks Approve); refined previews stored as refinement turns
- `dataProvider.prepareFirstOutreach`, `dataProvider.sendFirstOutreach` updated with new opts
- `parseAgentCommand` return type extended to include `send_first_outreach`, `send_offer`, `send_booking_link` (was missing, causing silent routing failure)

#### Deferred (not in this wave)

- **Follow-up cron/scheduler**: `linkedin_outreach_follow_ups` rows are inserted on send, but no cron edge function dispatches them. A future wave adds the scheduler. Document approach in a follow-up ADR addendum when built.
- **Multi-step drip sequences** beyond first message + one follow-up stub.
- **Re-enabling Hunter/Apollo/Coresignal** for contact enrichment.
- **CI Supabase secrets** for automatic function deploy.
- **Canvas direct-send button** LinkedIn routing: the per-row "Send outreach" button in `CanvasPage` still goes email-only for backward compat. LinkedIn outreach uses the Phase C chat → propose → approve flow in `RoleWorkspacePage`.

#### Deploy checklist

1. Apply migration: `npx supabase migration up --local` (or `npx supabase db push` for remote)
2. Deploy new/updated functions: `prepare-first-outreach`, `send-first-outreach`
3. No new secrets required beyond Phase 3 (`UNIPILE_API_KEY`, `UNIPILE_DSN`, `ANTHROPIC_API_KEY`)

## Consequences

- Discovery searches require `CRUSTDATA_API_KEY`; missing key fails fast with updated error copy.
- "Enrich contact" returns a clear disabled message until Phase 4 / alternate path.
- "View full profile" skips Coresignal Collect; may still use PDL if configured.
- CI deploy workflow should eventually get Supabase secrets so function deploys don't silently skip — not blocking manual deploy.

## References

- Unipile API docs: https://developer.unipile.com/
- Phase C approval: `docs/adr/ADR-617f-phase-c-human-in-the-loop-approval.md`
- Prior discovery consolidation notes: `source-candidates-discovery/index.ts` header, `DISCOVERY_PROVIDERS`
