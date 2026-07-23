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
comment on column public.candidates.work_history is 'Reserved for a future enrichment step, NOT yet populated by anything. Confirmed via Coresignal''s published API docs: their search/preview response is denormalized and does not include the nested experience array (same known gap already documented for `skills` in normalizeCoresignalCandidate) -- full per-position work history (title, company, dates) only comes from Coresignal''s separate /collect/{employee_id} endpoint, a second paid call per candidate. Building this properly means a new on-demand enrichment action (an enrich-candidate-workhistory edge function + UI button), the same shape as enrich-candidate-contact/enrich-candidate-devsignals, not free computation on data already in hand. That follow-up is not built yet -- this column exists so the shape is ready when it is.';
