-- Phase 2 (2026-07-26): Coordinator tab settings persisted to the deal row.
-- A single jsonb column is the minimum footprint — no new table, no join,
-- no migration complexity. Shape: {knowledge_base, calendar_link, reply_mode}.
-- reply_mode defaults to 'draft' (all replies held for approval) since that
-- is the only mode implemented; 'auto' is reserved for a future phase.
alter table public.deals
    add column if not exists coordinator_settings jsonb;

comment on column public.deals.coordinator_settings is
    'Phase 2 Coordinator tab settings: {knowledge_base, calendar_link, reply_mode}. reply_mode is always "draft" (held for approval) in Phase 2; "auto" is reserved for future.';
