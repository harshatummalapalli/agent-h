--
-- Agent H Stage 3, checkpoint 3d (pre-work): cache a role brief's expanded
-- list of equivalent job titles, so PDL searches match candidates whose
-- current title is a synonym of the role brief's title, not only the exact
-- literal string.
--
-- Why this was needed: buildPdlQuery previously did a single match_phrase
-- on the role brief's raw title (e.g. "Senior Backend Engineer"). Real
-- candidates hold equivalent titles PDL indexes differently -- "Backend
-- Developer", "Software Engineer", "SWE", "Systems Engineer" -- and a single
-- literal match_phrase silently excludes all of them. Confirmed directly by
-- testing a competitor product (noon.ai) side-by-side on the same role: it
-- expands one title into a list of synonyms before searching, and does not
-- rely on a single literal string. This is the same fix, adapted to PDL's
-- query shape (see source-candidates-discovery/index.ts, buildPdlQuery and
-- getOrExpandTitles).
--
-- Same cache-by-text-comparison pattern as role_brief_embedding
-- (17_agent_h_semantic_matching.sql) and role_brief_last_scroll_token
-- (18_agent_h_search_position_cache.sql): the expansion is only
-- re-generated when the role brief's title text no longer matches what was
-- expanded last time, not on every search -- title expansion rarely changes
-- between one search and the next for the same role brief, so there's no
-- reason to re-pay for an LLM call on every "Search wider" click.
--
alter table public.deals add column role_brief_title_expansions jsonb;
alter table public.deals add column role_brief_title_expansions_source_title text;
alter table public.deals add column role_brief_title_expansions_updated_at timestamp with time zone;

comment on column public.deals.role_brief_title_expansions is 'Cached list of job titles (a plain JSON array of strings, including the original title itself) considered equivalent to this role brief''s title for PDL search purposes -- e.g. "Backend Engineer" expands to include "Backend Developer", "Software Engineer", "SWE". Generated once via Claude (see getOrExpandTitles in source-candidates-discovery/index.ts), not re-generated on every search.';
comment on column public.deals.role_brief_title_expansions_source_title is 'The exact role brief title text that was expanded to produce role_brief_title_expansions. Compared against the role brief''s current title on every search to detect whether the title changed since the last expansion (same invalidation pattern as role_brief_embedding_text).';
comment on column public.deals.role_brief_title_expansions_updated_at is 'When role_brief_title_expansions was last (re)computed -- informational only, not used in any cache-invalidation logic (role_brief_title_expansions_source_title comparison handles that).';
