--
-- Agent H, task 76: candidate outreach + resume-reply capture.
--
-- Deliberately NOT a messaging/inbox system (PRD Section 3 explicitly defers
-- "messaging-as-a-first-class-entity"). This is a single-purpose capture
-- mechanism: a recruiter asks one candidate for a resume, the candidate
-- replies (optionally with the resume attached), and Agent H records the
-- outcome onto the existing candidates row -- no threads, no multi-message
-- history, matching the "current state, not history" pattern already used
-- by candidate_scores/candidate_fit_assessments/interviews.
--
-- Correlation mechanism: request-candidate-resume sets a reply_to address of
-- the shape candidate-<id>-deal-<id>@<RESEND_RECEIVING_DOMAIN> when it sends
-- the outreach email. When the candidate hits "Reply", their reply's `to`
-- carries that exact address back to Agent H's inbound webhook -- so
-- resend-inbound-reply parses candidate_id/deal_id directly out of the
-- address rather than fuzzy-matching by sender email (which may differ from
-- whatever's on file).
--
alter table public.candidates add column resume_status text
    not null default 'not_requested'
    check (resume_status in ('not_requested', 'requested', 'received'));
alter table public.candidates add column resume_storage_path text;
alter table public.candidates add column resume_original_filename text;
alter table public.candidates add column resume_requested_at timestamp with time zone;
alter table public.candidates add column resume_received_at timestamp with time zone;
alter table public.candidates add column resume_reply_text text;

comment on column public.candidates.resume_status is 'not_requested (default) -> requested (outreach sent) -> received (a resume-like attachment was captured from their reply). Candidate-level, not deal-level -- a resume belongs to the person, not to whichever role brief prompted the request.';
comment on column public.candidates.resume_storage_path is 'Path within the private "resumes" Supabase Storage bucket. Null until resume_status = received.';
comment on column public.candidates.resume_reply_text is 'The plain-text body of whatever the candidate replied with (capped length) -- kept for recruiter context even on replies with no usable attachment (e.g. "I don''t have it handy, will send later").';

-- Private bucket -- resumes are not public files. Every read/write path
-- (request-candidate-resume, resend-inbound-reply,
-- submit-candidate-application, upload-candidate-resume,
-- bulk-upload-candidate-resumes, score-candidate) goes through an edge
-- function using the service_role key, which bypasses RLS entirely --
-- same as every other service-role-only write path in this schema
-- (events, webhook receivers).
insert into storage.buckets (id, name, public, file_size_limit)
values ('resumes', 'resumes', false, 10485760)
on conflict (id) do nothing;

-- Security fix (2026-07-19, migration fix_resumes_bucket_rls_tenant_leak):
-- this schema originally shipped two "authenticated" policies here
-- (read + insert), both scoped by bucket_id ONLY -- no tenant_id, no
-- folder-ownership check -- despite the read policy's name claiming
-- "within tenant". That let any authenticated recruiter, from ANY
-- tenant, read or overwrite ANY candidate's resume directly via the
-- Storage REST API. Confirmed (via repo grep) that no frontend code
-- ever calls supabase.storage.from("resumes") directly -- every access
-- path is server-side via the service-role key, which bypasses RLS
-- entirely and needs no policy here. So those two policies were pure
-- attack surface with zero legitimate caller -- removed rather than
-- tightened, since tightening (e.g. tenant-scoping by folder prefix)
-- would still be strictly more permissive than the "no authenticated
-- access at all" this bucket actually needs.

