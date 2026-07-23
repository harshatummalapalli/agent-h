--
-- Agent H Stage 3, checkpoint 3c: semantic ranking of sourced candidates
-- against a role brief.
--
-- Design choice, worth recording here: this does NOT use pgvector or a
-- separate vector database. At the batch sizes this screen deals with (10-25
-- candidates per fetch, a few hundred at most across "search wider" clicks),
-- comparing embeddings with plain JavaScript math inside the edge function
-- is simpler and is one fewer piece of infrastructure to run than standing
-- up pgvector-backed similarity search would be. Voyage AI's own embeddings
-- are already unit-length (confirmed directly against Voyage's docs), so
-- "cosine similarity" is just a plain dot product -- no extra normalization
-- math needed. See source-candidates-discovery/index.ts for the actual
-- scoring logic.
--
-- What IS persisted here is a cache of the role brief's OWN embedding --
-- re-running "search wider" for the same role brief would otherwise
-- re-embed (and re-pay Voyage for) identical role-brief text on every call.
-- Only the candidates need a fresh embedding each search, since they're
-- different people each time; the role brief's text is usually unchanged
-- between one search and the next.
--
alter table public.deals add column role_brief_embedding jsonb;
alter table public.deals add column role_brief_embedding_text text;
alter table public.deals add column role_brief_embedding_model text;
alter table public.deals add column role_brief_embedding_updated_at timestamp with time zone;

comment on column public.deals.role_brief_embedding is 'Cached Voyage AI embedding vector (a plain JSON array of floats) for this role brief''s combined text -- see buildRoleBriefEmbeddingText in source-candidates-discovery/index.ts. Recomputed only when role_brief_embedding_text no longer matches the role brief''s current fields, so editing a role brief automatically invalidates the cache without needing a separate trigger.';
comment on column public.deals.role_brief_embedding_text is 'The exact text that was embedded to produce role_brief_embedding. Compared against a freshly-built version of that same text on every search to detect whether the role brief changed since the last embedding.';
comment on column public.deals.role_brief_embedding_model is 'Which Voyage model produced role_brief_embedding (e.g. "voyage-4-lite"). Embeddings from different models are not directly comparable to each other, so this is checked before reusing a cached vector.';
comment on column public.deals.role_brief_embedding_updated_at is 'When role_brief_embedding was last (re)computed -- informational only, not used in any cache-invalidation logic (role_brief_embedding_text/_model comparison handles that).';
