--
-- Agent H: outbound candidate application portal.
--
-- Why this exists: Harsha's ask (2026-07-19) after closing the pipeline
-- action-button gap -- add an OUTBOUND path where a candidate can visit a
-- shareable link (per role) and self-submit name/email/phone/resume,
-- alongside the existing inbound/recruiter-sourced paths. This column is
-- the anchor for that link: a stable, unguessable per-deal token that a
-- public, unauthenticated page (`/apply/:token`, see CandidateApplicationPage)
-- and edge function (submit-candidate-application) resolve back to a
-- specific role brief, without exposing the deal's numeric id or requiring
-- any auth. The edge function that reads it runs with the service-role key
-- (this table has tenant-scoped RLS, and an anonymous applicant has no
-- tenant context to satisfy it), so no new RLS policy is needed here --
-- the token itself is the only thing standing in for auth on that path.
--
-- default gen_random_uuid() so every existing and future deal gets one for
-- free, with no backfill migration step required; unique so a token can
-- only ever resolve to exactly one role.
--

alter table public.deals
    add column public_application_token uuid not null unique default gen_random_uuid();

comment on column public.deals.public_application_token is 'Unguessable per-deal token used to build a shareable, unauthenticated candidate application link (/apply/:token). Resolved server-side by submit-candidate-application using the service-role key -- never exposed via the authenticated dataProvider path, only via an explicit "copy link" action.';

create index deals_public_application_token_idx on public.deals using btree (public_application_token);
