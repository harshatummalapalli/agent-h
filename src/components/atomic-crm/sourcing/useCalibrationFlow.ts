import type { CrmDataProvider } from "../providers/types";
import {
  sortCandidatesForDisplay,
  type CalibrationEntryState,
  type ContextualizeResult,
  type PdlCandidate,
  type SourceResult,
} from "./sourcingTypes";

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;
type NotifyFn = (msg: string, opts: { type: string }) => void;

export type CalibrationFlowDeps = {
  dataProvider: CrmDataProvider;
  notify: NotifyFn;
  selectedId: string;
  calibrationReasons: Record<string, string>;
  contextualizeResults: Record<string, ContextualizeResult>;
  setCalibrationLoading: SetState<boolean>;
  setCalibrationStarted: SetState<boolean>;
  setCalibrationCandidates: SetState<PdlCandidate[]>;
  setNotes: SetState<string[]>;
  setTotal: SetState<number>;
  setCalibrationEntryStates: SetState<Record<string, CalibrationEntryState>>;
  setContextualizeStates: SetState<Record<string, "idle" | "loading" | "done">>;
  setContextualizeResults: SetState<Record<string, ContextualizeResult>>;
  setApplyStates: SetState<Record<string, "idle" | "applying" | "applied">>;
  handleRefreshCriteriaImpact: () => Promise<void>;
};

export function createCalibrationFlowHandlers(d: CalibrationFlowDeps) {
  const handleContextualize = async (
    candidate: PdlCandidate,
    reason: string,
  ) => {
    d.setContextualizeStates((prev) => ({
      ...prev,
      [candidate.id]: "loading",
    }));
    try {
      const result = await d.dataProvider.contextualizeCalibrationFeedback(
        Number(d.selectedId),
        reason,
        candidate._match_evidence,
      );
      d.setContextualizeResults((prev) => ({
        ...prev,
        [candidate.id]: result,
      }));
    } catch (error: any) {
      d.notify(
        error?.message ||
          "Failed to check whether this reason implies a search criterion",
        { type: "error" },
      );
    } finally {
      d.setContextualizeStates((prev) => ({ ...prev, [candidate.id]: "done" }));
    }
  };

  const handleStartCalibration = async (provider?: string) => {
    if (!d.selectedId) return;
    d.setCalibrationLoading(true);
    try {
      const data = (await d.dataProvider.sourceCandidates(
        Number(d.selectedId),
        3,
        null,
        false,
        provider,
      )) as SourceResult;
      d.setCalibrationCandidates(
        sortCandidatesForDisplay(
          data.candidates,
          "default",
          true,
          false,
          false,
        ),
      );
      d.setCalibrationStarted(true);
      d.setNotes(data.notes);
      d.setTotal(data.total);
    } catch (error: any) {
      d.notify(error?.message || "Failed to pull candidates to calibrate on", {
        type: "error",
      });
    } finally {
      d.setCalibrationLoading(false);
    }
  };

  const handleSubmitCalibrationJudgment = async (
    candidate: PdlCandidate,
    fit: boolean,
  ) => {
    const reason = (d.calibrationReasons[candidate.id] ?? "").trim();
    if (!reason) {
      d.notify("A reason is required before submitting", { type: "warning" });
      return;
    }
    d.setCalibrationEntryStates((prev) => ({
      ...prev,
      [candidate.id]: "submitting",
    }));
    try {
      await d.dataProvider.submitCalibrationFeedback(
        Number(d.selectedId),
        candidate.id,
        fit,
        reason,
        {
          full_name: candidate.full_name,
          job_title: candidate.job_title,
          job_company_name: candidate.job_company_name,
          location_name: candidate.location_name,
          linkedin_url: candidate.linkedin_url,
          skills: candidate.skills,
          _match_score: candidate._match_score,
        },
      );
      d.setCalibrationEntryStates((prev) => ({
        ...prev,
        [candidate.id]: "submitted",
      }));
      d.notify(fit ? "Marked as a fit" : "Marked as not a fit", {
        type: "success",
      });
      if (!fit) void handleContextualize(candidate, reason);
    } catch (error: any) {
      d.setCalibrationEntryStates((prev) => ({
        ...prev,
        [candidate.id]: "idle",
      }));
      d.notify(error?.message || "Failed to save judgment", { type: "error" });
    }
  };

  const handleApplyCriterion = async (candidateId: string) => {
    const result = d.contextualizeResults[candidateId];
    if (!result?.criterion) return;
    d.setApplyStates((prev) => ({ ...prev, [candidateId]: "applying" }));
    try {
      await d.dataProvider.applyLearnedCriterion(
        Number(d.selectedId),
        result.criterion,
      );
      d.setApplyStates((prev) => ({ ...prev, [candidateId]: "applied" }));
      d.notify("Criterion applied to future searches for this role", {
        type: "success",
      });
      void d.handleRefreshCriteriaImpact();
    } catch (error: any) {
      d.setApplyStates((prev) => ({ ...prev, [candidateId]: "idle" }));
      d.notify(error?.message || "Failed to apply criterion", {
        type: "error",
      });
    }
  };

  return {
    handleStartCalibration,
    handleSubmitCalibrationJudgment,
    handleApplyCriterion,
  };
}
