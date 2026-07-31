--
-- Agent H: unresolved taxonomy terms log.
--
-- Fire-and-forget sink for any seniority / location / company / skill token
-- that failed to resolve in the taxonomy tables. A recurring term here
-- means a missing taxonomy alias — promote to the alias table instead of
-- patching the compiler.
--
-- Design:
--   - Not tenant-scoped (global review queue; taxonomy aliases are global).
--   - Non-blocking: callers write with a best-effort insert, never await.
--   - No cascade delete: deal_id is informational only; keep the log even
--     when the deal is deleted so taxonomy gaps accumulate correctly.
--   - Dedup is intentional NOT done at write time — frequency in this table
--     drives which aliases to promote first (high-freq → high-priority).
--

create table public.unresolved_taxonomy_terms (
    id bigint generated always as identity primary key,
    category text not null check (category in ('seniority', 'location', 'company', 'skill')),
    raw_term text not null,
    deal_id bigint,  -- informational only; no FK so rows survive deal deletion
    occurred_at timestamptz not null default now()
);

comment on table public.unresolved_taxonomy_terms is
    'Taxonomy misses: seniority/location/company/skill tokens that did not '
    'resolve in any alias table. High-frequency entries are candidates for '
    'promotion into the alias table. Non-blocking fire-and-forget writes only.';

create index unresolved_taxonomy_terms_category_idx
    on public.unresolved_taxonomy_terms using btree (category);

create index unresolved_taxonomy_terms_occurred_at_idx
    on public.unresolved_taxonomy_terms using btree (occurred_at desc);

-- No RLS — this is a global audit table written by edge functions (service role).
-- Read access intentionally not granted to authenticated role; review via
-- dashboard / service-role queries only.
