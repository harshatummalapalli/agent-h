-- Outreach stage on deal_candidates (2026-07-22): bridges "just sourced" to
-- "actively being contacted" -- deal_candidates previously had no
-- stage/status/outreach tracking at all (id, tenant_id, org_type, deal_id,
-- candidate_id, sourced_via, created_at, match_score only). Mirrors the
-- offers.status convention from Stage 6 (public.offers): status only ever
-- advances forward automatically (sent -> responded), never auto-downgraded
-- once a recruiter has set something themselves, and a later reply always
-- refreshes reply_text/responded_at even if status itself is left alone.
--
-- Already applied directly to the live Supabase project
-- (fbkdypullttetardrgdu / "Agent H") via the Supabase MCP tools as migration
-- agent_h_deal_candidates_outreach_stage.

alter table public.deal_candidates
  add column response_status text not null default 'not_contacted',
  add column contacted_at timestamptz,
  add column responded_at timestamptz,
  add column reply_text text;

alter table public.deal_candidates
  add constraint deal_candidates_response_status_check
  check (response_status in ('not_contacted', 'sent', 'responded'));

comment on column public.deal_candidates.response_status is
  'not_contacted (default) -> sent (send-first-outreach fired) -> responded (a reply was captured via resend-inbound-reply). Never auto-downgraded once set to responded.';
comment on column public.deal_candidates.contacted_at is
  'When send-first-outreach last sent an email to this candidate for this deal. Null until first send.';
comment on column public.deal_candidates.responded_at is
  'When resend-inbound-reply last captured a reply to the outreach email. Updated on every reply, independent of response_status.';
comment on column public.deal_candidates.reply_text is
  'Free-text body of the candidate''s most recent reply to the outreach email (first 2000 chars, same truncation convention as resume_reply_text/offers.response_text). Not classified/parsed -- the recruiter reads it themselves, same principle as offers.response_text.';
