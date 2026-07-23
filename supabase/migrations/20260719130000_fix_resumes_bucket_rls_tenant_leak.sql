-- Security fix (2026-07-19): the two "authenticated" policies on the
-- resumes bucket were bucket_id-scoped ONLY -- no tenant_id, no folder-
-- ownership check -- despite the read policy's name claiming "within
-- tenant". Any authenticated recruiter, from ANY tenant, could read or
-- overwrite ANY candidate's resume via the Storage REST API directly.
-- Every actual resume read/write path in this app already goes through
-- an edge function using the service-role key (which bypasses RLS
-- entirely) -- request-candidate-resume, resend-inbound-reply,
-- submit-candidate-application, upload-candidate-resume,
-- bulk-upload-candidate-resumes, score-candidate. No frontend code calls
-- supabase.storage.from("resumes") directly (confirmed via repo grep --
-- the only direct authenticated Storage usage in the app is the
-- unrelated "attachments" bucket for note attachments). So these two
-- policies were pure attack surface with zero legitimate caller.
-- Fix: drop them. Service-role access is unaffected (it bypasses RLS).
drop policy if exists "Resumes read within tenant recruiters" on storage.objects;
drop policy if exists "Resumes insert for authenticated" on storage.objects;
