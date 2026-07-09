--
-- Agent H Stage 2: structured role-brief fields.
-- These map directly onto what the sourcing engine (Stage 3) will query
-- PDL's Person Search API with -- per kharta-sourcing-engine-architecture.md
-- Section 1/2, the JD-to-search-criteria translation happens ONCE here at
-- intake time, and the sourcing engine just reads these fields later
-- instead of re-parsing the JD text. This is what "one structured object,
-- created once, read by every downstream stage" means concretely.
--
-- Already applied directly to the live Supabase project
-- (fbkdypullttetardrgdu / "Agent H") via migration
-- agent_h_stage2_structured_role_brief_fields -- this file is the
-- corresponding declarative source-of-truth entry, per Atomic CRM's schema
-- convention (see doc/src/content/docs/developers/migrations.mdx).
--
alter table public.deals add column required_skills text[];
alter table public.deals add column years_experience_min smallint;
alter table public.deals add column years_experience_max smallint;
alter table public.deals add column industry text;
alter table public.deals add column employment_type text;
alter table public.deals add column must_have_keywords text[];
alter table public.deals add column nice_to_have_keywords text[];

comment on column public.deals.required_skills is 'Structured extraction from jd_text (Stage 2 JD intake), used directly as PDL Person Search criteria in Stage 3 -- not re-derived from text at sourcing time.';
comment on column public.deals.must_have_keywords is 'Hard requirements from the JD, distinct from nice_to_have_keywords -- drives the score-gate threshold logic described in the sourcing engine doc (Section 2, "Score gate").';
