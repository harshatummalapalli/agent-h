import { useDataProvider, useNotify } from "ra-core";
import type { CrmDataProvider } from "../providers/types";
import type { PdlCandidate, SaveState } from "./sourcingTypes";
import type React from "react";

interface UseAddToPipelineParams {
  selectedId: string;
  candidateDbIds: Record<string, number>;
  setCandidateDbIds: React.Dispatch<
    React.SetStateAction<Record<string, number>>
  >;
  setSaveStates: React.Dispatch<
    React.SetStateAction<Record<string, SaveState>>
  >;
  onCandidateSaved?: (candidateId: number, name: string) => void;
}

export function useAddToPipeline({
  selectedId,
  candidateDbIds,
  setCandidateDbIds,
  setSaveStates,
  onCandidateSaved,
}: UseAddToPipelineParams) {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();

  const handleAddToPipeline = async (candidate: PdlCandidate) => {
    if (!selectedId) return;
    setSaveStates((prev) => ({ ...prev, [candidate.id]: "saving" }));
    try {
      const outcome = await dataProvider.saveSourcedCandidate(
        Number(selectedId),
        candidate,
      );
      setSaveStates((prev) => ({ ...prev, [candidate.id]: "saved" }));
      if (outcome.candidate_id) {
        setCandidateDbIds((prev) => ({
          ...prev,
          [candidate.id]: outcome.candidate_id,
        }));
      }
      notify(
        outcome.status === "created"
          ? "Added to pipeline"
          : "Already in your candidates -- linked to this role",
        { type: "success" },
      );
      if (outcome.candidate_id && onCandidateSaved) {
        const name =
          [candidate.full_name].filter(Boolean).join(" ") ||
          `Candidate #${outcome.candidate_id}`;
        onCandidateSaved(outcome.candidate_id, name);
      }
    } catch (error: any) {
      setSaveStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to add candidate", { type: "error" });
    }
  };

  const isAlreadySaved = (candidateVendorId: string) =>
    Boolean(candidateDbIds[candidateVendorId]);

  return { handleAddToPipeline, isAlreadySaved };
}
