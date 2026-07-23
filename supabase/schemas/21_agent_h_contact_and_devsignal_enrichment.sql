--
-- Agent H Stage 3, checkpoint 3d: contact enrichment + dev-signal enrichment
-- (#27, #28).
--
-- Two independent, best-effort enrichment lookups a recruiter can trigger
-- per candidate from the sourcing screen:
--   - Contact enrichment: waterfalls Hunter.io then Apollo to try to find a
--     work email/phone for a candidate who only has a LinkedIn profile on
--     file. See enrich-candidate-contact/index.ts.
--   - Dev-signal enrichment: best-effort matching against GitHub and Stack
--     Overflow public profiles, surfaced as corroborating signal (not a
--     hard identity match) for engineering candidates. See
--     enrich-candidate-devsignals/index.ts.
--
-- Also renames candidates.pdl_id -> candidates.source_id: PDL was disabled
-- in favor of Coresignal as the sole active discovery provider (see
-- source-candidates-discovery/index.ts DISCOVERY_PROVIDERS), so the column
-- name no longer matched what it actually held. The unique index
-- (candidates_tenant_pdl_id_uidx) keeps its old name across the rename --
-- Postgres updates the index definition automatically, only the name is
-- untouched, and renaming the index too isn't worth a second migration.
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
