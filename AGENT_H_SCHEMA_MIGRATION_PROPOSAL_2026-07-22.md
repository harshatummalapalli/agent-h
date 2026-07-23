# Agent H — Schema Migration Proposal (adopting hiring-scorer's model)

**Date:** 2026-07-22
**Status:** Proposal for sign-off. No SQL has been run against the live
project (`fbkdypullttetardrgdu`) from this doc.

## What I looked at

Read the full `supabase/*.sql` set in
[harshatummalapalli/hiring-scorer](https://github.com/harshatummalapalli/hiring-scorer)
(schema.sql, job-architecture.sql, role_briefs_v2.sql, candidates.sql,
pipeline_candidates.sql, resume-intelligence.sql, scoring_runs.sql,
recruiter-decisions.sql, analytics-events.sql, admin-platform.sql,
rls-security.sql, workspace_profiles.sql, add-limits.sql, and the smaller
incremental migrations). It's a real, evolved schema — not a scaffold —
and it's a genuinely better foundation for Agent H than the
Atomic-CRM-derived `deals`/`deal_candidates` tables we've been extending.
You're right that the misalignment isn't imagined.

## Why hiring-scorer's model fits better

Atomic CRM's `deals` table models a sales pipeline (a deal moves through
stages like Screening → Client Review → Offer Extended, borrowed
vocabulary from selling to a client, not hiring for a role) and
`deal_candidates` is a generic join table with no recruiting semantics.
Every recruiting-specific concept we've added this session — relevance
filtering, candidate scoring, evidence-based ranking, human-in-the-loop
approval — has been bolted on top rather than expressed natively.

hiring-scorer's schema expresses those concepts directly:

| Concept | Atomic CRM (current) | hiring-scorer |
|---|---|---|
| A role/JD | `deals` row, sales-shaped | `role_briefs` — weighted scoring dimensions (skills/trajectory/domain/seniority/tenure), `deal_breakers`, `core_signals`, `preferred_signals`, `title_band`, `semantic_clusters` |
| A candidate | `candidates` row, resume text mostly opaque | `candidates` + `resume_documents` / `resume_parse_runs` / `candidate_experience` / `candidate_skills` / `candidate_evidence` — every extracted claim carries a `confidence` and `evidence` string back to source text |
| Candidate in a role's pipeline | `deal_candidates`, generic join | `pipeline_candidates` — `fit_score`, `fit_verdict`, `insights` (jsonb signals), `shortlist_reason`, `recruiter_notes` |
| Ranking | doesn't exist today | `scoring_runs` — multi-model consensus scoring (extractor/advocate/scorer roles), `saved_scores` — per-candidate dimension scores, `green_flags`/`watch_signals`/`review_flags`, confidence level |
| Human-in-the-loop learning | doesn't exist today | `recruiter_decisions` — every accept/reject/skip logged with a snapshot of the candidate's signals *and* the job's signals at decision time, i.e. exactly the data you'd train a preference model on later |
| Analytics | doesn't exist today | `analytics_events` + `activity_log` — generic event stream, indexed by user and time, ready for the recruiter dashboard from the last proposal |
| Multi-tenant / usage | `sales`/`current_tenant_id()` | `workspace_profiles` + `workspace_settings` (recruiter type, company info, plan limits: max jobs, max candidates) |

`scoring_runs` and `recruiter_decisions` in particular are the two
building blocks the agentic-canvas proposal was missing — "rank" and
"human-in-the-loop learning" were described as aspirational, unbuilt
agent stages. This schema already has the tables for both; only the
scoring/decision *logic* needs building, not the storage.

## One real gap to fix before adopting it: tenancy model

hiring-scorer's RLS (once you get past the early permissive `using
(true)` policies in `schema.sql`/`candidates.sql`/`pipeline_candidates.sql`
to the final `rls-security.sql` layer) scopes every row to
`created_by = auth.uid()` — **one recruiter's data is private to that
recruiter**, full stop. There's no team/workspace sharing: a colleague
can't see roles or candidates you sourced.

Agent H's current schema uses `current_tenant_id()` — a whole team
shares visibility into the same roles and candidates. That's almost
certainly what you actually want (a hiring team collaborating on the
same roles), and it's not what hiring-scorer ships out of the box.

**This needs a decision, not an assumption on my part**: do we want
single-owner-private data (copy hiring-scorer's model as-is) or
team-shared data (keep Agent H's tenant model, and add a `workspace_id`
/ `tenant_id` column + policy to every table below instead of
`created_by = auth.uid()`)? I'd recommend team-shared, matching what's
already built, but this is a real product call, not a technical default.

## Proposed migration shape (once scope is confirmed)

Not a drop-and-recreate — `deals`/`candidates`/`deal_candidates` already
hold real data and the sourcing pipeline (`continueSourcingForDeal`,
`isCandidateRelevantToDeal`, the Coresignal/Exa fan-out) already writes
to them. The move is an **additive rename-and-extend**, not a rebuild:

1. Rename `deals` → keep the table, add hiring-scorer's `role_briefs`
   columns onto it (`deal_breakers`, `core_signals`, `preferred_signals`,
   `cannot_assess`, `equivalent_titles`, `title_band`,
   `semantic_clusters`, the five `weight_*` scoring dimensions). Existing
   rows keep their data; nothing already built (deal stages, past
   titles/companies from this session's earlier migration) has to move.
2. Extend `candidates` with `structured_resume`, `parse_confidence`,
   `last_parse_at`, `pre_score`, `manual_rejection_*` columns; add the
   new resume-intelligence tables (`resume_documents`,
   `resume_parse_runs`, `candidate_experience`, `candidate_skills`,
   `candidate_evidence`, `candidate_corrections`) as new tables, FK'd to
   the existing `candidates.id`.
3. Extend `deal_candidates` (or formally rename it toward
   `pipeline_candidates` semantics) with `fit_score`, `fit_verdict`,
   `insights`, `shortlist_reason` — this is the real "ranking" surface
   the Rank agent stage would write to.
4. Add `scoring_runs`, `saved_scores`, `recruiter_decisions`,
   `analytics_events`, `activity_log` as net-new tables — nothing
   existing depends on them yet, zero migration risk.
5. RLS: whichever tenancy model gets confirmed, applied consistently —
   not hiring-scorer's `created_by = auth.uid()` verbatim unless
   single-owner-private is actually the intent.

Each step is independently applicable and I'd apply them as separate
migrations (matching how this session's earlier schema work went — one
migration, one review, one apply), not as one giant script.

## What I need from you before writing any SQL

1. **Tenancy**: team-shared (recommended) or single-owner-private
   (hiring-scorer's default)?
2. **Confirm the additive approach** — extend the existing `deals`/
   `candidates`/`deal_candidates` tables rather than dropping and
   rebuilding from hiring-scorer's schema fresh. (If you'd rather do a
   clean cutover and re-import/re-source rather than migrate live data,
   say so — that's a different, larger operation.)
3. **Sequencing against the agentic-canvas proposal**: this schema work
   and Phase 1 of the canvas rebuild (unified entry point) can happen in
   either order or in parallel — but the Rank/outreach-prep agent stages
   from that proposal (Phase 3) now have a real place to write scores
   and decisions once this schema lands, so doing this first likely
   unblocks Phase 3 sooner.
