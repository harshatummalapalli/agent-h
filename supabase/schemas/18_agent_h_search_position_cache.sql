--
-- Agent H Stage 3: remember each role brief's last PDL search position, so
-- clicking "Preview matches" -> "Fetch candidates" fresh (not "Search
-- wider") continues from where the recruiter left off, instead of
-- restarting at PDL's top matches every time.
--
-- Why this was needed: PDL's scroll_token (see source-candidates-discovery)
-- only persists across "Search wider" clicks within one browser session,
-- because it's held in React state on the frontend. As soon as a recruiter
-- leaves the page and comes back -- even the next minute -- a fresh
-- "Fetch candidates" click had no memory of that, so it always restarted at
-- PDL's page one. In practice this meant candidates already reviewed and
-- added to the pipeline kept resurfacing at the top of every new search.
--
-- This cache fixes that by persisting the last scroll_token PER ROLE BRIEF
-- (not per browser session), the same pattern as role_brief_embedding in
-- 17_agent_h_semantic_matching.sql. It is invalidated automatically if the
-- role brief's own searchable fields change (title/location/required_skills
-- -- whatever buildPdlQuery actually uses) by comparing the exact PDL query
-- JSON that was in effect when the token was captured, not just a
-- timestamp -- a PDL scroll_token is only valid for repeated use against the
-- SAME query it came from.
--
-- Deliberately NOT touched by the "probe" (size=1 preview call): only real
-- "Fetch candidates" / "Search wider" calls advance this cache, so a cheap
-- preview never burns through the recruiter's actual review position.
--
alter table public.deals add column role_brief_last_scroll_token text;
alter table public.deals add column role_brief_last_scroll_query text;
alter table public.deals add column role_brief_last_scroll_updated_at timestamp with time zone;

comment on column public.deals.role_brief_last_scroll_token is 'PDL scroll_token from the last real (non-preview) fetch for this role brief -- lets a fresh "Fetch candidates" click resume past matches already reviewed, rather than restarting at PDL''s top results every time. Null once PDL has no further results to page into, or before any fetch has happened yet.';
comment on column public.deals.role_brief_last_scroll_query is 'The exact PDL query JSON (JSON.stringify of buildPdlQuery''s output) that was in effect when role_brief_last_scroll_token was captured. Compared against a freshly-built query on every fetch -- if the role brief''s searchable fields changed since, the cached token is stale and is not reused (PDL scroll_tokens are only valid for repeated use against the same query).';
comment on column public.deals.role_brief_last_scroll_updated_at is 'When role_brief_last_scroll_token was last updated -- informational only, not used in any invalidation logic (role_brief_last_scroll_query comparison handles that).';
