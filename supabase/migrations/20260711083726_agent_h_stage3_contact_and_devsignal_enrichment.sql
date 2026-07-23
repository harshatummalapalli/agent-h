--
-- Agent H Stage 3, checkpoint 3d: contact enrichment + dev-signal enrichment
-- (#27, #28). See supabase/schemas/21_agent_h_contact_and_devsignal_enrichment.sql
-- for the full explanation of what/why.
--

alter table public.candidates rename column pdl_id to source_id;

comment on column public.candidates.source_id is 'The discovery vendor''s own unique person id for this candidate (e.g. Coresignal''s numeric id, or PDL''s own id when PDL sourced them). Null for candidates that did not come from an automated discovery vendor (manual entry, resume upload, etc.). Primary dedup key for vendor-sourced candidates. Renamed from pdl_id (2026-07-11) once Coresignal, not PDL, became the sole active discovery provider.';

alter table public.candidates
    add column contact_enrichment_status text,
    add column contact_enrichment_source text,
    add column contact_enrichment_raw jsonb,
    add column contact_enrichment_updated_at timestamp with time zone;

comment on column public.candidates.contact_enrichment_status is 'Null = never attempted. ''enriched'' = a vendor returned usable contact data (see contact_enrichment_source). ''not_found'' = the waterfall ran but no vendor had a match. ''failed'' = a real error occurred, distinct from a clean not_found.';
comment on column public.candidates.contact_enrichment_source is 'Which vendor actually supplied the contact data written to email_jsonb/phone_jsonb this time: ''hunter'' or ''apollo''. Null if contact_enrichment_status is not ''enriched''.';
comment on column public.candidates.contact_enrichment_raw is 'Full raw response from whichever vendor served this enrichment (Hunter''s or Apollo''s payload), kept for audit/debugging the same way candidates.source_raw preserves the original discovery payload.';
comment on column public.candidates.contact_enrichment_updated_at is 'When contact enrichment was last attempted for this candidate (regardless of outcome) -- lets the UI show staleness and avoid re-running needlessly.';

alter table public.candidates
    add column github_username text,
    add column github_url text,
    add column github_profile_raw jsonb,
    add column stackoverflow_url text,
    add column stackoverflow_profile_raw jsonb,
    add column devsignal_enrichment_status text,
    add column devsignal_enrichment_updated_at timestamp with time zone;

comment on column public.candidates.devsignal_enrichment_status is 'Null = never attempted. ''enriched'' = at least one of GitHub/Stack Overflow found a real match. ''not_found'' = both searched, neither matched. ''failed'' = a real error occurred.';
comment on column public.candidates.devsignal_enrichment_updated_at is 'When dev-signal enrichment was last attempted for this candidate (regardless of outcome).';
