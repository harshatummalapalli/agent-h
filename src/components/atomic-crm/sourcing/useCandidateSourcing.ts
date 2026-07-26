import { useEffect, useRef, useState } from "react";
import { useDataProvider, useNotify } from "ra-core";
import type { CrmDataProvider } from "../providers/types";
import {
  loadSourcingSnapshot,
  saveSourcingSnapshot,
} from "./sourcingSessionSnapshot";
import { mergeCandidatesAcrossSources } from "./mergeCandidates";

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
  type ExaResult,
  type FitAssessmentResult,
  type FreePortalResult,
  type FullProfileData,
  type FullProfileEnrichResult,
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
  type SourceResult,
  type Stage,
  ACTION_LABELS,
  EMPTY_OFFER_DRAFT,
  FIT_BUCKET_LABELS,
  INTERVIEW_STATUS_LABELS,
  OFFER_STATUS_LABELS,
  RESUME_STATUS_LABELS,
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
  const [size, setSize] = useState(25);
  const [backgroundSaving, setBackgroundSaving] = useState(false);

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
          (rows as any[]).map((r) => ({
            source_id: r.source_id,
            fit: r.fit,
          })),
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
    notify(
      source === "session"
        ? `Restored ${(snapshot as any).candidates.length} candidate(s) from this browser session (no new search credits).`
        : `Restored ${(snapshot as any).candidates.length} candidate(s) from your last search on this role.`,
      { type: "success" },
    );
  };

  // Auto-save all fetched candidates to the DB in the background.
  const autoSaveAllCandidates = async (
    newCandidates: PdlCandidate[],
    dealId: number,
  ) => {
    const unsaved = newCandidates.filter(
      (c) => !c._already_saved && !candidateDbIds[c.id],
    );
    if (unsaved.length === 0) return;
    setBackgroundSaving(true);
    const results = await Promise.allSettled(
      unsaved.map((c) => dataProvider.saveSourcedCandidate(dealId, c)),
    );
    const newDbIds: Record<string, number> = {};
    const newSaveStates: Record<string, SaveState> = {};
    unsaved.forEach((c, i) => {
      const r = results[i];
      if (r.status === "fulfilled" && r.value.candidate_id) {
        newDbIds[c.id] = r.value.candidate_id;
        newSaveStates[c.id] = "saved";
      }
    });
    setCandidateDbIds((prev) => ({ ...prev, ...newDbIds }));
    setSaveStates((prev) => ({ ...prev, ...newSaveStates }));
    setBackgroundSaving(false);
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

  // Re-sort in place when sort controls change.
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

  // Persist fetched lists to session snapshot.
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

  // Restore browser session snapshot on embedded mount.
  useEffect(() => {
    if (!initialRoleBriefId) return;
    const snapshot = loadSourcingSnapshot(initialRoleBriefId);
    if (snapshot?.candidates?.length) {
      applySourcingSnapshot(snapshot as any, "session");
    } else {
      setSelectedId(initialRoleBriefId);
      loadRoleBriefContext(initialRoleBriefId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoleBriefId]);

  // -------------------------------------------------------------------------
  // Public handlers
  // -------------------------------------------------------------------------

  const handleRoleBriefChange = (value: string) => {
    resetSearchUiState();
    setSelectedId(value);
    loadRoleBriefContext(value);
  };

  const handleDismissClarifyingQuestions = async () => {
    if (!selectedId) return;
    setRoleBriefDetail((current) =>
      current ? { ...current, clarifying_questions_dismissed: true } : current,
    );
    try {
      await dataProvider.update("deals", {
        id: Number(selectedId),
        data: { clarifying_questions_dismissed: true },
        previousData: { id: Number(selectedId) },
      });
    } catch (error: any) {
      notify(error?.message || "Failed to dismiss", { type: "error" });
    }
  };

  const handleNlSearch = async () => {
    if (!nlText.trim()) {
      notify("Describe who you're looking for first", { type: "warning" });
      return;
    }
    setNlParsing(true);
    try {
      const parsed = await dataProvider.parseJobDescription(nlText);
      const { data: created } = await dataProvider.create("deals", {
        data: {
          name: parsed.title || nlText.slice(0, 60),
          stage: "sourcing",
          jd_text: nlText,
          seniority: parsed.seniority,
          location: parsed.location,
          industry: parsed.industry,
          employment_type: parsed.employment_type,
          years_experience_min: parsed.years_experience_min,
          years_experience_max: parsed.years_experience_max,
          required_skills: parsed.required_skills ?? [],
          must_have_keywords: parsed.must_have_keywords ?? [],
          nice_to_have_keywords: parsed.nice_to_have_keywords ?? [],
          preference_tiers:
            parsed.preference_tiers && parsed.preference_tiers.length > 0
              ? parsed.preference_tiers
              : null,
          clarifying_questions:
            parsed.clarifying_questions &&
            parsed.clarifying_questions.length > 0
              ? parsed.clarifying_questions
              : null,
          role_status: "new",
          contact_ids: [],
        },
      });
      notify("Search criteria extracted -- review below before previewing", {
        type: "success",
      });
      setRoleBriefs((current) => [
        { id: created.id, name: created.name },
        ...current,
      ]);
      setNlText("");
      handleRoleBriefChange(String(created.id));
    } catch (error: any) {
      notify(error?.message || "Failed to parse that search", {
        type: "error",
      });
    } finally {
      setNlParsing(false);
    }
  };

  const handlePreview = async () => {
    if (!selectedId) {
      notify("Pick a role brief first", { type: "warning" });
      return;
    }
    setPreviewLoading(true);
    setCandidates([]);
    setScrollToken(null);
    setSaveStates({});
    try {
      const data = (await dataProvider.sourceCandidates(
        Number(selectedId),
        1,
        null,
        true,
      )) as SourceResult;
      setRoleBriefTitle(data.role_brief.title);
      setTotal(data.total);
      setNotes(data.notes);
      setStage("previewed");
    } catch (error: any) {
      notify(error?.message || "Failed to preview matches", {
        type: "error",
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleFetch = async () => {
    if (!selectedId) return;
    setFetchLoading(true);
    try {
      const data = (await dataProvider.sourceCandidates(
        Number(selectedId),
        size,
      )) as SourceResult;
      setCandidates(
        sortCandidatesForDisplay(
          data.candidates,
          sortField,
          sortByMatchEvidence,
          sortByYearsExperience,
          sortByCompanySize,
        ),
      );
      setScrollToken(data.scroll_token);
      setTotal(data.total);
      setTotalMatchesAll(data.total_matches_all);
      setNotes(data.notes);
      const seeded: Record<string, SaveState> = {};
      const seededDbIds: Record<string, number> = {};
      for (const candidate of data.candidates) {
        if (candidate._already_saved) seeded[candidate.id] = "saved";
        if (candidate._candidate_id)
          seededDbIds[candidate.id] = candidate._candidate_id;
      }
      setSaveStates(seeded);
      setCandidateDbIds((prev) => ({ ...prev, ...seededDbIds }));
      setStage("fetched");
      resetPagination();
      setEvidenceExpanded(
        Object.fromEntries(data.candidates.map((c) => [c.id, true])),
      );
      void Promise.allSettled(
        data.candidates
          .filter((c) => !seededDbIds[c.id])
          .map((c) => handleDiscoveryEvidence(c)),
      );
      void autoSaveAllCandidates(data.candidates, Number(selectedId));
    } catch (error: any) {
      notify(error?.message || "Failed to fetch candidates", {
        type: "error",
      });
    } finally {
      setFetchLoading(false);
    }
  };

  const handleSourceCandidates = async () => {
    if (!selectedId) return;
    setPreviewLoading(true);
    setCandidates([]);
    setScrollToken(null);
    setSaveStates({});
    try {
      const preview = (await dataProvider.sourceCandidates(
        Number(selectedId),
        1,
        null,
        true,
      )) as SourceResult;
      setRoleBriefTitle(preview.role_brief.title);
      setTotal(preview.total);
      setNotes(preview.notes);
      setStage("previewed");
    } catch (error: any) {
      notify(error?.message || "Failed to search for candidates", {
        type: "error",
      });
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(false);
    setFetchLoading(true);
    try {
      const data = (await dataProvider.sourceCandidates(
        Number(selectedId),
        25,
      )) as SourceResult;
      setCandidates(
        sortCandidatesForDisplay(
          data.candidates,
          sortField,
          sortByMatchEvidence,
          sortByYearsExperience,
          sortByCompanySize,
        ),
      );
      setScrollToken(data.scroll_token);
      setTotal(data.total);
      setTotalMatchesAll(data.total_matches_all);
      setNotes(data.notes);
      const seeded: Record<string, SaveState> = {};
      const seededDbIds: Record<string, number> = {};
      for (const candidate of data.candidates) {
        if (candidate._already_saved) seeded[candidate.id] = "saved";
        if (candidate._candidate_id)
          seededDbIds[candidate.id] = candidate._candidate_id;
      }
      setSaveStates(seeded);
      setCandidateDbIds((prev) => ({ ...prev, ...seededDbIds }));
      setStage("fetched");
      resetPagination();
      setEvidenceExpanded(
        Object.fromEntries(data.candidates.map((c) => [c.id, true])),
      );
      void Promise.allSettled(
        data.candidates
          .filter((c) => !seededDbIds[c.id])
          .map((c) => handleDiscoveryEvidence(c)),
      );
      void autoSaveAllCandidates(data.candidates, Number(selectedId));
    } catch (error: any) {
      notify(error?.message || "Failed to fetch candidates", { type: "error" });
    } finally {
      setFetchLoading(false);
    }
  };

  const handleSearchWider = async () => {
    if (!selectedId || !scrollToken) return;
    setWideningLoading(true);
    try {
      const data = (await dataProvider.sourceCandidates(
        Number(selectedId),
        size,
        scrollToken,
      )) as SourceResult;
      setCandidates((prev) =>
        sortCandidatesForDisplay(
          [...prev, ...data.candidates],
          sortField,
          sortByMatchEvidence,
          sortByYearsExperience,
          sortByCompanySize,
        ),
      );
      setScrollToken(data.scroll_token);
      setTotalMatchesAll(data.total_matches_all);
      setNotes(data.notes);
      const seeded: Record<string, SaveState> = {};
      const seededDbIds: Record<string, number> = {};
      for (const candidate of data.candidates) {
        if (candidate._already_saved) seeded[candidate.id] = "saved";
        if (candidate._candidate_id)
          seededDbIds[candidate.id] = candidate._candidate_id;
      }
      setSaveStates((prev) => ({ ...prev, ...seeded }));
      setCandidateDbIds((prev) => ({ ...prev, ...seededDbIds }));
      void autoSaveAllCandidates(data.candidates, Number(selectedId));
    } catch (error: any) {
      notify(error?.message || "Failed to fetch more candidates", {
        type: "error",
      });
    } finally {
      setWideningLoading(false);
    }
  };

  const handleSearchFreePortals = async () => {
    if (!selectedId) return;
    setFreePortalLoading(true);
    try {
      const [freePortalOutcome, exaOutcome] = await Promise.allSettled([
        dataProvider.sourceFreePortalCandidates(
          Number(selectedId),
          10,
        ) as Promise<FreePortalResult>,
        dataProvider.sourceExaCandidates(
          Number(selectedId),
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
      setFreePortalCandidates(merged);
      setFreePortalNotes(combinedNotes);
      setFreePortalSearched(true);
      const seededDbIds: Record<string, number> = {};
      merged.forEach((c) => {
        if (c._already_saved && c._candidate_id)
          seededDbIds[c.id] = c._candidate_id;
      });
      setCandidateDbIds((prev) => ({ ...prev, ...seededDbIds }));
    } catch (error: any) {
      notify(error?.message || "Failed to search free & low-cost portals", {
        type: "error",
      });
    } finally {
      setFreePortalLoading(false);
    }
  };

  const handleSearchXray = async () => {
    if (!selectedId) return;
    setXrayLoading(true);
    try {
      const result = (await dataProvider.sourceXrayCandidates(
        Number(selectedId),
      )) as FreePortalResult;
      const combinedNotes = [...freePortalNotes, ...(result.notes ?? [])];
      const { merged, mergedAwayCount } =
        mergeCandidatesAcrossSources<PdlCandidate>([
          freePortalCandidates,
          result.candidates ?? [],
        ]);
      if (mergedAwayCount > 0) {
        combinedNotes.push(
          `${mergedAwayCount} candidate(s) from X-ray merged with existing results.`,
        );
      }
      setFreePortalCandidates(merged);
      setFreePortalNotes(combinedNotes);
      setFreePortalSearched(true);
      const seededDbIds: Record<string, number> = {};
      merged.forEach((c) => {
        if (c._already_saved && c._candidate_id)
          seededDbIds[c.id] = c._candidate_id;
      });
      setCandidateDbIds((prev) => ({ ...prev, ...seededDbIds }));
    } catch (error: any) {
      notify(error?.message || "Failed to run X-ray search", { type: "error" });
    } finally {
      setXrayLoading(false);
    }
  };

  const handleEnrichContact = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId) return;
    setContactEnrichStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = (await dataProvider.enrichCandidateContact(
        candidateId,
      )) as ContactEnrichResult;
      setContactEnrichResults((prev) => ({ ...prev, [candidate.id]: result }));
      setContactEnrichStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      notify(
        result.status === "enriched"
          ? `Contact found via ${result.source}`
          : result.status === "not_found"
            ? "No contact info found"
            : "Contact enrichment failed -- see notes",
        { type: result.status === "enriched" ? "success" : "warning" },
      );
    } catch (error: any) {
      setContactEnrichStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to enrich contact", { type: "error" });
    }
  };

  const handleEnrichDevSignals = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId) return;
    setDevSignalEnrichStates((prev) => ({
      ...prev,
      [candidate.id]: "loading",
    }));
    try {
      const result = (await dataProvider.enrichCandidateDevSignals(
        candidateId,
      )) as DevSignalEnrichResult;
      setDevSignalEnrichResults((prev) => ({
        ...prev,
        [candidate.id]: result,
      }));
      setDevSignalEnrichStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      notify(
        result.status === "enriched"
          ? "Dev signal(s) found"
          : result.status === "not_found"
            ? "No confident dev-signal match found"
            : "Dev-signal enrichment failed -- see notes",
        { type: result.status === "enriched" ? "success" : "warning" },
      );
    } catch (error: any) {
      setDevSignalEnrichStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to enrich dev signals", {
        type: "error",
      });
    }
  };

  const handleViewFullProfile = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId) return;
    const alreadyHaveData = fullProfileData[candidate.id];
    if (alreadyHaveData) {
      setFullProfileExpanded((prev) => ({
        ...prev,
        [candidate.id]: !prev[candidate.id],
      }));
      return;
    }
    setFullProfileStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const enrichResult = (await dataProvider.enrichCandidateWorkHistory(
        candidateId,
      )) as FullProfileEnrichResult;
      const profile = (await dataProvider.getCandidateFullProfile(
        candidateId,
      )) as FullProfileData;
      setFullProfileData((prev) => ({ ...prev, [candidate.id]: profile }));
      setFullProfileStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      setFullProfileExpanded((prev) => ({ ...prev, [candidate.id]: true }));
      notify(
        enrichResult.status === "enriched"
          ? `Full profile loaded via ${enrichResult.source} (${enrichResult.experience_count} jobs, ${enrichResult.education_count} education)`
          : enrichResult.status === "not_found"
            ? "No full profile found for this candidate"
            : "Full profile lookup failed -- see notes",
        { type: enrichResult.status === "enriched" ? "success" : "warning" },
      );
    } catch (error: any) {
      setFullProfileStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to load full profile", {
        type: "error",
      });
    }
  };

  const handleScoreCandidate = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId || !selectedId) return;
    setScoreStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = (await dataProvider.scoreCandidate(
        candidateId,
        Number(selectedId),
      )) as ScoreResult;
      setScoreResults((prev) => ({ ...prev, [candidate.id]: result }));
      setScoreStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      notify(
        `${result.verdict} (${result.overall_score}/100) -- recommended: ${ACTION_LABELS[result.recommended_action]}`,
        {
          type: result.recommended_action === "reject" ? "warning" : "success",
        },
      );
    } catch (error: any) {
      setScoreStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to score candidate", { type: "error" });
    }
  };

  const handleDiscoveryEvidence = async (candidate: PdlCandidate) => {
    if (!selectedId) return;
    setEvidenceStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = await dataProvider.scoreDiscoveryEvidence(
        Number(selectedId),
        candidate as Record<string, unknown>,
      );
      setEvidenceResults((prev) => ({
        ...prev,
        [candidate.id]: result.must_haves_check ?? [],
      }));
      setEvidenceStates((prev) => ({ ...prev, [candidate.id]: "done" }));
    } catch (error: any) {
      setEvidenceStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to load match evidence", {
        type: "error",
      });
    }
  };

  const handleRestoreLastSearch = async () => {
    if (!selectedId) {
      notify("Pick a role brief first", { type: "warning" });
      return;
    }
    const sessionSnap = loadSourcingSnapshot(selectedId);
    if (sessionSnap?.candidates?.length) {
      applySourcingSnapshot(sessionSnap as any, "session");
      void Promise.allSettled(
        sessionSnap.candidates
          .filter((c) => !(sessionSnap as any).candidateDbIds[c.id])
          .map((c) => handleDiscoveryEvidence(c as PdlCandidate)),
      );
      return;
    }
    setRestoreLoading(true);
    try {
      const data = await dataProvider.rehydrateDiscoveryCandidates(
        Number(selectedId),
      );
      const sorted = sortCandidatesForDisplay(
        data.candidates as PdlCandidate[],
        sortField,
        sortByMatchEvidence,
        sortByYearsExperience,
        sortByCompanySize,
      );
      const seeded: Record<string, SaveState> = {};
      const seededDbIds: Record<string, number> = {};
      for (const candidate of data.candidates) {
        if (candidate._already_saved) seeded[candidate.id] = "saved";
        if (candidate._candidate_id)
          seededDbIds[candidate.id] = candidate._candidate_id;
      }
      applySourcingSnapshot(
        {
          version: 1,
          savedAt: new Date().toISOString(),
          dealId: selectedId,
          stage: "fetched",
          candidates: sorted,
          scrollToken: data.scroll_token,
          total: data.total,
          totalMatchesAll: data.total_matches_all,
          notes: data.notes,
          saveStates: seeded,
          candidateDbIds: seededDbIds,
        } as any,
        "server",
      );
      void Promise.allSettled(
        sorted
          .filter((c) => !seededDbIds[c.id])
          .map((c) => handleDiscoveryEvidence(c)),
      );
    } catch (error: any) {
      notify(error?.message || "Could not restore last search", {
        type: "error",
      });
    } finally {
      setRestoreLoading(false);
    }
  };

  const handleAssessFit = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId || !selectedId) return;
    setFitStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = (await dataProvider.assessCandidateFit(
        candidateId,
        Number(selectedId),
      )) as FitAssessmentResult;
      setFitResults((prev) => ({ ...prev, [candidate.id]: result }));
      setFitStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      notify(FIT_BUCKET_LABELS[result.fit_bucket], {
        type: result.fit_bucket === "not_a_fit" ? "warning" : "success",
      });
    } catch (error: any) {
      setFitStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to assess candidate fit", {
        type: "error",
      });
    }
  };

  const handlePrepareBookingLink = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId || !selectedId) return;
    setInterviewStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    setBookingPrepared((prev) => {
      const next = { ...prev };
      delete next[candidate.id];
      return next;
    });
    try {
      const result = (await dataProvider.prepareBookingLink(
        candidateId,
        Number(selectedId),
      )) as InterviewResult;
      if (result.already_booked) {
        setInterviewResults((prev) => ({ ...prev, [candidate.id]: result }));
        notify(INTERVIEW_STATUS_LABELS[result.status!], { type: "info" });
      } else if (result.prepared && result.booking_link_url) {
        setInterviewResults((prev) => ({
          ...prev,
          [candidate.id]: {
            already_booked: false,
            prepared: true,
            booking_link_url: result.booking_link_url,
            candidate_email: result.candidate_email,
            email_sent: false,
          },
        }));
        setBookingPrepared((prev) => ({
          ...prev,
          [candidate.id]: {
            booking_link_url: result.booking_link_url!,
            email_preview: result.email_preview ?? null,
          },
        }));
        notify(
          result.email_preview
            ? "Review the booking email below before sending"
            : "Review the booking link below before saving",
          { type: "info" },
        );
      }
      setInterviewStates((prev) => ({ ...prev, [candidate.id]: "done" }));
    } catch (error: any) {
      setInterviewStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to prepare booking link", {
        type: "error",
      });
    }
  };

  const handleConfirmSendBookingLink = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    const prepared = bookingPrepared[candidate.id];
    if (!candidateId || !selectedId || !prepared) return;
    setBookingSendStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const preview = prepared.email_preview;
      const result = (await dataProvider.sendBookingLink(
        candidateId,
        Number(selectedId),
        {
          booking_link_url: prepared.booking_link_url,
          subject: preview?.subject,
          html: preview?.html,
        },
      )) as InterviewResult;
      setInterviewResults((prev) => ({ ...prev, [candidate.id]: result }));
      setBookingPrepared((prev) => {
        const next = { ...prev };
        delete next[candidate.id];
        return next;
      });
      notify(
        result.email_sent
          ? "Booking link saved and emailed to the candidate"
          : "Booking link saved — share it with the candidate manually",
        { type: "success" },
      );
      setBookingSendStates((prev) => ({ ...prev, [candidate.id]: "done" }));
    } catch (error: any) {
      setBookingSendStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to send booking link", {
        type: "error",
      });
    }
  };

  const handleCancelBookingPrepared = (candidateId: string) => {
    setBookingPrepared((prev) => {
      const next = { ...prev };
      delete next[candidateId];
      return next;
    });
    setInterviewResults((prev) => {
      const next = { ...prev };
      delete next[candidateId];
      return next;
    });
  };

  const handlePrepareResumeRequest = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId || !selectedId) return;
    setResumeStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    setResumeEmailPreviews((prev) => {
      const next = { ...prev };
      delete next[candidate.id];
      return next;
    });
    try {
      const result = await dataProvider.prepareRequestResume(
        candidateId,
        Number(selectedId),
      );
      setResumeEmailPreviews((prev) => ({
        ...prev,
        [candidate.id]: result.email_preview as EmailPreview,
      }));
      setResumeStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      notify("Review the resume request email below before sending", {
        type: "info",
      });
    } catch (error: any) {
      setResumeStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to prepare resume request", {
        type: "error",
      });
    }
  };

  const handleConfirmSendResumeRequest = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    const preview = resumeEmailPreviews[candidate.id];
    if (!candidateId || !selectedId || !preview) return;
    setResumeSendStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = await dataProvider.requestCandidateResume(
        candidateId,
        Number(selectedId),
        { subject: preview.subject, html: preview.html },
      );
      setResumeSendStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      setResumeEmailPreviews((prev) => {
        const next = { ...prev };
        delete next[candidate.id];
        return next;
      });
      notify(
        result.resume_status === "received"
          ? "Already have a resume on file -- sent another request anyway"
          : "Resume request sent",
        { type: "success" },
      );
      const current = resumeInfos[candidate.id];
      setResumeInfos((prev) => ({
        ...prev,
        [candidate.id]: {
          resume_status: result.resume_status,
          resume_original_filename: current?.resume_original_filename ?? null,
          resume_received_at: current?.resume_received_at ?? null,
          resume_reply_text: current?.resume_reply_text ?? null,
        },
      }));
    } catch (error: any) {
      setResumeSendStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to send resume request", {
        type: "error",
      });
    }
  };

  const handleCancelResumePreview = (candidateId: string) => {
    setResumeEmailPreviews((prev) => {
      const next = { ...prev };
      delete next[candidateId];
      return next;
    });
  };

  const handleCheckForResume = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId) return;
    setResumeStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const info = (await dataProvider.getCandidateResumeInfo(
        candidateId,
      )) as ResumeInfo;
      setResumeInfos((prev) => ({ ...prev, [candidate.id]: info }));
      setResumeStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      notify(RESUME_STATUS_LABELS[info.resume_status], {
        type: info.resume_status === "received" ? "success" : "info",
      });
    } catch (error: any) {
      setResumeStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to check resume status", {
        type: "error",
      });
    }
  };

  const handlePrepareOutreach = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId || !selectedId) return;
    setOutreachStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = await dataProvider.prepareFirstOutreach(
        candidateId,
        Number(selectedId),
      );
      setOutreachPrepared((prev) => ({
        ...prev,
        [candidate.id]: result as OutreachPrepared,
      }));
      setOutreachStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      notify("Review the outreach message before sending", { type: "info" });
    } catch (error: any) {
      setOutreachStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to prepare outreach", { type: "error" });
    }
  };

  // Save-then-prepare in one shot so action bar outreach works before
  // the recruiter manually clicks "Add to pipeline".
  const handleOutreachFromSearch = async (candidate: PdlCandidate) => {
    if (!selectedId) return;
    let cId = candidateDbIds[candidate.id];
    if (!cId) {
      setSaveStates((prev) => ({ ...prev, [candidate.id]: "saving" }));
      try {
        const outcome = await dataProvider.saveSourcedCandidate(
          Number(selectedId),
          candidate,
        );
        if (outcome.candidate_id) {
          cId = outcome.candidate_id;
          setCandidateDbIds((prev) => ({ ...prev, [candidate.id]: cId! }));
          setSaveStates((prev) => ({ ...prev, [candidate.id]: "saved" }));
          if (onCandidateSaved) {
            const name =
              candidate.full_name || `Candidate #${outcome.candidate_id}`;
            onCandidateSaved(outcome.candidate_id, name);
          }
        }
      } catch (error: any) {
        setSaveStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
        notify(error?.message || "Failed to save candidate", { type: "error" });
        return;
      }
    }
    if (!cId) return;
    setOutreachStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = await dataProvider.prepareFirstOutreach(
        cId,
        Number(selectedId),
      );
      setOutreachPrepared((prev) => ({
        ...prev,
        [candidate.id]: result as OutreachPrepared,
      }));
      setOutreachStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      notify("Review the outreach message before sending", { type: "info" });
    } catch (error: any) {
      setOutreachStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to prepare outreach", { type: "error" });
    }
  };

  const handleConfirmSendOutreach = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    const prepared = outreachPrepared[candidate.id];
    if (!candidateId || !selectedId || !prepared) return;
    setOutreachSendStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const isDualChannel =
        prepared.dual_channel &&
        prepared.send_email_too &&
        prepared.email_preview;
      await dataProvider.sendFirstOutreach(candidateId, Number(selectedId), {
        channel: prepared.channel,
        message_body: prepared.message_body ?? undefined,
        linkedin_provider_id: prepared.linkedin_provider_id ?? undefined,
        subject:
          prepared.channel === "email"
            ? prepared.email_preview?.subject
            : undefined,
        html:
          prepared.channel === "email"
            ? prepared.email_preview?.html
            : undefined,
        also_send_email: isDualChannel ? true : undefined,
        email_to: isDualChannel ? prepared.email_preview?.to : undefined,
        email_subject: isDualChannel
          ? prepared.email_preview?.subject
          : undefined,
        email_html: isDualChannel ? prepared.email_preview?.html : undefined,
      });
      setOutreachSendStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      setOutreachPrepared((prev) => {
        const next = { ...prev };
        delete next[candidate.id];
        return next;
      });
      notify(
        isDualChannel ? "Outreach sent via LinkedIn + email" : "Outreach sent",
        { type: "success" },
      );
    } catch (error: any) {
      setOutreachSendStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to send outreach", { type: "error" });
    }
  };

  const handleBulkPrepareOutreach = async () => {
    if (!selectedId || bulkSelected.size === 0) return;
    setBulkPreparing(true);
    const selected = candidates.filter((c) => bulkSelected.has(c.id));
    const queue: Array<{ candidateKey: string; prepared: OutreachPrepared }> =
      [];
    for (const candidate of selected) {
      let cId = candidateDbIds[candidate.id];
      if (!cId) {
        try {
          const outcome = await dataProvider.saveSourcedCandidate(
            Number(selectedId),
            candidate,
          );
          if (outcome.candidate_id) {
            cId = outcome.candidate_id;
            setCandidateDbIds((prev) => ({ ...prev, [candidate.id]: cId! }));
            setSaveStates((prev) => ({ ...prev, [candidate.id]: "saved" }));
          }
        } catch {
          continue;
        }
      }
      if (!cId) continue;
      try {
        const result = await dataProvider.prepareFirstOutreach(
          cId,
          Number(selectedId),
        );
        queue.push({
          candidateKey: candidate.id,
          prepared: result as OutreachPrepared,
        });
        setOutreachPrepared((prev) => ({
          ...prev,
          [candidate.id]: result as OutreachPrepared,
        }));
      } catch {
        // skip
      }
    }
    setBulkQueue(queue);
    setBulkQueueIdx(0);
    setBulkPreparing(false);
    setBulkSelected(new Set());
    if (queue.length > 0) {
      notify(
        `${queue.length} outreach draft(s) ready — review each before sending`,
        { type: "info" },
      );
    }
  };

  const handleToggleOfferForm = (candidate: PdlCandidate) => {
    setOfferFormOpen((prev) => ({
      ...prev,
      [candidate.id]: !prev[candidate.id],
    }));
    setOfferDrafts((prev) => ({
      ...prev,
      [candidate.id]: prev[candidate.id] ?? { ...EMPTY_OFFER_DRAFT },
    }));
  };

  const handleOfferDraftChange = (
    candidateKey: string,
    field: keyof OfferDraft,
    value: string,
  ) => {
    setOfferDrafts((prev) => ({
      ...prev,
      [candidateKey]: {
        ...(prev[candidateKey] ?? EMPTY_OFFER_DRAFT),
        [field]: value,
      },
    }));
  };

  const handlePrepareOffer = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    const draft = offerDrafts[candidate.id];
    if (!candidateId || !selectedId || !draft) return;
    setOfferStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    setOfferEmailPreviews((prev) => {
      const next = { ...prev };
      delete next[candidate.id];
      return next;
    });
    try {
      const result = await dataProvider.prepareOffer(
        candidateId,
        Number(selectedId),
        {
          position_title: draft.position_title,
          compensation_amount: draft.compensation_amount
            ? Number(draft.compensation_amount)
            : null,
          compensation_currency: draft.compensation_currency,
          compensation_frequency: draft.compensation_frequency,
          start_date: draft.start_date || null,
          expiry_date: draft.expiry_date || null,
          benefits_summary: draft.benefits_summary || null,
        },
      );
      setOfferInfos((prev) => ({
        ...prev,
        [candidate.id]: result.offer as OfferInfo,
      }));
      setOfferEmailPreviews((prev) => ({
        ...prev,
        [candidate.id]: result.email_preview as EmailPreview,
      }));
      setOfferStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      notify("Review the offer email below before sending", { type: "info" });
    } catch (error: any) {
      setOfferStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to prepare offer", { type: "error" });
    }
  };

  const handleConfirmSendOffer = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    const preview = offerEmailPreviews[candidate.id];
    if (!candidateId || !selectedId || !preview) return;
    setOfferSendStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = await dataProvider.sendOffer(
        candidateId,
        Number(selectedId),
        { subject: preview.subject, html: preview.html },
      );
      setOfferInfos((prev) => ({
        ...prev,
        [candidate.id]: result.offer as OfferInfo,
      }));
      setOfferEmailPreviews((prev) => {
        const next = { ...prev };
        delete next[candidate.id];
        return next;
      });
      setOfferStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      setOfferFormOpen((prev) => ({ ...prev, [candidate.id]: false }));
      notify("Offer sent", { type: "success" });
    } catch (error: any) {
      setOfferSendStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to send offer", { type: "error" });
    }
  };

  const handleCancelOfferPreview = (candidateId: string) => {
    setOfferEmailPreviews((prev) => {
      const next = { ...prev };
      delete next[candidateId];
      return next;
    });
  };

  const handleCheckOffer = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId || !selectedId) return;
    setOfferStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const info = (await dataProvider.getCandidateOffer(
        candidateId,
        Number(selectedId),
      )) as OfferInfo | null;
      if (info) {
        setOfferInfos((prev) => ({ ...prev, [candidate.id]: info }));
        notify(OFFER_STATUS_LABELS[info.status], {
          type: info.status === "accepted" ? "success" : "info",
        });
      }
      setOfferStates((prev) => ({ ...prev, [candidate.id]: "done" }));
    } catch (error: any) {
      setOfferStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to check offer status", {
        type: "error",
      });
    }
  };

  const handleMarkOfferStatus = async (
    candidate: PdlCandidate,
    status: "accepted" | "declined" | "negotiating",
  ) => {
    const info = offerInfos[candidate.id];
    if (!info) return;
    try {
      await dataProvider.updateOfferStatus(info.id, status);
      setOfferInfos((prev) => ({
        ...prev,
        [candidate.id]: { ...info, status },
      }));
      notify(OFFER_STATUS_LABELS[status], { type: "success" });
    } catch (error: any) {
      notify(error?.message || "Failed to update offer status", {
        type: "error",
      });
    }
  };

  const handleStartCalibration = async (provider?: string) => {
    if (!selectedId) return;
    setCalibrationLoading(true);
    try {
      const data = (await dataProvider.sourceCandidates(
        Number(selectedId),
        3,
        null,
        false,
        provider,
      )) as SourceResult;
      setCalibrationCandidates(
        sortCandidatesForDisplay(
          data.candidates,
          "default",
          true,
          false,
          false,
        ),
      );
      setCalibrationStarted(true);
      setNotes(data.notes);
      setTotal(data.total);
    } catch (error: any) {
      notify(error?.message || "Failed to pull candidates to calibrate on", {
        type: "error",
      });
    } finally {
      setCalibrationLoading(false);
    }
  };

  const handleContextualize = async (
    candidate: PdlCandidate,
    reason: string,
  ) => {
    setContextualizeStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = await dataProvider.contextualizeCalibrationFeedback(
        Number(selectedId),
        reason,
        candidate._match_evidence,
      );
      setContextualizeResults((prev) => ({ ...prev, [candidate.id]: result }));
    } catch (error: any) {
      notify(
        error?.message ||
          "Failed to check whether this reason implies a search criterion",
        { type: "error" },
      );
    } finally {
      setContextualizeStates((prev) => ({ ...prev, [candidate.id]: "done" }));
    }
  };

  const handleSubmitCalibrationJudgment = async (
    candidate: PdlCandidate,
    fit: boolean,
  ) => {
    const reason = (calibrationReasons[candidate.id] ?? "").trim();
    if (!reason) {
      notify("A reason is required before submitting", { type: "warning" });
      return;
    }
    setCalibrationEntryStates((prev) => ({
      ...prev,
      [candidate.id]: "submitting",
    }));
    try {
      await dataProvider.submitCalibrationFeedback(
        Number(selectedId),
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
      setCalibrationEntryStates((prev) => ({
        ...prev,
        [candidate.id]: "submitted",
      }));
      notify(fit ? "Marked as a fit" : "Marked as not a fit", {
        type: "success",
      });
      if (!fit) void handleContextualize(candidate, reason);
    } catch (error: any) {
      setCalibrationEntryStates((prev) => ({
        ...prev,
        [candidate.id]: "idle",
      }));
      notify(error?.message || "Failed to save judgment", { type: "error" });
    }
  };

  const handleApplyCriterion = async (candidateId: string) => {
    const result = contextualizeResults[candidateId];
    if (!result?.criterion) return;
    setApplyStates((prev) => ({ ...prev, [candidateId]: "applying" }));
    try {
      await dataProvider.applyLearnedCriterion(
        Number(selectedId),
        result.criterion,
      );
      setApplyStates((prev) => ({ ...prev, [candidateId]: "applied" }));
      notify("Criterion applied to future searches for this role", {
        type: "success",
      });
      void handleRefreshCriteriaImpact();
    } catch (error: any) {
      setApplyStates((prev) => ({ ...prev, [candidateId]: "idle" }));
      notify(error?.message || "Failed to apply criterion", { type: "error" });
    }
  };

  const handleSteeringContextualize = async () => {
    if (!selectedId || !steeringText.trim()) return;
    setSteeringState("loading");
    try {
      const result = await dataProvider.contextualizeCalibrationFeedback(
        Number(selectedId),
        steeringText.trim(),
      );
      setSteeringResult(result);
    } catch (error: any) {
      notify(
        error?.message ||
          "Failed to check whether this implies a search criterion",
        { type: "error" },
      );
    } finally {
      setSteeringState("done");
    }
  };

  const handleApplySteeringCriterion = async () => {
    if (!steeringResult?.criterion || !selectedId) return;
    setSteeringApplyState("applying");
    try {
      await dataProvider.applyLearnedCriterion(
        Number(selectedId),
        steeringResult.criterion,
      );
      setSteeringApplyState("applied");
      notify("Criterion applied to future searches for this role", {
        type: "success",
      });
      setSteeringText("");
      setSteeringResult(null);
      setSteeringState("idle");
      setSteeringApplyState("idle");
      void handleRefreshCriteriaImpact();
    } catch (error: any) {
      setSteeringApplyState("idle");
      notify(error?.message || "Failed to apply criterion", { type: "error" });
    }
  };

  const CRITERIA_IMPACT_DISABLED = false;
  const handleRefreshCriteriaImpact = async () => {
    if (!selectedId) return;
    if (CRITERIA_IMPACT_DISABLED) {
      notify("Control panel refresh is temporarily disabled.", {
        type: "warning",
      });
      return;
    }
    setCriteriaImpactLoading(true);
    try {
      const result = await dataProvider.getRoleBriefCriteriaImpact(
        Number(selectedId),
      );
      setCriteriaImpact(result);
    } catch (error: any) {
      notify(error?.message || "Failed to load the control panel", {
        type: "error",
      });
    } finally {
      setCriteriaImpactLoading(false);
    }
  };

  const handleRelaxCriterion = async (criterionId: number) => {
    setCriteriaActionStates((prev) => ({ ...prev, [criterionId]: "working" }));
    try {
      await dataProvider.relaxLearnedCriterion(criterionId);
      await handleRefreshCriteriaImpact();
    } catch (error: any) {
      notify(error?.message || "Failed to relax criterion", { type: "error" });
    } finally {
      setCriteriaActionStates((prev) => ({ ...prev, [criterionId]: "idle" }));
    }
  };

  const handleReapplyCriterion = async (criterionId: number) => {
    setCriteriaActionStates((prev) => ({ ...prev, [criterionId]: "working" }));
    try {
      await dataProvider.reapplyLearnedCriterion(criterionId);
      await handleRefreshCriteriaImpact();
    } catch (error: any) {
      notify(error?.message || "Failed to reapply criterion", {
        type: "error",
      });
    } finally {
      setCriteriaActionStates((prev) => ({ ...prev, [criterionId]: "idle" }));
    }
  };

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
    backgroundSaving,
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
    // Handlers
    handleRoleBriefChange,
    handleDismissClarifyingQuestions,
    handleNlSearch,
    handlePreview,
    handleFetch,
    handleSourceCandidates,
    handleSearchWider,
    handleSearchFreePortals,
    handleSearchXray,
    handleEnrichContact,
    handleEnrichDevSignals,
    handleViewFullProfile,
    handleScoreCandidate,
    handleDiscoveryEvidence,
    handleRestoreLastSearch,
    handleAssessFit,
    handlePrepareBookingLink,
    handleConfirmSendBookingLink,
    handleCancelBookingPrepared,
    handlePrepareResumeRequest,
    handleConfirmSendResumeRequest,
    handleCancelResumePreview,
    handleCheckForResume,
    handleRequestResume: handlePrepareResumeRequest,
    handlePrepareOutreach,
    handleOutreachFromSearch,
    handleConfirmSendOutreach,
    handleBulkPrepareOutreach,
    handleToggleOfferForm,
    handleOfferDraftChange,
    handlePrepareOffer,
    handleConfirmSendOffer,
    handleCancelOfferPreview,
    handleCheckOffer,
    handleMarkOfferStatus,
    handleStartCalibration,
    handleSubmitCalibrationJudgment,
    handleApplyCriterion,
    handleSteeringContextualize,
    handleApplySteeringCriterion,
    handleRefreshCriteriaImpact,
    handleRelaxCriterion,
    handleReapplyCriterion,
  };
}
