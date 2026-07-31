--
-- Agent H: Harvest API profile enrichment columns on public.candidates
--
-- Vendor role (locked 2026-07-30): Harvest API is the profile enrichment
-- vendor — experience, education, skills, photo. PDL handles contact
-- (email/phone) separately via enrich-candidate-contact.
--
-- work_history jsonb already exists (added in
-- 24_agent_h_exclusion_company_size_workhistory_fields.sql). This migration
-- adds the two new columns needed for Harvest enrichment tracking.
--

alter table public.candidates
    add column if not exists photo_url text;

comment on column public.candidates.photo_url is
    'Profile photo URL from Harvest API profilePictureUrl field. '
    'Populated by the Harvest batch enrichment step in calibration-session '
    'and by the card Enrich/refresh action. Not from PDL or Crustdata.';

alter table public.candidates
    add column if not exists harvest_enriched_at timestamp with time zone;

comment on column public.candidates.harvest_enriched_at is
    'Timestamp of the most recent successful Harvest API profile enrichment. '
    'Used to determine staleness and skip re-enriching recently enriched candidates '
    'in batch runs.';
