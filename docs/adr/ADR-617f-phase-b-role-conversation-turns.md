# ADR-617f-phase-b — Role conversation turns storage

- **Date**: 2026-07-25
- **Ticket**: Phase B
- **Session**: 617f

## Context

Phase B adds a shared recruiter↔agent transcript in the role shell. `events` is append-only audit for mutations; stuffing conversational UI into it would mix audit semantics with chat ordering, threading, and idempotent retries.

## Decision

Store turns in `role_conversation_turns`: required `deal_id` (one shared thread per role), `speaker` (`recruiter` | `agent`), `content`, optional `in_reply_to` and `idempotency_key`, recruiter `actor_sales_id` on human turns only. Agent turns are server-written (`auth.uid()` null); recruiters insert human turns within tenant. No global/nullable thread and no visibility-scope column — tenant-wide read matches deals/assignments today.

## Consequences

- Enables Phase C orchestrator to append agent turns without overloading `events`.
- Idempotency key prevents duplicate turns on command retries.
- Append-only grants/RLS mirror `events`; updates/deletes reserved for service_role retention jobs.
- Card-action payloads can land in `metadata` jsonb without schema churn.

## Alternatives considered

- Reuse `events` with a new `action` — rejected: wrong lifecycle (immutable audit vs ordered chat).
- Per-recruiter threads (`sales_id` on thread key) — rejected: product wants one shared role thread across assignees.
