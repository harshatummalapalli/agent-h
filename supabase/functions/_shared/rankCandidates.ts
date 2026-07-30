// rankCandidates — deterministic ranking of a filtered candidate set by prefer conditions.
//
// Called AFTER validateAndAssembleIntent has applied hard Require/Exclude filters.
// Scores each candidate by how many "prefer" conditions their profile matches,
// then returns the same candidates in score-descending order with which prefers
// matched and a short evidence quote per matched prefer.
//
// Design (2026-07-30, v1):
//   - Scoring: weighted prefer-match count (each matched prefer = 1 point).
//   - Evidence: substring-check in job_title, job_company_name, location_name,
//     and skills array (the fields normalizecrustdataProfile exposes).
//   - No ML — a candidate with more prefer matches is ranked higher, ties broken
//     by original order from the vendor.
//   - Spec §4.2: "weighted match count is an acceptable v1 — does not need to be ML."
//
// To add a new scoring signal: add a case in `matchPrefer()`. Never add a compiler
// if-branch — the prefer conditions list IS the scoring config.
//
// No Deno-specific imports — Vitest-compatible.

import type { SearchIntentCondition } from "./searchIntent.ts";
import type { RawCalibrationCandidate } from "./crustdataClient.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PreferMatch = {
  /** The prefer condition that matched */
  condition: SearchIntentCondition;
  /** Substring evidence from the candidate's profile (empty string if unavailable) */
  evidence: string;
};

export type RankedCandidate = RawCalibrationCandidate & {
  /** Number of prefer conditions matched (higher = better fit) */
  prefer_score: number;
  /** Which prefer conditions matched, with evidence */
  prefer_matches: PreferMatch[];
};

// ─── Matching ─────────────────────────────────────────────────────────────────

const CI = (s: string) => s.toLowerCase();

/**
 * Check whether a single prefer condition is evidenced by a candidate's
 * normalized profile fields. Returns the evidence string if matched, null if not.
 */
function matchPrefer(
  cond: SearchIntentCondition,
  candidate: RawCalibrationCandidate,
): string | null {
  const needle = CI(cond.value.trim());
  if (!needle) return null;

  switch (cond.category) {
    case "skill": {
      const match = candidate.skills.find((s) => CI(s).includes(needle));
      return match ?? null;
    }

    case "title": {
      const title = candidate.job_title ?? "";
      return CI(title).includes(needle) ? title : null;
    }

    case "company": {
      const company = candidate.job_company_name ?? "";
      return CI(company).includes(needle) ? company : null;
    }

    case "location": {
      const location = candidate.location_name ?? "";
      return CI(location).includes(needle) ? location : null;
    }

    case "seniority": {
      // Seniority isn't exposed in the normalized profile (it's a filter-side
      // field) — match against title as a proxy.
      const title = candidate.job_title ?? "";
      return CI(title).includes(needle) ? title : null;
    }

    case "experience_range": {
      // Prefer an experience range — check years_experience falls in the range.
      const yoe = candidate.years_experience;
      if (yoe == null) return null;
      const minM =
        cond.value.match(/min:(\d+)/i) ?? cond.value.match(/^(\d+)-/);
      const maxM =
        cond.value.match(/max:(\d+)/i) ?? cond.value.match(/-(\d+)$/);
      const min = minM ? Number(minM[1]) : null;
      const max = maxM ? Number(maxM[1]) : null;
      const inRange =
        (min == null || yoe >= min) && (max == null || yoe <= max);
      return inRange ? `${yoe} years` : null;
    }

    // Other categories have no corresponding normalized profile field — skip.
    default:
      return null;
  }
}

// ─── Main ranking function ─────────────────────────────────────────────────────

/**
 * Rank a candidate set by how many prefer conditions each candidate matches.
 *
 * @param candidates  Normalized candidates (already filtered by Require/Exclude).
 * @param prefers     The prefer-disposition conditions from the search intent.
 * @returns Candidates in descending prefer_score order; ties preserve input order.
 */
export function rankCandidates(
  candidates: RawCalibrationCandidate[],
  prefers: SearchIntentCondition[],
): RankedCandidate[] {
  if (prefers.length === 0) {
    // No prefer conditions — return as-is with zero scores.
    return candidates.map((c) => ({
      ...c,
      prefer_score: 0,
      prefer_matches: [],
    }));
  }

  const ranked: RankedCandidate[] = candidates.map((candidate) => {
    const prefer_matches: PreferMatch[] = [];

    for (const cond of prefers) {
      if (cond.disposition !== "prefer") continue;
      const evidence = matchPrefer(cond, candidate);
      if (evidence !== null) {
        prefer_matches.push({ condition: cond, evidence });
      }
    }

    return {
      ...candidate,
      prefer_score: prefer_matches.length,
      prefer_matches,
    };
  });

  // Stable sort: higher score first; equal scores keep original order.
  ranked.sort((a, b) => b.prefer_score - a.prefer_score);

  return ranked;
}
