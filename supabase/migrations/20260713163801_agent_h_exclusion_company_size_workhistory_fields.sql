--
-- Agent H: "cheap and worth it" sourcing-refinement pass (exclusion
-- criteria, company type/size, career-stability signal), scoped from
-- Harsha's Job Intake / Source Candidates feature-request list.
--
alter table public.deals add column excluded_companies text[];
alter table public.deals add column exclusion_keywords text[];
alter table public.deals add column company_type text;
alter table public.deals add column company_size_min integer;
alter table public.deals add column company_size_max integer;

comment on column public.deals.excluded_companies is 'Recruiter-entered company names to hard-exclude from sourcing results (e.g. direct competitors, companies already contacted). Threaded into DiscoveryCriteria.excludedCompanies and applied as a must_not clause in source-candidates-discovery -- the first must_not this query builder has ever needed (see that function''s header comment on why every other constraint is deliberately a soft "should" signal instead: exclusions are the one case where being wrong in the exclude direction is the safer failure mode).';
comment on column public.deals.exclusion_keywords is 'Recruiter-entered free-text terms (skills, titles, anything) to hard-exclude candidates on, same must_not treatment as excluded_companies. Distinct from must_have/nice_to_have_keywords, which are both inclusion-only.';
comment on column public.deals.company_type is 'Recruiter-entered company-type preference for the employer to source from (Startup, Product, Services, GCC, Enterprise, Consulting, etc.) -- free text, not an enum, since this taxonomy varies a lot by recruiter and market. Used as a should (soft) signal, same treatment as industry, not a hard filter -- Coresignal has no dedicated "company type" field, so this is matched against company_industry/company_name text, which is inexact.';
comment on column public.deals.company_size_min is 'Recruiter-entered minimum employee-count preference for the employer to source from. Mapped to Coresignal''s experience.company_employees_count_gte (nested ES DSL field, confirmed via Coresignal''s Base Employee API search-filters docs) as a should signal.';
comment on column public.deals.company_size_max is 'Recruiter-entered maximum employee-count preference, paired with company_size_min. See that column''s comment for the Coresignal field mapping.';

alter table public.candidates add column work_history jsonb;
comment on column public.candidates.work_history is 'Per-position work history extracted from Coresignal''s nested experience array at sourcing time (experience.title, experience.company_name, experience.date_from, experience.date_to -- see normalizeCoresignalCandidate in source-candidates-discovery/index.ts), captured when the candidate was saved via "Add to pipeline". A plain JSON array of {title, company_name, date_from, date_to} objects, most-recent-first as returned by Coresignal. Used to compute career-stability signals (average tenure, job-change frequency) at display time without a second vendor call. Null for candidates saved before this column existed, or if Coresignal returned no experience array for that candidate.';
