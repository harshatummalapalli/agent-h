-- Agent H Stage 2: structured role-brief fields.
-- Flattened, literal record of what was applied directly to the live
-- Supabase project (fbkdypullttetardrgdu / "Agent H") as migration
-- agent_h_stage2_structured_role_brief_fields. See
-- supabase/schemas/15_agent_h_structured_role_brief_fields.sql for the
-- commented source-of-truth version.

alter table public.deals add column required_skills text[];
alter table public.deals add column years_experience_min smallint;
alter table public.deals add column years_experience_max smallint;
alter table public.deals add column industry text;
alter table public.deals add column employment_type text;
alter table public.deals add column must_have_keywords text[];
alter table public.deals add column nice_to_have_keywords text[];

comment on column public.deals.required_skills is 'Structured extraction from jd_text (Stage 2 JD intake), used directly as PDL Person Search criteria in Stage 3 -- not re-derived from text at sourcing time.';
comment on column public.deals.must_have_keywords is 'Hard requirements from the JD, distinct from nice_to_have_keywords -- drives the score-gate threshold logic described in the sourcing engine doc (Section 2, "Score gate").';
