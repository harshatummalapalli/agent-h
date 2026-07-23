--
-- Agent H Stage 3, candidate-visibility follow-up: persist the Voyage rank
-- score onto deal_candidates.
--
-- Why this exists: source-candidates-discovery computes a Voyage
-- cosine-similarity score per candidate at search time (checkpoint 3c), but
-- until now that score lived only in transient frontend state
-- (SourceCandidatesPage.tsx's _match_score) -- the moment a recruiter left
-- the search screen, or saved a candidate via "Add to pipeline", the score
-- was gone. That made it impossible to show saved candidates in rank order
-- anywhere outside the live search screen, which is exactly what a
-- Candidates admin view / role-brief candidates tab needs to do.
--
alter table public.deal_candidates add column match_score numeric;

comment on column public.deal_candidates.match_score is 'The Voyage cosine-similarity rank score (0..1) computed for this candidate against the role brief at search time (see source-candidates-discovery/index.ts), captured when the candidate was saved via "Add to pipeline" (see save-sourced-candidate/index.ts). Null for candidates saved before this column existed, or for any candidate a search didn''t score. Lets saved candidates be shown/sorted by rank instead of just save order -- previously this score was thrown away the moment a recruiter left the search screen.';
