# Agent H — Scope Addendum: Multi-Segment + "5 Years Ahead" Architecture

**Date:** 2026-07-22
**Status:** Proposal for sign-off. Extends
`AGENT_H_PLATFORM_REBUILD_PROPOSAL_2026-07-22.md` — read that first, this
adds two things on top of it rather than repeating it.

## 1. One product, two segments: direct customer and staffing company

**Correction from the first draft of this doc**: I over-modeled this.
Harsha's clarification — a staffing agency is a regular workspace/client
of the platform, the same as a direct customer. The agency does not get
a sub-model of *its own* clients inside the platform (no `clients`
table, no client-switching UI, no per-client branding, no candidate-
confidentiality-across-clients problem to solve). That entire layer is
gone. Sourcing and screening workflows are identical between segments,
"slight changes here and there."

The one real, confirmed difference is **outreach framing**:

- **Direct customer**: outreach can name the company plainly from the
  first message — "We're hiring for [Company] and think you'd be a
  great fit for..."
- **Staffing company**: the end-client generally isn't named in the
  first outreach — it's teased ("a Fortune 500 financial institution,"
  "a pre-seed startup that just raised...") rather than disclosed, with
  the actual name presumably shared later once a candidate engages. The
  platform doesn't need to model *who* the undisclosed client is — this
  is a copy/tone difference in the outreach-prep agent stage, not a data
  modeling problem.

**Mechanism: one `workspaces.org_type` field** (`direct` | `staffing`,
extensible if a third archetype shows up later — e.g. RPO), captured at
signup. This single flag drives config — right now, just the
outreach-prep stage's template/tone (named vs. teased) — via the
`agent_stage_config` table already scoped in §2 below, not a new entity
model. Everything else in the schema, the canvas, scoring, and pipeline
is identical regardless of `org_type`.

**Onboarding**: a short "what does your work look like" step at signup
(hiring for your own company vs. recruiting on behalf of clients) sets
`org_type` and whatever config rows follow from it, so the platform
adapts its copy/behavior without the user ever configuring anything by
hand — matches "based on the nature of work, the platform should show
them exactly what they want."

## 2. "5 years ahead" — architecture, not just theme

Design pass and evidence-based scoring already push the UI ahead of
typical ATS software. The architecture needs the same ambition:

- **Composable agent stages, not a hardcoded pipeline.** Parse → Source
  → Rank → Outreach-prep → Organize should be a registry of stages a
  workspace can configure (skip outreach-prep if they don't want AI
  drafting emails; add a stage later without a rewrite), not five
  functions called in a fixed sequence. This is what makes "add a new
  vendor" or "add a new agent capability" a config change instead of a
  refactor.
- **Continuous/ambient sourcing as a first-class citizen, not a bolt-on.**
  The "toughest role sources overnight" concept from earlier this
  session — scheduled backend runs against the same relaxation-ladder
  logic as on-demand sourcing, writing to the same `sourcing_runs` table,
  surfaced the same way in the canvas whether it ran at 2pm because a
  recruiter asked or at 2am on a schedule. One engine, two triggers —
  already the agreed mental model, now made real in the schema
  (`sourcing_runs.trigger_type: manual | scheduled`).
- **A real preference-learning loop, not just a log.** `decisions`
  (§2 of the rebuild proposal) shouldn't be write-only. Every accept/
  reject/skip with its signal snapshot is training data for ranking —
  the ordering key in `candidate_assessments` should eventually be
  informed by a workspace's own accept/reject history, not just a static
  rubric. This doesn't have to be a real ML model on day one — even a
  simple "this workspace tends to pass on candidates missing X" surfaced
  back to the recruiter as a pattern ("you've passed on 4 similar
  profiles for this reason — want to relax that filter?") is a
  meaningfully different product than a static scorer.
- **API-first, not UI-locked.** A staffing company especially will want
  to push candidates into *their client's* existing ATS, not just pull
  applications in. The webhook from the rebuild proposal (§3, inbound)
  should have an outbound counterpart from day one in the schema even if
  the UI to configure it ships later — `integration_endpoints`
  (workspace_id, direction: inbound/outbound, target_url, secret,
  event_types) as one generic table rather than special-casing "the ATS
  webhook feature" as a one-off.
- **Configuration over branching.** Segment differences (§1), stage
  composition, and integrations are all workspace-level config rows,
  not code branches. The product should be able to onboard a new client
  archetype (say, an RPO — recruitment process outsourcing firm, a third
  segment between direct and staffing) by adding config, not by a
  developer shipping a new conditional path through five files.

## What this changes in the schema from the rebuild proposal

Net-new: `integration_endpoints`, `agent_stage_config` (workspace_id,
stage_key, enabled, settings jsonb — this is also where `org_type`-driven
outreach tone lives, as a setting on the outreach-prep stage rather than
a schema fork). Modified: `workspaces.org_type` enum,
`sourcing_runs.trigger_type`. No `clients` table, no
`candidate_client_links` — retracted per the correction in §1.
Everything else in the original proposal (§2 there) stands as designed.

## What I need from you before starting

- Confirm `workspaces.org_type` (direct/staffing, extensible) plus an
  onboarding question is the right mechanism, and that outreach tone is
  the only confirmed behavioral difference for now — flag anything else
  segment-specific I should fold in before schema gets written.
- Sign off on treating agent-stage composability, continuous sourcing,
  the learning loop, and integrations-as-config as in-scope for the
  initial schema (even if the UI for some ships later) rather than
  retrofitted after the fact.
