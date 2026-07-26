import { useEffect, useRef, useState } from "react";
import { useDataProvider, useNotify } from "ra-core";
import type { CrmDataProvider } from "../providers/types";
import {
  loadSourcingSnapshot,
  saveSourcingSnapshot,
} from "./sourcingSessionSnapshot";
import { createDiscoverySearchHandlers } from "./useDiscoverySearch";
import { createFreePortalAndXrayHandlers } from "./useFreePortalAndXraySearch";
import { createCalibrationFlowHandlers } from "./useCalibrationFlow";
import { createEnrichmentActionHandlers } from "./useCandidateEnrichmentActions";
import { createOutreachActionHandlers } from "./useOutreachActions";
import { createInterviewResumeOfferHandlers } from "./useInterviewResumeOfferActions";

import {
  sortCandidatesForDisplay,
  type CandidateSortField,
  type CalibrationEntryState,
  type CriteriaImpact,
  type ContextualizeResult,
  type ContactEnrichResult,
  type DevSignalEnrichResult,
  type EmailPreview,
  type EnrichState,
  type FitAssessmentResult,
  type FullProfileData,
  type InterviewResult,
  type MustHaveCheck,
  type OfferDraft,
  type OfferInfo,
  type OutreachPrepared,
  type PdlCandidate,
  type ResumeInfo,
  type RoleBriefDetail,
  type RoleBriefOption,
  type SaveState,
  type ScoreResult,
  type Stage,
} from "./sourcingTypes";

interface UseCandidateSourcingParams {
  initialRoleBriefId?: string;
  resetPagination: () => void;
  onCandidateSaved?: (candidateId: number, name: string) => void;
}

export function useCandidateSourcing({
  initialRoleBriefId,
  resetPagination,
  onCandidateSaved,
}: UseCandidateSourcingParams) {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();

  const controlPanelRef = useRef<HTMLDivElement | null>(null);
  const steeringInputRef = useRef<HTMLInputElement | null>(null);

  const [roleBriefs, setRoleBriefs] = useState<RoleBriefOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [size, setSize] = useState(100);

  const [stage, setStage] = useState<Stage>("idle");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [wideningLoading, setWideningLoading] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkPreparing, setBulkPreparing] = useState(false);
  const [_bulkQueue, setBulkQueue] = useState<
    Array<{ candidateKey: string; prepared: OutreachPrepared }>
  >([]);
  const [_bulkQueueIdx, setBulkQueueIdx] = useState(0);
  const [restoreLoading, setRestoreLoading] = useState(false);

  const [roleBriefTitle, setRoleBriefTitle] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [totalMatchesAll, setTotalMatchesAll] = useState<number | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<PdlCandidate[]>([]);
  const [sortField, setSortField] = useState<CandidateSortField>("default");
  const [sortByMatchEvidence, setSortByMatchEvidence] = useState(false);
  const [sortByYearsExperience, setSortByYearsExperience] = useState(false);
  const [sortByCompanySize, setSortByCompanySize] = useState(false);
  const [scrollToken, setScrollToken] = useState<string | null>(null);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [candidateDbIds, setCandidateDbIds] = useState<Record<string, number>>(
    {},
  );

  const [contactEnrichStates, setContactEnrichStates] = useState<
    Record<string, EnrichState>
  >({});
  const [contactEnrichResults, setContactEnrichResults] = useState<
    Record<string, ContactEnrichResult>
  >({});
  const [devSignalEnrichStates, setDevSignalEnrichStates] = useState<
    Record<string, EnrichState>
  >({});
  const [devSignalEnrichResults, setDevSignalEnrichResults] = useState<
    Record<string, DevSignalEnrichResult>
  >({});
  const [fullProfileStates, setFullProfileStates] = useState<
    Record<string, EnrichState>
  >({});
  const [fullProfileData, setFullProfileData] = useState<
    Record<string, FullProfileData>
  >({});
  const [fullProfileExpanded, setFullProfileExpanded] = useState<
    Record<string, boolean>
  >({});
  const [scoreStates, setScoreStates] = useState<Record<string, EnrichState>>(
    {},
  );
  const [evidenceExpanded, setEvidenceExpanded] = useState<
    Record<string, boolean>
  >({});
  const [evidenceStates, setEvidenceStates] = useState<
    Record<string, EnrichState>
  >({});
  const [evidenceResults, setEvidenceResults] = useState<
    Record<string, MustHaveCheck[]>
  >({});
  const [scoreResults, setScoreResults] = useState<Record<string, ScoreResult>>(
    {},
  );
  const [fitStates, setFitStates] = useState<Record<string, EnrichState>>({});
  const [fitResults, setFitResults] = useState<
    Record<string, FitAssessmentResult>
  >({});
  const [interviewStates, setInterviewStates] = useState<
    Record<string, EnrichState>
  >({});
  const [interviewResults, setInterviewResults] = useState<
    Record<string, InterviewResult>
  >({});
  const [resumeStates, setResumeStates] = useState<Record<string, EnrichState>>(
    {},
  );
  const [resumeInfos, setResumeInfos] = useState<Record<string, ResumeInfo>>(
    {},
  );
  const [resumeEmailPreviews, setResumeEmailPreviews] = useState<
    Record<string, EmailPreview>
  >({});
  const [resumeSendStates, setResumeSendStates] = useState<
    Record<string, EnrichState>
  >({});
  const [outreachStates, setOutreachStates] = useState<
    Record<string, EnrichState>
  >({});
  const [outreachSendStates, setOutreachSendStates] = useState<
    Record<string, EnrichState>
  >({});
  const [outreachPrepared, setOutreachPrepared] = useState<
    Record<string, OutreachPrepared>
  >({});
  const [offerStates, setOfferStates] = useState<Record<string, EnrichState>>(
    {},
  );
  const [offerInfos, setOfferInfos] = useState<Record<string, OfferInfo>>({});
  const [offerFormOpen, setOfferFormOpen] = useState<Record<string, boolean>>(
    {},
  );
  const [offerDrafts, setOfferDrafts] = useState<Record<string, OfferDraft>>(
    {},
  );
  const [offerEmailPreviews, setOfferEmailPreviews] = useState<
    Record<string, EmailPreview>
  >({});
  const [offerSendStates, setOfferSendStates] = useState<
    Record<string, EnrichState>
  >({});
  const [bookingPrepared, setBookingPrepared] = useState<
    Record<
      string,
      { booking_link_url: string; email_preview: EmailPreview | null }
    >
  >({});
  const [bookingSendStates, setBookingSendStates] = useState<
    Record<string, EnrichState>
  >({});

  const [calibrationLoading, setCalibrationLoading] = useState(false);
  const [calibrationStarted, setCalibrationStarted] = useState(false);
  const [calibrationCandidates, setCalibrationCandidates] = useState<
    PdlCandidate[]
  >([]);
  const [calibrationReasons, setCalibrationReasons] = useState<
    Record<string, string>
  >({});
  const [calibrationEntryStates, setCalibrationEntryStates] = useState<
    Record<string, CalibrationEntryState>
  >({});
  const [existingCalibrationFeedback, setExistingCalibrationFeedback] =
    useState<Array<{ source_id: string; fit: boolean }>>([]);

  const [contextualizeStates, setContextualizeStates] = useState<
    Record<string, "idle" | "loading" | "done">
  >({});
  const [contextualizeResults, setContextualizeResults] = useState<
    Record<string, ContextualizeResult>
  >({});
  const [applyStates, setApplyStates] = useState<
    Record<string, "idle" | "applying" | "applied">
  >({});

  const [steeringText, setSteeringText] = useState("");
  const [steeringState, setSteeringState] = useState<
    "idle" | "loading" | "done"
  >("idle");
  const [steeringResult, setSteeringResult] =
    useState<ContextualizeResult | null>(null);
  const [steeringApplyState, setSteeringApplyState] = useState<
    "idle" | "applying" | "applied"
  >("idle");

  const [criteriaImpact, setCriteriaImpact] = useState<CriteriaImpact | null>(
    null,
  );
  const [criteriaImpactLoading, setCriteriaImpactLoading] = useState(false);
  const [criteriaActionStates, setCriteriaActionStates] = useState<
    Record<number, "idle" | "working">
  >({});

  const [roleBriefDetail, setRoleBriefDetail] =
    useState<RoleBriefDetail | null>(null);

  const [freePortalLoading, setFreePortalLoading] = useState(false);
  const [freePortalCandidates, setFreePortalCandidates] = useState<
    PdlCandidate[]
  >([]);
  const [freePortalNotes, setFreePortalNotes] = useState<string[]>([]);
  const [freePortalSearched, setFreePortalSearched] = useState(false);
  const [xrayLoading, setXrayLoading] = useState(false);
  const [nlText, setNlText] = useState("");
  const [nlParsing, setNlParsing] = useState(false);

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  const resetSearchUiState = () => {
    setStage("idle");
    setTotal(0);
    setNotes([]);
    setCandidates([]);
    setScrollToken(null);
    setSaveStates({});
    setCandidateDbIds({});
    setContactEnrichStates({});
    setContactEnrichResults({});
    setDevSignalEnrichStates({});
    setDevSignalEnrichResults({});
    setFullProfileStates({});
    setFullProfileData({});
    setFullProfileExpanded({});
    setScoreStates({});
    setScoreResults({});
    setEvidenceStates({});
    setEvidenceResults({});
    setEvidenceExpanded({});
    setFitStates({});
    setFitResults({});
    setCalibrationLoading(false);
    setCalibrationStarted(false);
    setCalibrationCandidates([]);
    setCalibrationReasons({});
    setCalibrationEntryStates({});
    setExistingCalibrationFeedback([]);
    setContextualizeStates({});
    setContextualizeResults({});
    setApplyStates({});
    setCriteriaImpact(null);
    setCriteriaActionStates({});
    setRoleBriefDetail(null);
  };

  const loadRoleBriefContext = (value: string) => {
    if (!value) return;
    dataProvider
      .getCalibrationFeedback(Number(value))
      .then((rows) =>
        setExistingCalibrationFeedback(
          (rows as any[]).map((r) => ({ source_id: r.source_id, fit: r.fit })),
        ),
      )
      .catch(() => {});

    dataProvider
      .getOne("deals", { id: Number(value) })
      .then(({ data }) =>
        setRoleBriefDetail(data as unknown as RoleBriefDetail),
      )
      .catch(() => {});
  };

  const applySourcingSnapshot = (
    snapshot: ReturnType<typeof loadSourcingSnapshot> & object,
    source: "session" | "server",
    silent = false,
  ) => {
    setSelectedId((snapshot as any).dealId);
    setStage((snapshot as any).stage);
    setCandidates((snapshot as any).candidates as PdlCandidate[]);
    setScrollToken((snapshot as any).scrollToken);
    setTotal((snapshot as any).total);
    setTotalMatchesAll((snapshot as any).totalMatchesAll);
    setNotes((snapshot as any).notes);
    setSaveStates((snapshot as any).saveStates as Record<string, SaveState>);
    setCandidateDbIds((snapshot as any).candidateDbIds);
    setEvidenceExpanded(
      Object.fromEntries(
        ((snapshot as any).candidates as PdlCandidate[]).map((c) => [
          c.id,
          true,
        ]),
      ),
    );
    loadRoleBriefContext((snapshot as any).dealId);
    if (!silent) {
      notify(
        source === "session"
          ? `Restored ${(snapshot as any).candidates.length} candidate(s) from this browser session (no new search credits).`
          : `Restored ${(snapshot as any).candidates.length} candidate(s) from your last search on this role.`,
        { type: "success" },
      );
    }
  };

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  useEffect(() => {
    dataProvider
      .getList("deals", {
        pagination: { page: 1, perPage: 100 },
        sort: { field: "id", order: "DESC" },
        filter: {},
      })
      .then(({ data }) => {
        setRoleBriefs((data as any[]).map((d) => ({ id: d.id, name: d.name })));
      })
      .catch(() => {
        notify("Failed to load role briefs", { type: "error" });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setCandidates((prev) =>
      prev.length > 0
        ? sortCandidatesForDisplay(
            prev,
            sortField,
            sortByMatchEvidence,
            sortByYearsExperience,
            sortByCompanySize,
          )
        : prev,
    );
  }, [
    sortField,
    sortByMatchEvidence,
    sortByYearsExperience,
    sortByCompanySize,
  ]);

  useEffect(() => {
    if (!selectedId || stage !== "fetched" || candidates.length === 0) return;
    saveSourcingSnapshot({
      version: 1,
      savedAt: new Date().toISOString(),
      dealId: selectedId,
      stage,
      candidates,
      scrollToken,
      total,
      totalMatchesAll,
      notes,
      saveStates,
      candidateDbIds,
    });
  }, [
    selectedId,
    stage,
    candidates,
    scrollToken,
    total,
    totalMatchesAll,
    notes,
    saveStates,
    candidateDbIds,
  ]);

  useEffect(() => {
    if (!initialRoleBriefId) return;
    const snapshot = loadSourcingSnapshot(initialRoleBriefId);
    if (snapshot?.candidates?.length) {
      // silent=true: auto-restore on mount should not show a toast every time
      // the tab remounts. Toast only fires on explicit "Restore last search" click.
      applySourcingSnapshot(snapshot as any, "session", true);
    } else {
      setSelectedId(initialRoleBriefId);
      loadRoleBriefContext(initialRoleBriefId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoleBriefId]);

  // -------------------------------------------------------------------------
  // Handler factories — each factory receives current state/setters as deps
  // -------------------------------------------------------------------------

  // RA's notify type uses `NotificationType` (a union) but all handler factories
  // declare a looser `string` type for the opts.type field — cast to align them.
  const notifyLoose = notify as (msg: string, opts: { type: string }) => void;

  const discoveryHandlers = createDiscoverySearchHandlers({
    dataProvider,
    notify: notifyLoose,
    selectedId,
    size,
    sortField,
    sortByMatchEvidence,
    sortByYearsExperience,
    sortByCompanySize,
    scrollToken,
    total,
    nlText,
    steeringText,
    steeringResult,
    candidateDbIds,
    setSelectedId,
    resetPagination,
    setStage,
    setCandidates,
    setScrollToken,
    setTotal,
    setTotalMatchesAll,
    setNotes,
    setSaveStates,
    setCandidateDbIds,
    setPreviewLoading,
    setFetchLoading,
    setWideningLoading,
    setRestoreLoading,
    setRoleBriefTitle,
    setNlText,
    setNlParsing,
    setRoleBriefs,
    setEvidenceExpanded,
    setEvidenceStates,
    setEvidenceResults,
    setCalibrationLoading,
    setCalibrationStarted,
    setCalibrationCandidates,
    setCriteriaImpact,
    setCriteriaImpactLoading,
    setCriteriaActionStates,
    setSteeringText,
    setSteeringState,
    setSteeringResult,
    setSteeringApplyState,
    setRoleBriefDetail,
    roleBriefDetail,
    resetSearchUiState,
    loadRoleBriefContext,
    applySourcingSnapshot,
  });

  const freePortalHandlers = createFreePortalAndXrayHandlers({
    dataProvider,
    notify: notifyLoose,
    selectedId,
    freePortalCandidates,
    freePortalNotes,
    setFreePortalLoading,
    setFreePortalCandidates,
    setFreePortalNotes,
    setFreePortalSearched,
    setXrayLoading,
    setCandidateDbIds,
  });

  const calibrationHandlers = createCalibrationFlowHandlers({
    dataProvider,
    notify: notifyLoose,
    selectedId,
    calibrationReasons,
    contextualizeResults,
    setCalibrationLoading,
    setCalibrationStarted,
    setCalibrationCandidates,
    setNotes,
    setTotal,
    setCalibrationEntryStates,
    setContextualizeStates,
    setContextualizeResults,
    setApplyStates,
    handleRefreshCriteriaImpact: discoveryHandlers.handleRefreshCriteriaImpact,
  });

  const enrichmentHandlers = createEnrichmentActionHandlers({
    dataProvider,
    notify: notifyLoose,
    selectedId,
    candidateDbIds,
    fullProfileData,
    setContactEnrichStates,
    setContactEnrichResults,
    setDevSignalEnrichStates,
    setDevSignalEnrichResults,
    setFullProfileStates,
    setFullProfileData,
    setFullProfileExpanded,
    setScoreStates,
    setScoreResults,
    setFitStates,
    setFitResults,
  });

  const outreachHandlers = createOutreachActionHandlers({
    dataProvider,
    notify: notifyLoose,
    selectedId,
    candidates,
    bulkSelected,
    candidateDbIds,
    outreachPrepared,
    onCandidateSaved,
    setOutreachStates,
    setOutreachPrepared,
    setOutreachSendStates,
    setSaveStates,
    setCandidateDbIds,
    setBulkPreparing,
    setBulkQueue,
    setBulkQueueIdx,
    setBulkSelected,
  });

  const interviewResumeOfferHandlers = createInterviewResumeOfferHandlers({
    dataProvider,
    notify: notifyLoose,
    selectedId,
    candidateDbIds,
    bookingPrepared,
    resumeEmailPreviews,
    resumeInfos,
    offerDrafts,
    offerEmailPreviews,
    offerInfos,
    setInterviewStates,
    setInterviewResults,
    setBookingPrepared,
    setBookingSendStates,
    setResumeStates,
    setResumeEmailPreviews,
    setResumeInfos,
    setResumeSendStates,
    setOfferStates,
    setOfferInfos,
    setOfferFormOpen,
    setOfferDrafts,
    setOfferEmailPreviews,
    setOfferSendStates,
  });

  const canSearchWider = Boolean(scrollToken) && candidates.length < total;

  return {
    // Refs
    controlPanelRef,
    steeringInputRef,
    // Core state
    roleBriefs,
    selectedId,
    size,
    setSize,
    stage,
    previewLoading,
    fetchLoading,
    wideningLoading,
    bulkSelected,
    setBulkSelected,
    bulkPreparing,
    restoreLoading,
    roleBriefTitle,
    total,
    totalMatchesAll,
    notes,
    candidates,
    sortField,
    setSortField,
    sortByMatchEvidence,
    setSortByMatchEvidence,
    sortByYearsExperience,
    setSortByYearsExperience,
    sortByCompanySize,
    setSortByCompanySize,
    scrollToken,
    saveStates,
    setSaveStates,
    candidateDbIds,
    setCandidateDbIds,
    // Enrich state
    contactEnrichStates,
    contactEnrichResults,
    devSignalEnrichStates,
    devSignalEnrichResults,
    fullProfileStates,
    fullProfileData,
    fullProfileExpanded,
    scoreStates,
    evidenceExpanded,
    setEvidenceExpanded,
    evidenceStates,
    evidenceResults,
    scoreResults,
    fitStates,
    fitResults,
    interviewStates,
    interviewResults,
    resumeStates,
    resumeInfos,
    resumeEmailPreviews,
    setResumeEmailPreviews,
    resumeSendStates,
    outreachStates,
    outreachSendStates,
    outreachPrepared,
    setOutreachPrepared,
    offerStates,
    offerInfos,
    offerFormOpen,
    offerDrafts,
    offerEmailPreviews,
    setOfferEmailPreviews,
    offerSendStates,
    bookingPrepared,
    setBookingPrepared,
    bookingSendStates,
    // Calibration state
    calibrationLoading,
    calibrationStarted,
    calibrationCandidates,
    calibrationReasons,
    setCalibrationReasons,
    calibrationEntryStates,
    existingCalibrationFeedback,
    contextualizeStates,
    contextualizeResults,
    applyStates,
    // Steering state
    steeringText,
    setSteeringText,
    steeringState,
    steeringResult,
    steeringApplyState,
    // Criteria impact
    criteriaImpact,
    criteriaImpactLoading,
    criteriaActionStates,
    // Role brief
    roleBriefDetail,
    // Free portal / x-ray
    freePortalLoading,
    freePortalCandidates,
    freePortalNotes,
    freePortalSearched,
    xrayLoading,
    nlText,
    setNlText,
    nlParsing,
    // Computed
    canSearchWider,
    // Discovery handlers
    ...discoveryHandlers,
    // Free portal handlers
    ...freePortalHandlers,
    // Calibration handlers
    ...calibrationHandlers,
    // Enrichment handlers
    ...enrichmentHandlers,
    // Outreach handlers
    ...outreachHandlers,
    // Interview / resume / offer handlers
    ...interviewResumeOfferHandlers,
    // Alias (was handlePrepareResumeRequest in original)
    handleRequestResume:
      interviewResumeOfferHandlers.handlePrepareResumeRequest,
  };
}
