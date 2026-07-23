# Agent H — Platform Rebuild Proposal

**Date:** 2026-07-22
**Status:** Proposal for sign-off. Supersedes/consolidates the two earlier
docs from today (agentic-canvas UX proposal, hiring-scorer schema-adoption
proposal) into one build plan. Nothing has been built yet.

## The call being made here

Stop extending Atomic CRM. Design a fresh schema and a fresh UI for a
recruiting platform built for a client's hiring team (not an individual),
informed by everything proven this session (Coresignal/Exa sourcing,
relevance filtering, the sourcing sidebar's conversational UX) and by
hiring-scorer's schema (evidence-linked resume intelligence, multi-model
scoring, decision logging) — but not literally copy-pasted from either.
Nothing existing is sacred; the goal is a platform that doesn't feel like
software from 2015 wearing a dark theme.

## 1. Tenancy: team-shared data, individually-attributed actions

- Every core table (`jobs`, `candidates`, `pipeline_entries`, `notes`,
  `outreach_messages`, `decisions`) carries a `workspace_id` — the whole
  hiring team sees the same roles and candidates. This is the opposite
  of hiring-scorer's `created_by = auth.uid()` private-row model.
- Every table that records an action (not just data) *also* carries an
  `actor_id` (who approved, who decided, who sent the outreach) —
  separate from `workspace_id`. Team visibility, individual
  accountability. This is exactly hiring-scorer's `recruiter_decisions`
  pattern (`candidate_signal_snapshot` + `job_signal_snapshot` at
  decision time) generalized across every consequential action, not
  just candidate accept/reject.
- RLS: `using (workspace_id = current_workspace_id())` for read/write
  access, with `actor_id` as a plain audit column, not an access
  boundary — a teammate can see who approved something, but the
  approval itself isn't gated by who's asking.

## 2. Schema (fresh, not an ALTER TABLE on `deals`)

Grouped by purpose — this is the shape, not final DDL:

**Identity & workspace**
`workspaces`, `workspace_members` (user_id, workspace_id, role),
replacing `sales`/tenant plumbing with something recruiting-specific
(agency vs. in-house, per hiring-scorer's `workspace_profiles`).

**Jobs** (`role_briefs`-equivalent, renamed to drop deal/sales
vocabulary entirely): title, responsibilities, `required_skills`,
`deal_breakers` → rename to `disqualifiers`, `core_signals`,
`preferred_signals`, `cannot_assess`, `title_band`, `semantic_clusters`,
status, `apply_link`/`application_token` for the public application
surface (see §3).

**Candidates**: identity fields + `resume_documents` (file storage),
`resume_parse_runs` (parser used, confidence, duration, warnings),
`candidate_experience` / `candidate_skills` / `candidate_evidence` — the
per-claim confidence+evidence-string model from hiring-scorer is worth
keeping close to verbatim, it's the actual substrate the "no bland
percentage" scoring in §4 depends on. `candidate_corrections` for when a
recruiter fixes a bad parse (also trains future parsing).

**Pipeline**: `pipeline_entries` (job_id, candidate_id, stage,
`shortlist_reason`), stage vocabulary rebuilt around hiring language
(Sourced → Reviewing → Outreach Sent → Responded → Screening →
Interviewing → Offer → Hired/Passed), not sales stages.

**Scoring & evidence** (§4 has the design): `candidate_assessments`
(job_id, candidate_id, verdict_tier, narrative fields, evidence
citations) replaces both `saved_scores` and the numeric `overall_score`
column — no numeric score column in the schema recruiters' UI reads
from at all. An internal `sort_key` can exist purely for ordering
results without being displayed.

**Decisions & actions** (individual attribution, per §1):
`decisions` (workspace_id, actor_id, candidate_id, job_id,
decision_type, reason, snapshot jsonb), `outreach_messages`
(actor_id = who sent it, status, thread), `notes` (actor_id).

**Ingestion** (§3): `sourcing_runs` (already exists, keep), 
`resume_uploads` (manual), `inbound_applications` (webhook/apply-link
intake, status: pending/parsed/failed).

**Analytics**: `activity_events`, generic and indexed by workspace+time,
feeding the recruiter dashboard from the earlier proposal — team-wide
this time, not per-user only, since tenancy is team-shared.

## 3. Three ways candidates enter the platform

1. **Platform sourcing** — what's already built and proven this session:
   Coresignal + Exa + free-portal fan-out, relevance-filtered, feeding
   the sourcing sidebar/canvas. Reused as-is, pointed at the new schema.
2. **Manual upload** — a recruiter drags in resumes (single or batch).
   Goes through the same `resume_parse_runs` pipeline as sourced
   candidates, so a manually-uploaded resume gets the identical
   evidence-linked extraction and assessment as a sourced one — no
   second-class data path.
3. **ATS job hook** — each job gets a stable inbound surface: an
   `apply_link` (candidates apply directly, hiring-scorer's pattern) and
   a webhook endpoint the recruiter can point an external careers page
   or their existing ATS at, so applications land in `inbound_applications`
   and flow into the same parse → evidence → assessment pipeline
   automatically. This is the piece that makes the platform useful even
   for roles the team isn't actively sourcing for.

All three converge on the same `candidates` + resume-intelligence
tables — sourcing, upload, and webhook are just different front doors
into one ingestion pipeline, not three different candidate data models.

## 4. Evidence-based scoring — no percentages

The concrete replacement for "72% match": every `candidate_assessments`
row has —

- **Verdict tier** (small, fixed vocabulary — e.g. *Strong Match /
  Worth a Look / Notable Gaps / Not Aligned* — a word a recruiter reads
  in half a second, not a number they have to interpret).
- **Journey narrative** — 2-3 sentences of plain-language context: what
  this person has actually done, in relation to this specific role, not
  a generic bio.
- **Strengths** — bulleted, each one backed by a citation into
  `candidate_evidence` (the actual resume text the claim came from), not
  an assertion floating with no source.
- **Watch-outs** — same structure, for gaps or risks, framed
  factually ("no evidence of production Kubernetes experience") rather
  than as a penalty.
- **Cannot assess** — explicit, for anything the resume genuinely
  doesn't answer (hiring-scorer already models this — `cannot_assess` on
  the job side, worth mirroring on the assessment side too) — a good
  scoring system says "we don't know" instead of guessing and
  presenting it as confident.

Internally, an ordering key can still exist to sort a candidate list
best-first (the ranking agent stage from the canvas proposal needs
*some* way to order results) — the discipline is that the number never
reaches the UI. Recruiters see tiers and evidence; the ordering logic
is plumbing, not a displayed feature.

## 5. Stack decision

Keep this repo's Vite + React + Tailwind + shadcn + Supabase shell —
not a rewrite in Next.js to match hiring-scorer's stack. The reasons:
working Supabase auth (survived a real debugging session this week),
the dark-glass theme pass from earlier today already covers every
shared component, and the Coresignal/Exa sourcing edge functions are
already deployed and proven. "Blank canvas" applies to the **schema**
(fresh tables, not ALTERs on `deals`) and the **page components**
(fresh agentic-canvas UI, not `Resource`/`List`/`Datagrid`) — not to the
build tooling and auth that already work. Rewriting those too would be
churn without a corresponding product benefit.

## 6. Phased build order

1. **Schema** — the fresh tables in §2, applied to the existing Supabase
   project as new tables (old `deals`/`candidates`/`deal_candidates`
   left in place, not read from, until cutover is verified — safer than
   dropping first).
2. **Ingestion pipelines** — platform sourcing pointed at new schema
   (smallest lift, mostly repointing existing edge functions), manual
   upload, then the ATS webhook/apply-link (this one's net-new surface
   area, likely the longest of the three).
3. **Evidence-based assessment** — the scoring/narrative generation
   described in §4, writing to `candidate_assessments`.
4. **Agentic canvas UI** — the unified entry-point + streaming
   candidates + Jobs rail + All Candidates view from the earlier
   proposal, now reading from the new schema instead of `deals`.
5. **Decisions/outreach with attribution** — human-in-the-loop approval
   gates, each logged with `actor_id`.
6. **Analytics dashboard** — team-wide, from `activity_events`.
7. **Cut over and retire** the old `deals`/`candidates`/`deal_candidates`
   tables once the new path is fully verified end-to-end.

Each phase is a real milestone you can look at and react to — I'd rather
land the schema and one working ingestion path first and get your read
on it before building the other five phases on an unvalidated
foundation.

## What I need from you before starting

- Sign-off on the schema shape in §2 (or specific changes).
- Confirm the stack decision in §5 (keep this repo/Vite, fresh
  schema+pages) rather than a literal new codebase.
- Confirm phase order in §6, or reprioritize if the ATS webhook is more
  urgent than I've assumed.
