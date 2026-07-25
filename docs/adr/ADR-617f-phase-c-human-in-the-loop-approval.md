# ADR: Phase C human-in-the-loop approval model

**Status:** Ready to build against. Planning artifact for the Conversational
Shell Roadmap, Phase C. Defines the interaction contract Cursor should
implement. Not yet implemented. The action catalog below is verified against
each relevant edge function/handler directly (see "Action catalog") — the
one required source change it surfaces (`send-offer` / `create-booking-link`
need a prepare/send split) is called out in Consequences.

## Context

Phase C gives the agent real tools to act on, not just a fixed intent menu.
Harsha's instruction, verbatim intent preserved: the agent shows what it
understood and what it plans to do; the recruiter can refine, reframe, or
change that plan; the recruiter then approves the action or stops it
entirely; **no action leaves the platform without a human decision**; every
one of these decisions is logged.

Two follow-up questions were resolved directly with Harsha:

1. Do low-stakes, fully-internal, easily-undone actions (widen a filter,
   re-rank candidates, save a note) also need a blocking approval, or can the
   agent act immediately as long as it stays visible and undoable?
   **Answer: act immediately, stay undoable.** The blocking gate is reserved
   for actions that leave the platform.
2. Does spending vendor API credits (CoreSignal/Crustdata calls cost real
   money but touch no candidate or client) need per-action approval, or is
   cost handled separately?
   **Answer: budget cap/warning, not a per-action approval gate.** Consistent
   with the existing credit-burn caching already shipped
   (`criteria_impact` cap+cache, no auto-fetch from Inbox/Canvas).

## Decision

### 1. Every proposed action is shown before or as it happens

Regardless of tier, the agent always states, in the conversation thread:
what it understood the recruiter to mean, and what it's about to do (or did).
This is not optional for any tier — it's the baseline transparency
requirement the approval model sits on top of.

### 2. Three tiers, one blocking gate

| Tier | Definition | Behavior |
|---|---|---|
| **Read** | No side effects — looking things up, summarizing, showing status | Runs automatically. Nothing to approve or undo. |
| **Reversible / internal** | Changes platform state but never reaches a candidate or client, and is cheap to undo (filter changes, re-ranking, notes, saving a sourced candidate to pipeline, applying calibration feedback, running a discovery search within budget) | Runs automatically. Shown as a turn with a one-click undo/correct affordance. Recruiter can reframe after the fact — the agent doesn't wait for a yes first. |
| **Leaves the platform** | Anything a candidate, client, or third party would see or receive once it happens — an outreach message, an email, a calendar invite, anything irreversible from the recruiter's side once sent | **Hard gate.** Agent shows the exact content/action, recruiter can edit or reframe it, then must give an explicit approve — or stop it — before anything sends. No exceptions, no auto-execute. |

### 3. Credit spend is a separate axis, not a fourth tier

Vendor API cost (CoreSignal/Crustdata) is governed by a budget cap per
role/tenant, not a per-search approval. A search that would exceed the cap
is the one case that escalates a Reversible/internal action into a blocking
stop — not because it leaves the platform, but because it becomes a real
resource decision at that point.

### 4. Every decision is logged in `role_conversation_turns`

Phase B's table already has `metadata jsonb` and `idempotency_key` —
built for exactly this. No new table needed. Each proposal, refinement,
approval, undo, or stop is a turn:

- `speaker='agent'`, `metadata.kind='proposal'` — what the agent understood
  and planned, before acting (Tier 2) or before sending (Tier 3).
- `speaker='recruiter'`, `metadata.kind='refinement'` — the recruiter's
  edit/reframe of a pending Tier 3 proposal.
- `speaker='recruiter'`, `metadata.kind='decision'`, `metadata.outcome='approved'|'stopped'` —
  the explicit yes/no on a Tier 3 action.
- `speaker='agent'`, `metadata.kind='result'` — what actually happened,
  referencing the proposal turn via `in_reply_to`.

This gives a replayable trail — "agent proposed X, recruiter changed it to
Y, recruiter approved, agent sent Y" — without touching `events` (which
stays mutation-audit only, per ADR-role-conversation-storage).

## Action catalog — verified against source, 2026-07-25

Every action below was checked directly against its edge function or
frontend handler (not assumed) before being assigned a tier:

- `show_roles`, `show_candidates`, reply capture (reading an inbound reply) — **Read**
- `create_role` (JD intake parse + save) — **Reversible/internal**
- `continue_sourcing` / discovery search (CoreSignal/Crustdata) — **Reversible/internal**, subject to the budget cap escalation above
- `relax_criterion` (widen a filter) — **Reversible/internal**
- Save/add a sourced candidate to pipeline (`save-sourced-candidate`) — **Reversible/internal**
- Apply calibration feedback (learned criteria) — **Reversible/internal**
- `send-first-outreach` (first message to a candidate, via Resend) — **Leaves the platform**. Verified: sends a real templated email directly to the candidate's address.
- `send-offer` — **Leaves the platform**. Now gated behind `prepare-offer` (draft) → `send-offer` (Resend only after approved subject/html) as of PR #6.
- `create-booking-link` / booking flow — **Leaves the platform**. Now gated behind `prepare-booking-link` (draft) → `send-booking-link` (Resend only after approval) as of PR #6; the old one-shot `create-booking-link` returns 410.
- `send-interview-reminders` — **out of scope for Phase C's tier catalog**. Verified: this is a scheduled cron sweep (service-role only, "not called by the frontend"), not an agent-invoked tool. It already sends candidate-facing reminder emails today, automatically, with no per-instance human approval — that's pre-existing system behavior Phase C doesn't touch, not a new agent action to gate.
- Candidate rejection — **no such action exists in the codebase today.** The Inbox "x" shortcut (`dismissDecision`) only dismisses a UI alert in local React state (`setDismissedIds`) — no server call, no candidate impact, not even a database write. There is currently no pipeline-stage "reject candidate" feature for Phase C to wire up. If/when one is built, it needs its own tier decision at that time — likely Leaves the platform if it's expected to trigger any candidate-facing rejection notice.

## Consequences

- No new storage — Phase B's `role_conversation_turns` carries the full
  approval trail via `metadata`.
- UI needs one new piece Phase A/B didn't require: a blocking "pending
  approval" card in the transcript for Tier 3 turns, with edit-then-approve,
  not just approve/reject.
- `send-offer` and `create-booking-link`'s prepare/send split shipped in
  PR #6 — Phase C's orchestrator should call `prepare-*` to generate the
  proposal turn's content, and only call `send-*` after the recruiter's
  explicit approval turn is recorded.
- The action catalog above is now verified against source, not assumed —
  see "Action catalog" for what was checked and what's still genuinely
  unbuilt (candidate rejection).
- This ADR intentionally does not resolve model/tool-calling mechanics
  (which LLM, how tools are declared, retry/timeout behavior) — that's
  implementation, not the approval contract.
