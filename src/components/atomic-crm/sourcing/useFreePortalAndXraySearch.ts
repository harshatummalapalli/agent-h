import type { CrmDataProvider } from "../providers/types";
import { mergeCandidatesAcrossSources } from "./mergeCandidates";
import type {
  ExaResult,
  FreePortalResult,
  PdlCandidate,
} from "./sourcingTypes";

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;
type NotifyFn = (msg: string, opts: { type: string }) => void;

export type FreePortalSearchDeps = {
  dataProvider: CrmDataProvider;
  notify: NotifyFn;
  selectedId: string;
  freePortalCandidates: PdlCandidate[];
  freePortalNotes: string[];
  setFreePortalLoading: SetState<boolean>;
  setFreePortalCandidates: SetState<PdlCandidate[]>;
  setFreePortalNotes: SetState<string[]>;
  setFreePortalSearched: SetState<boolean>;
  setXrayLoading: SetState<boolean>;
  setCandidateDbIds: SetState<Record<string, number>>;
};

// Free-portal sourcing is permanently retired (product decision; Crustdata is the
// sole sourcing vendor). Keep false — not a temporary flag.
const FREE_PORTALS_ENABLED = false;

export function createFreePortalAndXrayHandlers(d: FreePortalSearchDeps) {
  const handleSearchFreePortals = async () => {
    if (!FREE_PORTALS_ENABLED) {
      d.notify("Free portal sourcing is not available.", {
        type: "info",
      });
      return;
    }
    if (!d.selectedId) return;
    d.setFreePortalLoading(true);
    try {
      const [freePortalOutcome, exaOutcome] = await Promise.allSettled([
        d.dataProvider.sourceFreePortalCandidates(
          Number(d.selectedId),
          10,
        ) as Promise<FreePortalResult>,
        d.dataProvider.sourceExaCandidates(
          Number(d.selectedId),
          10,
        ) as Promise<ExaResult>,
      ]);
      const freePortalCandidatesRaw =
        freePortalOutcome.status === "fulfilled"
          ? (freePortalOutcome.value.candidates ?? [])
          : [];
      const exaCandidatesRaw =
        exaOutcome.status === "fulfilled"
          ? (exaOutcome.value.candidates ?? [])
          : [];
      const combinedNotes: string[] = [];
      if (freePortalOutcome.status === "fulfilled") {
        combinedNotes.push(...(freePortalOutcome.value.notes ?? []));
      } else {
        combinedNotes.push(
          `Free portals: search failed this time (non-fatal). ${(freePortalOutcome as any).reason?.message ?? ""}`,
        );
      }
      if (exaOutcome.status === "fulfilled") {
        combinedNotes.push(...(exaOutcome.value.notes ?? []));
      } else {
        combinedNotes.push(
          `Exa: search failed this time (non-fatal). ${(exaOutcome as any).reason?.message ?? ""}`,
        );
      }
      const { merged, mergedAwayCount } =
        mergeCandidatesAcrossSources<PdlCandidate>([
          freePortalCandidatesRaw,
          exaCandidatesRaw,
        ]);
      if (mergedAwayCount > 0) {
        combinedNotes.push(
          `${mergedAwayCount} candidate(s) appeared in more than one source and were merged.`,
        );
      }
      d.setFreePortalCandidates(merged);
      d.setFreePortalNotes(combinedNotes);
      d.setFreePortalSearched(true);
      const seededDbIds: Record<string, number> = {};
      merged.forEach((c) => {
        if (c._already_saved && c._candidate_id)
          seededDbIds[c.id] = c._candidate_id;
      });
      d.setCandidateDbIds((prev) => ({ ...prev, ...seededDbIds }));
    } catch (error: any) {
      d.notify(error?.message || "Failed to search free & low-cost portals", {
        type: "error",
      });
    } finally {
      d.setFreePortalLoading(false);
    }
  };

  const handleSearchXray = async () => {
    if (!d.selectedId) return;
    d.setXrayLoading(true);
    try {
      const result = (await d.dataProvider.sourceXrayCandidates(
        Number(d.selectedId),
      )) as FreePortalResult;
      const combinedNotes = [...d.freePortalNotes, ...(result.notes ?? [])];
      const { merged, mergedAwayCount } =
        mergeCandidatesAcrossSources<PdlCandidate>([
          d.freePortalCandidates,
          result.candidates ?? [],
        ]);
      if (mergedAwayCount > 0) {
        combinedNotes.push(
          `${mergedAwayCount} candidate(s) from X-ray merged with existing results.`,
        );
      }
      d.setFreePortalCandidates(merged);
      d.setFreePortalNotes(combinedNotes);
      d.setFreePortalSearched(true);
      const seededDbIds: Record<string, number> = {};
      merged.forEach((c) => {
        if (c._already_saved && c._candidate_id)
          seededDbIds[c.id] = c._candidate_id;
      });
      d.setCandidateDbIds((prev) => ({ ...prev, ...seededDbIds }));
    } catch (error: any) {
      d.notify(error?.message || "Failed to run X-ray search", {
        type: "error",
      });
    } finally {
      d.setXrayLoading(false);
    }
  };

  return { handleSearchFreePortals, handleSearchXray };
}
