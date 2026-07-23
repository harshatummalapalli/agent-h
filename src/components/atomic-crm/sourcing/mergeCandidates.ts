// Cross-provider merge/dedupe for the unified free + low-cost search tier
// (2026-07-19). Harsha's explicit call: the recruiter shouldn't have to
// notice on their own that the same person surfaced from two different
// sources (e.g. GitHub AND Exa) -- "the recruiter doesn't need to know
// which site he gets the candidates from... all need to be merged before
// showing."
//
// This is the FRONTEND counterpart to source-candidates-free-portals'
// server-side mergeDuplicateCandidates, which only merges duplicates found
// within that one edge function's own four providers. This utility merges
// ACROSS separate edge function calls (free portals + Exa today; anything
// else added later), since each edge function is an isolated Deno module
// with no way to call another synchronously without adding an HTTP hop --
// simplest correct place to combine their outputs is here, once both
// responses have already landed in the page's state.
//
// Same disclosed heuristic and limits as the server-side version: matched
// on normalized full name only (no shared identifier -- email, a common
// profile URL -- exists across GitHub/Stack Exchange/Hugging Face/Kaggle/
// Exa to match on more precisely), so a common name could occasionally
// merge two different people. Richest record wins as the primary displayed
// card; every source is kept in `_all_portals` so the card can still link
// out to each profile.

export type MergeableCandidate = {
  id: string;
  full_name?: string;
  job_title?: string;
  job_company_name?: string;
  location_name?: string;
  linkedin_url?: string | null;
  skills?: string[];
  _source_vendor?: string;
  _portal_url?: string | null;
  _already_saved?: boolean;
  _candidate_id?: number | null;
  _all_portals?: Array<{ vendor: string; url: string | null }>;
};

// Richest-to-thinnest source, used only as a tie-breaker when two merged
// records have an equal number of filled fields. Exa sits second: its
// heuristically-extracted headline/location is real signal but not a
// verified structured field the way GitHub's profile API is.
const SOURCE_RICHNESS_ORDER = [
  "github",
  "exa",
  "stackexchange",
  "huggingface",
  "kaggle",
];

function sourceFamily(sourceVendor: string | undefined): string {
  return (sourceVendor ?? "").split(":")[0];
}

function filledFieldCount(candidate: MergeableCandidate): number {
  return [candidate.job_title, candidate.job_company_name, candidate.location_name].filter(
    (v) => v !== null && v !== undefined && v !== "",
  ).length;
}

function normalizeNameForDedup(name: string | undefined): string | null {
  if (!name) return null;
  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

export function mergeCandidatesAcrossSources<T extends MergeableCandidate>(
  candidateLists: T[][],
): { merged: T[]; mergedAwayCount: number } {
  const all = candidateLists.flat();
  const groups = new Map<string, T[]>();
  const singles: T[] = [];

  for (const candidate of all) {
    const key = normalizeNameForDedup(candidate.full_name);
    if (!key) {
      singles.push(candidate);
      continue;
    }
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const merged: T[] = [...singles];
  let mergedAwayCount = 0;

  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    mergedAwayCount += group.length - 1;

    const sorted = [...group].sort((a, b) => {
      const richnessDiff = filledFieldCount(b) - filledFieldCount(a);
      if (richnessDiff !== 0) return richnessDiff;
      const aIndex = SOURCE_RICHNESS_ORDER.indexOf(sourceFamily(a._source_vendor));
      const bIndex = SOURCE_RICHNESS_ORDER.indexOf(sourceFamily(b._source_vendor));
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    });
    const primary = sorted[0];
    const allSkills = Array.from(new Set(group.flatMap((c) => c.skills ?? [])));
    const allPortals = group.map((c) => ({
      vendor: c._source_vendor ?? "unknown",
      url: c._portal_url ?? null,
    }));
    // Preserve already-saved status if ANY source in the group was already
    // saved -- a candidate saved via one portal is still "already saved"
    // even if the merged card's primary record came from a different one.
    const alreadySaved = group.some((c) => c._already_saved);
    const savedCandidateId = group.find((c) => c._candidate_id)?.[
      "_candidate_id"
    ];

    merged.push({
      ...primary,
      skills: allSkills,
      _all_portals: allPortals,
      _already_saved: alreadySaved,
      _candidate_id: alreadySaved ? savedCandidateId ?? null : primary._candidate_id ?? null,
    });
  }

  return { merged, mergedAwayCount };
}
