--
-- Agent H Stage 3: rename candidate_calibration_feedback.pdl_id ->
-- source_id. See supabase/schemas/22_agent_h_calibration_feedback_source_id_rename.sql
-- for the full explanation of what/why.
--

alter table public.candidate_calibration_feedback rename column pdl_id to source_id;

comment on column public.candidate_calibration_feedback.source_id is 'The discovery vendor''s own person id for the candidate this judgment was made about (not a foreign key to candidates.id -- calibration happens on preview-stage hits that may not be saved yet). Renamed from pdl_id (2026-07-11), same reason as candidates.source_id.';
