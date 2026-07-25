-- Agent H: Clean-Slate Reset Script
-- ====================================
-- Wipes all role and candidate data so the recruiter can start fresh for
-- testing. Does NOT touch auth.users, public.sales, public.configuration,
-- or any base CRM tables (contacts, companies, contact_notes, tags, tasks).
--
-- Usage options:
--
--   Option A — Local Supabase (safest, instant):
--     npx supabase db reset --local
--   This re-runs all migrations from scratch and gives a truly blank slate,
--   but wipes everything including auth.users (you'll need to re-signup).
--
--   Option B — Targeted delete (preserves auth, only wipes roles+candidates):
--     Run this file in the Supabase Dashboard SQL Editor, or:
--     psql "$DATABASE_URL" -f scripts/reset-test-data.sql
--
--   Option C — Service-role via CLI:
--     npx supabase db execute --file scripts/reset-test-data.sql --local
--
-- Table deletion order respects FK constraints (children before parents).
-- All deletes are unrestricted — no tenant filter — so run this only in
-- local / staging environments, never in production.
-- ====================================

BEGIN;

-- 1. Outreach follow-ups (FK → deal_candidates)
DELETE FROM public.linkedin_outreach_follow_ups;

-- 2. Agent H scoring / fit / evidence rows (FK → candidates + deals)
DELETE FROM public.candidate_scores;
DELETE FROM public.candidate_fit_assessments;

-- 3. Enrichment / devsignal data (FK → candidates)
DELETE FROM public.candidate_calibration_feedback;

-- 4. Interview bookings (FK → candidates + deals)
DELETE FROM public.interviews;

-- 5. Offer records (FK → candidates + deals)
DELETE FROM public.offers;

-- 6. Vendor source attribution (FK → candidates + deals)
DELETE FROM public.discovery_source_attribution;

-- 7. Role conversation turns (FK → deals)
DELETE FROM public.role_conversation_turns;

-- 8. Learned criteria (FK → deals)
DELETE FROM public.role_brief_learned_criteria;

-- 9. Candidate–role assignments
DELETE FROM public.deal_candidates;

-- 10. Candidates table (main entity)
DELETE FROM public.candidates;

-- 11. Deals / Roles (clears the Kanban board)
DELETE FROM public.deals;

-- Report counts (should all be 0)
SELECT
  'linkedin_outreach_follow_ups' AS tbl, count(*) FROM public.linkedin_outreach_follow_ups
UNION ALL SELECT 'deal_candidates', count(*) FROM public.deal_candidates
UNION ALL SELECT 'candidates', count(*) FROM public.candidates
UNION ALL SELECT 'deals', count(*) FROM public.deals
UNION ALL SELECT 'discovery_source_attribution', count(*) FROM public.discovery_source_attribution
UNION ALL SELECT 'role_conversation_turns', count(*) FROM public.role_conversation_turns;

COMMIT;
