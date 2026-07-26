-- ============================================================
-- reset-test-data.sql  —  Clean-Slate Reset for E2E Testing
-- ============================================================
-- PURPOSE  : Wipes all recruiter role/job + candidate data so
--            the Crustdata E2E test starts from a blank slate.
-- WHERE    : Run in the Supabase Dashboard → SQL Editor on the
--            hosted project.  No Docker / local Supabase needed.
-- WARNING  : IRREVERSIBLE.  All roles, candidates, and sourcing
--            caches are permanently deleted.
-- PRESERVES: auth.users, public.sales, public.tenants,
--            public.configuration, public.companies,
--            public.contacts, public.tags, public.tasks,
--            LinkedIn / Unipile connection settings,
--            and all coordinator settings.
-- ============================================================

BEGIN;

-- Helpers: silently skip operations for tables that may not yet
-- exist in every environment (avoids "relation does not exist").
CREATE OR REPLACE FUNCTION _try_delete(tbl TEXT) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DELETE FROM public.%I', tbl);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION _try_count(tbl TEXT) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE format('SELECT count(*) FROM public.%I', tbl) INTO n;
  RETURN n;
EXCEPTION WHEN undefined_table THEN RETURN -1; -- -1 = table absent
END $$;

-- ---- Leaf rows first (deepest FK children) ------------------

-- 1. LinkedIn outreach follow-ups (FK → deal_candidates)
SELECT _try_delete('linkedin_outreach_follow_ups');

-- 2. Scoring / fit-assessment rows (FK → candidates + deals)
SELECT _try_delete('candidate_scores');
SELECT _try_delete('candidate_fit_assessments');

-- 3. Calibration feedback (FK → candidates)
SELECT _try_delete('candidate_calibration_feedback');

-- 4. Interview bookings (FK → candidates + deals)
SELECT _try_delete('interviews');

-- 5. Offer records (FK → candidates + deals)
SELECT _try_delete('offers');

-- 6. Vendor / source attribution (FK → candidates + deals)
SELECT _try_delete('discovery_source_attribution');

-- 7. Role conversation turns (FK → deals)
SELECT _try_delete('role_conversation_turns');

-- 8. Learned criteria (FK → deals)
SELECT _try_delete('role_brief_learned_criteria');

-- 9. Role-discovery cache — ranked pools stored per role.
--    CRITICAL: without this, old ranked pools reappear after reset.
SELECT _try_delete('role_discovery_cache');

-- 10. Role-brief and candidate assignment tables
SELECT _try_delete('role_brief_assignments');
SELECT _try_delete('candidate_assignments');

-- 11. Deal notes (FK → deals)
SELECT _try_delete('deal_notes');

-- 12. Junction table linking candidates to deals/roles
SELECT _try_delete('deal_candidates');

-- ---- Primary entities ---------------------------------------

-- 13. Candidates (must come after all child rows)
SELECT _try_delete('candidates');

-- 14. Deals / Roles (clears the Kanban board)
SELECT _try_delete('deals');

-- ---- Verification: every count should be 0 (or -1 = absent) -
SELECT
  'role_discovery_cache'     AS "table", _try_count('role_discovery_cache')     AS "rows (0=clean, -1=absent)"
UNION ALL SELECT
  'deals',                               _try_count('deals')
UNION ALL SELECT
  'candidates',                          _try_count('candidates')
UNION ALL SELECT
  'deal_candidates',                     _try_count('deal_candidates')
UNION ALL SELECT
  'role_conversation_turns',             _try_count('role_conversation_turns');

-- ---- Cleanup helpers ----------------------------------------
DROP FUNCTION _try_delete(TEXT);
DROP FUNCTION _try_count(TEXT);

COMMIT;
