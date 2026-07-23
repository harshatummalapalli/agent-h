--
-- Agent H Stage 3, candidate-visibility follow-up: persist the Voyage rank
-- score onto deal_candidates. See
-- supabase/schemas/23_agent_h_deal_candidates_match_score.sql for the full
-- explanation of what/why.
--

alter table public.deal_candidates add column match_score numeric;

comment on column public.deal_candidates.match_score is 'The Voyage cosine-similarity rank score (0..1) computed for this candidate against the role brief at search time (see source-candidates-discovery/index.ts), captured when the candidate was saved via "Add to pipeline" (see save-sourced-candidate/index.ts). Null for candidates saved before this column existed, or for any candidate a search didn''t score. Lets saved candidates be shown/sorted by rank instead of just save order -- previously this score was thrown away the moment a recruiter left the search screen.';
