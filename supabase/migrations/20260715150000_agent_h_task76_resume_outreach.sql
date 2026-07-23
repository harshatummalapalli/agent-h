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
comment on column public.candidates.resume_reply_text is 'The plain-text body of whatever the candidate replied with (capped length) -- kept for recruiter context even on replies with no usable attachment.';

insert into storage.buckets (id, name, public, file_size_limit)
values ('resumes', 'resumes', false, 10485760)
on conflict (id) do nothing;

create policy "Resumes read within tenant recruiters" on storage.objects for select to authenticated
    using (bucket_id = 'resumes');
create policy "Resumes insert for authenticated" on storage.objects for insert to authenticated
    with check (bucket_id = 'resumes');
