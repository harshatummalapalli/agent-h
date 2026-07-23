# Agent H — Agentic Canvas Proposal

**Date:** 2026-07-22
**Status:** Proposal for sign-off, nothing in this doc has been built yet.

## Why this doc exists

The token-level theme pass (dark glass palette applied to every shadcn
component) made the whole app *look* more consistent, but it didn't fix
the real complaint: Job Intake, Source Candidates, Candidates, and Roles
are still four separate React Admin CRUD pages you have to navigate
between and operate by hand. The Inbox + Sourcing sidebar feel different
because they're the only screens that were actually rebuilt around a
conversational, agent-driven flow instead of forms and tables.

Harsha's ask is bigger than a skin: replace the CRM-shaped navigation
(separate Job Intake / Source Candidates / Candidates / Roles pages, each
its own form-and-table screen) with one continuous, agentic canvas —
paste or speak a thought, watch agents work, approve the consequential
steps, and land in a platform that never made you go find the right page
to do the next thing.

## One important scope split

"Remove the underlying CRM structure completely" could mean two very
different things, and they carry very different risk:

- **The data model** (Postgres schema: `deals` as roles, `candidates`,
  `deal_candidates`, RLS policies, the Coresignal/Exa sourcing pipeline
  that already writes into it). This is proven, audited, and is what
  every real backend function this session already targets. Rebuilding
  it is not what's actually broken.
- **The presentation shell** (`ra-core`'s `Resource` / `List` /
  `Datagrid` / `Show` / `Edit` pattern — one CRUD page per entity, plus
  the top-nav that routes between them). This *is* what's broken: it's
  a generic admin-panel skeleton, and it's the reason Job Intake feels
  like a form and Source Candidates feels like a search tool instead of
  both feeling like the same product as the Inbox.

**Recommendation: keep the schema and the Supabase auth/data-provider
plumbing (`ra-core`'s dataProvider/authProvider), replace the CRUD page
shell.** Rebuilding auth and RLS from scratch buys nothing and risks
real breakage (login already caused enough pain this week); replacing
the page shell is exactly what makes the "flows naturally, no page-
hunting" feeling possible. If this reading is wrong and you do want the
schema itself reshaped, say so explicitly before Phase 1 starts — that's
a different, larger project.

## The target experience

A recruiter opens the platform. There is no "Job Intake" step to find.
There's one input — paste, type, or speak — sitting where they land.
They describe a role or paste a JD. From there:

1. **Parse.** The input becomes a structured role brief and a compiled
   boolean query in the background. The recruiter doesn't see query
   syntax; they see a plain-language confirmation of what's being
   searched for, with a chance to correct it before anything runs.
2. **Source.** Candidate records start appearing on screen as they're
   found — not a batch dump after a wait, a stream. This is the part
   most directly inherited from the Sourcing sidebar work already built
   this session (`useSourcingThread`, `continueSourcingForDeal`) —
   extended to be the *primary* entry point instead of a side panel.
3. **Rank.** Once a meaningful number of records have surfaced, a
   ranking pass orders them by evidence (skills/experience match, not
   an opaque "recommended for you" score) — this is new backend work,
   nothing today ranks candidates.
4. **Prepare outreach.** A third pass drafts outreach for candidates the
   recruiter has approved, using verified contact data (email/phone
   enrichment infrastructure already exists on `candidates`, per this
   session's schema audit) — also new work; nothing sends today, and
   nothing should send without explicit recruiter approval per message.
5. **Organize.** Everything pulled in gets filed — into the role's
   pipeline, tagged with why it matched — so returning to this role
   later shows a coherent record, not a pile.

Every step that costs money (search credits), touches a third party
(outreach), or changes pipeline state asks first. That's the human-in-
the-loop model already established for sourcing (nothing auto-sends,
nothing auto-relaxes a criterion without confirmation) — this proposal
extends the same posture to ranking and outreach rather than introducing
a new philosophy.

## Structure once a role's initial sourcing run is done

- **Jobs rail** (persistent, always visible): every role, its status,
  one click back into its full history — what was searched, what was
  found, what was approved, what's pending. This replaces the Roles/
  Deals kanban board as the *primary* navigation entry; the kanban view
  itself is still useful and can live as a view *inside* this rail
  rather than being deleted — pipeline-stage visualization is genuinely
  useful, it just shouldn't be the front door.
- **All Candidates** (separate, cross-job): every candidate ever
  sourced, independent of which role found them, so a strong candidate
  for a closed role isn't lost when a similar role opens later.
- **Revisit, don't restart**: reopening a role's history should let the
  recruiter reuse previously-found candidates against a new or relaxed
  brief without re-spending search credits on people already in hand.

## Analytics / reports (net-new — nothing like this exists today)

Given the schema already in place (`deals`, `candidates`,
`deal_candidates`, `sourcing_runs`, `candidate_scores`), a first-pass
recruiter dashboard is buildable without new tracking:

- Time-in-stage / time-to-fill per role
- Sourcing yield: found → relevant → saved → contacted → responded,
  per role and per vendor (Coresignal vs. Exa vs. free portals)
- Pipeline health: roles with no movement in N days, roles with zero
  qualified candidates
- Credit spend vs. roles filled (the cost conversation from the
  Coresignal/Crustdata comparison, made visible instead of tracked in
  chat)

A manager/leadership rollup (cross-recruiter) is a real fast-follow, not
part of this pass — it needs a team/manager hierarchy concept that I
haven't confirmed exists in the schema yet. Recommend recruiter-view
first since the data supports it today; say so if you want it reversed.

## Phasing (this is not a one-shot change)

1. **Unified entry canvas** — collapse Job Intake + Source Candidates
   into one flow reusing the parse → source pattern already proven in
   the Sourcing sidebar. Highest value, most code already exists to
   extend rather than invent.
2. **Jobs rail + All Candidates view** — replace the Roles/Deals board
   and Candidates list as primary nav; kanban becomes a view, not a
   destination.
3. **Rank + outreach-prep + organize agent stages** — the two stages
   above that don't exist as real backend work yet (ranking, outreach
   drafting). This is genuinely new engineering, not a UI reskin of
   something that already runs.
4. **Analytics dashboard** — recruiter-first per the reasoning above.

Each phase is independently shippable and reversible; I'd rather land
Phase 1 and get your reaction on the actual feel before committing to
the rest, than build all four blind.

## What I need from you before starting

- Confirm the schema-vs-shell scope split above is what you meant.
- Confirm Phase 1 (unified entry canvas) is where to start.
- Flag if the manager-rollup analytics is actually more urgent than
  recruiter-view (e.g. if this is being demoed to a boss soon).
