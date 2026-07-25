// Persists in-progress discovery results per role brief so a page refresh
// on /roles/:id does not wipe fetched candidates (they were never saved to
// the DB until "Add to pipeline").

export type SourcingStage = "idle" | "previewed" | "fetched";

/** Minimal candidate shape needed to re-render search result cards. */
export type SnapshotCandidate = {
  id: string;
  full_name?: string;
  job_title?: string;
  job_company_name?: string;
  location_name?: string;
  linkedin_url?: string;
  emails?: { address: string; type?: string }[];
  skills?: string[];
  _already_saved?: boolean;
  _candidate_id?: number | null;
  _match_score?: number | null;
  _source_vendor?: string;
  _portal_url?: string | null;
  _match_evidence?: string | null;
  years_experience?: number | null;
  company_size?: number | null;
  _all_portals?: Array<{ vendor: string; url: string | null }>;
};

export type SourcingSessionSnapshot = {
  version: 1;
  savedAt: string;
  dealId: string;
  stage: SourcingStage;
  candidates: SnapshotCandidate[];
  scrollToken: string | null;
  total: number;
  totalMatchesAll: number | null;
  notes: string[];
  saveStates: Record<string, string>;
  candidateDbIds: Record<string, number>;
};

const STORAGE_PREFIX = "agent_h_sourcing_snapshot_";

function storageKey(dealId: string) {
  return `${STORAGE_PREFIX}${dealId}`;
}

export function loadSourcingSnapshot(
  dealId: string,
): SourcingSessionSnapshot | null {
  if (typeof sessionStorage === "undefined" || !dealId) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(dealId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SourcingSessionSnapshot;
    if (parsed?.version !== 1 || parsed.dealId !== dealId) return null;
    if (!Array.isArray(parsed.candidates)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSourcingSnapshot(snapshot: SourcingSessionSnapshot): void {
  if (typeof sessionStorage === "undefined" || !snapshot.dealId) return;
  try {
    sessionStorage.setItem(
      storageKey(snapshot.dealId),
      JSON.stringify(snapshot),
    );
  } catch {
    // Quota exceeded or private mode — non-fatal.
  }
}

export function clearSourcingSnapshot(dealId: string): void {
  if (typeof sessionStorage === "undefined" || !dealId) return;
  try {
    sessionStorage.removeItem(storageKey(dealId));
  } catch {
    // ignore
  }
}
