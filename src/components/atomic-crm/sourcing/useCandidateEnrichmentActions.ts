import type { CrmDataProvider } from "../providers/types";
import {
  ACTION_LABELS,
  FIT_BUCKET_LABELS,
  type ContactEnrichResult,
  type DevSignalEnrichResult,
  type FitAssessmentResult,
  type FullProfileData,
  type FullProfileEnrichResult,
  type PdlCandidate,
  type ScoreResult,
} from "./sourcingTypes";

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;
type NotifyFn = (msg: string, opts: { type: string }) => void;

export type EnrichmentActionsDeps = {
  dataProvider: CrmDataProvider;
  notify: NotifyFn;
  selectedId: string;
  candidateDbIds: Record<string, number>;
  fullProfileData: Record<string, FullProfileData>;
  setContactEnrichStates: SetState<Record<string, any>>;
  setContactEnrichResults: SetState<Record<string, ContactEnrichResult>>;
  setDevSignalEnrichStates: SetState<Record<string, any>>;
  setDevSignalEnrichResults: SetState<Record<string, DevSignalEnrichResult>>;
  setFullProfileStates: SetState<Record<string, any>>;
  setFullProfileData: SetState<Record<string, FullProfileData>>;
  setFullProfileExpanded: SetState<Record<string, boolean>>;
  setScoreStates: SetState<Record<string, any>>;
  setScoreResults: SetState<Record<string, ScoreResult>>;
  setFitStates: SetState<Record<string, any>>;
  setFitResults: SetState<Record<string, FitAssessmentResult>>;
};

export function createEnrichmentActionHandlers(d: EnrichmentActionsDeps) {
  const handleEnrichContact = async (candidate: PdlCandidate) => {
    const candidateId = d.candidateDbIds[candidate.id];
    if (!candidateId) return;
    d.setContactEnrichStates((prev) => ({
      ...prev,
      [candidate.id]: "loading",
    }));
    try {
      const result = (await d.dataProvider.enrichCandidateContact(
        candidateId,
      )) as ContactEnrichResult;
      d.setContactEnrichResults((prev) => ({
        ...prev,
        [candidate.id]: result,
      }));
      d.setContactEnrichStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      d.notify(
        result.status === "enriched"
          ? `Contact found via ${result.source}`
          : result.status === "not_found"
            ? "No contact info found"
            : "Contact enrichment failed -- see notes",
        { type: result.status === "enriched" ? "success" : "warning" },
      );
    } catch (error: any) {
      d.setContactEnrichStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      d.notify(error?.message || "Failed to enrich contact", { type: "error" });
    }
  };

  const handleEnrichDevSignals = async (candidate: PdlCandidate) => {
    const candidateId = d.candidateDbIds[candidate.id];
    if (!candidateId) return;
    d.setDevSignalEnrichStates((prev) => ({
      ...prev,
      [candidate.id]: "loading",
    }));
    try {
      const result = (await d.dataProvider.enrichCandidateDevSignals(
        candidateId,
      )) as DevSignalEnrichResult;
      d.setDevSignalEnrichResults((prev) => ({
        ...prev,
        [candidate.id]: result,
      }));
      d.setDevSignalEnrichStates((prev) => ({
        ...prev,
        [candidate.id]: "done",
      }));
      d.notify(
        result.status === "enriched"
          ? "Dev signal(s) found"
          : result.status === "not_found"
            ? "No confident dev-signal match found"
            : "Dev-signal enrichment failed -- see notes",
        { type: result.status === "enriched" ? "success" : "warning" },
      );
    } catch (error: any) {
      d.setDevSignalEnrichStates((prev) => ({
        ...prev,
        [candidate.id]: "idle",
      }));
      d.notify(error?.message || "Failed to enrich dev signals", {
        type: "error",
      });
    }
  };

  const handleViewFullProfile = async (candidate: PdlCandidate) => {
    const candidateId = d.candidateDbIds[candidate.id];
    if (!candidateId) return;
    const alreadyHaveData = d.fullProfileData[candidate.id];
    if (alreadyHaveData) {
      d.setFullProfileExpanded((prev) => ({
        ...prev,
        [candidate.id]: !prev[candidate.id],
      }));
      return;
    }
    d.setFullProfileStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const enrichResult = (await d.dataProvider.enrichCandidateWorkHistory(
        candidateId,
      )) as FullProfileEnrichResult;
      const profile = (await d.dataProvider.getCandidateFullProfile(
        candidateId,
      )) as FullProfileData;
      d.setFullProfileData((prev) => ({ ...prev, [candidate.id]: profile }));
      d.setFullProfileStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      d.setFullProfileExpanded((prev) => ({ ...prev, [candidate.id]: true }));
      d.notify(
        enrichResult.status === "enriched"
          ? `Full profile loaded via ${enrichResult.source} (${enrichResult.experience_count} jobs, ${enrichResult.education_count} education)`
          : enrichResult.status === "not_found"
            ? "No full profile found for this candidate"
            : "Full profile lookup failed -- see notes",
        { type: enrichResult.status === "enriched" ? "success" : "warning" },
      );
    } catch (error: any) {
      d.setFullProfileStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      d.notify(error?.message || "Failed to load full profile", {
        type: "error",
      });
    }
  };

  const handleScoreCandidate = async (candidate: PdlCandidate) => {
    const candidateId = d.candidateDbIds[candidate.id];
    if (!candidateId || !d.selectedId) return;
    d.setScoreStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = (await d.dataProvider.scoreCandidate(
        candidateId,
        Number(d.selectedId),
      )) as ScoreResult;
      d.setScoreResults((prev) => ({ ...prev, [candidate.id]: result }));
      d.setScoreStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      d.notify(
        `${result.verdict} (${result.overall_score}/100) -- recommended: ${ACTION_LABELS[result.recommended_action]}`,
        {
          type: result.recommended_action === "reject" ? "warning" : "success",
        },
      );
    } catch (error: any) {
      d.setScoreStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      d.notify(error?.message || "Failed to score candidate", {
        type: "error",
      });
    }
  };

  const handleAssessFit = async (candidate: PdlCandidate) => {
    const candidateId = d.candidateDbIds[candidate.id];
    if (!candidateId || !d.selectedId) return;
    d.setFitStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = (await d.dataProvider.assessCandidateFit(
        candidateId,
        Number(d.selectedId),
      )) as FitAssessmentResult;
      d.setFitResults((prev) => ({ ...prev, [candidate.id]: result }));
      d.setFitStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      d.notify(FIT_BUCKET_LABELS[result.fit_bucket], {
        type: result.fit_bucket === "not_a_fit" ? "warning" : "success",
      });
    } catch (error: any) {
      d.setFitStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      d.notify(error?.message || "Failed to assess candidate fit", {
        type: "error",
      });
    }
  };

  return {
    handleEnrichContact,
    handleEnrichDevSignals,
    handleViewFullProfile,
    handleScoreCandidate,
    handleAssessFit,
  };
}
