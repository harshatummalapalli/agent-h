-- Migration: add role_brief_search_intent column to deals
-- Generated: 2026-07-27
-- DO NOT apply to hosted Supabase until recruiter re-verifies.
-- Schema source of truth: supabase/schemas/01_tables.sql (column already present there).
--
-- To apply manually via the Supabase Dashboard SQL editor, paste the two
-- statements below. To apply via CLI: npx supabase db push
-- (ensure SUPABASE_PROJECT_ID / SUPABASE_ACCESS_TOKEN are set first).

alter table public.deals
  add column if not exists role_brief_search_intent jsonb;

comment on column public.deals.role_brief_search_intent is
  'Versioned SearchIntent record: { current: VersionedSearchIntent, history: VersionedSearchIntent[] }. Produced by resolve-search-intent.';
