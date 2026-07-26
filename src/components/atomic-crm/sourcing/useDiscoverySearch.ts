import type { CrmDataProvider } from "../providers/types";
import { loadSourcingSnapshot } from "./sourcingSessionSnapshot";
import {
  sortCandidatesForDisplay,
  type CandidateSortField,
  type ContextualizeResult,
  type CriteriaImpact,
  type MustHaveCheck,
  type PdlCandidate,
  type RoleBriefDetail,
  type RoleBriefOption,
  type SaveState,
  type SourceResult,
} from "./sourcingTypes";

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;
type NotifyFn = (msg: string, opts: { type: string }) => void;

export type DiscoverySearchDeps = {
  dataProvider: CrmDataProvider;
  notify: NotifyFn;
  selectedId: string;
  size: number;
  sortField: CandidateSortField;
  sortByMatchEvidence: boolean;
  sortByYearsExperience: boolean;
  sortByCompanySize: boolean;
  scrollToken: string | null;
  total: number;
  nlText: string;
  steeringText: string;
  steeringResult: ContextualizeResult | null;
  candidateDbIds: Record<string, number>;
  setSelectedId: SetState<string>;
  resetPagination: () => void;
  // setters
  setStage: SetState<any>;
  setCandidates: SetState<PdlCandidate[]>;
  setScrollToken: SetState<string | null>;
  setTotal: SetState<number>;
  setTotalMatchesAll: SetState<number | null>;
  setNotes: SetState<string[]>;
  setSaveStates: SetState<Record<string, SaveState>>;
  setCandidateDbIds: SetState<Record<string, number>>;
  setPreviewLoading: SetState<boolean>;
  setFetchLoading: SetState<boolean>;
  setWideningLoading: SetState<boolean>;
  setRestoreLoading: SetState<boolean>;
  setRoleBriefTitle: SetState<string | null>;
  setNlText: SetState<string>;
  setNlParsing: SetState<boolean>;
  setRoleBriefs: SetState<RoleBriefOption[]>;
  setEvidenceExpanded: SetState<Record<string, boolean>>;
  setEvidenceStates: SetState<Record<string, any>>;
  setEvidenceResults: SetState<Record<string, MustHaveCheck[]>>;
  setCalibrationLoading: SetState<boolean>;
  setCalibrationStarted: SetState<boolean>;
  setCalibrationCandidates: SetState<PdlCandidate[]>;
  setCriteriaImpact: SetState<CriteriaImpact | null>;
  setCriteriaImpactLoading: SetState<boolean>;
  setCriteriaActionStates: SetState<Record<number, "idle" | "working">>;
  setSteeringText: SetState<string>;
  setSteeringState: SetState<"idle" | "loading" | "done">;
  setSteeringResult: SetState<ContextualizeResult | null>;
  setSteeringApplyState: SetState<"idle" | "applying" | "applied">;
  setRoleBriefDetail: SetState<RoleBriefDetail | null>;
  roleBriefDetail: RoleBriefDetail | null;
  // helpers from main hook
  resetSearchUiState: () => void;
  loadRoleBriefContext: (id: string) => void;
  applySourcingSnapshot: (snap: any, source: "session" | "server") => void;
  autoSaveAllCandidates: (
    candidates: PdlCandidate[],
    dealId: number,
  ) => Promise<void>;
};

export function createDiscoverySearchHandlers(d: DiscoverySearchDeps) {
  // Fire-and-forget: rank candidates with LLM and annotate top 25 with _llm_rank + _llm_why_fit.
  // Updates candidates state in place; does not block the fetch flow.
  const applyLlmRanks = async (candidates: PdlCandidate[]) => {
    if (candidates.length === 0) return;
    try {
      const summaries = candidates.map((c) => ({
        id: c.id,
        full_name: c.full_name ?? null,
        job_title: c.job_title ?? null,
        job_company_name: c.job_company_name ?? null,
        location_name: c.location_name ?? null,
        skills: c.skills ?? null,
        years_experience: c.years_experience ?? null,
      }));
      const ranked = await d.dataProvider.rankDiscoveryBatch(
        summaries,
        (d.roleBriefDetail ?? {}) as Record<string, unknown>,
      );
      if (!ranked.length) return;
      const byId = new Map(ranked.map((r) => [r.id, r]));
      d.setCandidates((prev) => {
        const updated = prev.map((c) => {
          const r = byId.get(c.id);
          return r ? { ...c, _llm_rank: r.rank, _llm_why_fit: r.why_fit } : c;
        });
        // Re-sort: ranked top-25 first (by llm_rank), then unranked (by existing score)
        const ranked25 = updated
          .filter((c) => c._llm_rank != null)
          .sort((a, b) => (a._llm_rank ?? 99) - (b._llm_rank ?? 99));
        const rest = updated.filter((c) => c._llm_rank == null);
        return [...ranked25, ...rest];
      });
    } catch {
      // Non-fatal — ranking failure never breaks the main flow
    }
  };

  const handleDiscoveryEvidence = async (candidate: PdlCandidate) => {
    if (!d.selectedId) return;
    d.setEvidenceStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = await d.dataProvider.scoreDiscoveryEvidence(
        Number(d.selectedId),
        candidate as Record<string, unknown>,
      );
      d.setEvidenceResults((prev) => ({
        ...prev,
        [candidate.id]: result.must_haves_check ?? [],
      }));
      d.setEvidenceStates((prev) => ({ ...prev, [candidate.id]: "done" }));
    } catch (error: any) {
      d.setEvidenceStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      d.notify(error?.message || "Failed to load match evidence", {
        type: "error",
      });
    }
  };

  const CRITERIA_IMPACT_DISABLED = false;
  const handleRefreshCriteriaImpact = async () => {
    if (!d.selectedId) return;
    if (CRITERIA_IMPACT_DISABLED) {
      d.notify("Control panel refresh is temporarily disabled.", {
        type: "warning",
      });
      return;
    }
    d.setCriteriaImpactLoading(true);
    try {
      const result = await d.dataProvider.getRoleBriefCriteriaImpact(
        Number(d.selectedId),
      );
      d.setCriteriaImpact(result);
    } catch (error: any) {
      d.notify(error?.message || "Failed to load the control panel", {
        type: "error",
      });
    } finally {
      d.setCriteriaImpactLoading(false);
    }
  };

  const handleRoleBriefChange = (value: string) => {
    d.resetSearchUiState();
    d.setSelectedId(value);
    d.loadRoleBriefContext(value);
  };

  const handleDismissClarifyingQuestions = async () => {
    if (!d.selectedId) return;
    d.setRoleBriefDetail((current: any) =>
      current ? { ...current, clarifying_questions_dismissed: true } : current,
    );
    try {
      await d.dataProvider.update("deals", {
        id: Number(d.selectedId),
        data: { clarifying_questions_dismissed: true },
        previousData: { id: Number(d.selectedId) },
      });
    } catch (error: any) {
      d.notify(error?.message || "Failed to dismiss", { type: "error" });
    }
  };

  const handleNlSearch = async () => {
    if (!d.nlText.trim()) {
      d.notify("Describe who you're looking for first", { type: "warning" });
      return;
    }
    d.setNlParsing(true);
    try {
      const parsed = await d.dataProvider.parseJobDescription(d.nlText);
      const { data: created } = await d.dataProvider.create("deals", {
        data: {
          name: parsed.title || d.nlText.slice(0, 60),
          stage: "sourcing",
          jd_text: d.nlText,
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
      d.notify("Search criteria extracted -- review below before previewing", {
        type: "success",
      });
      d.setRoleBriefs((current) => [
        { id: created.id, name: created.name },
        ...current,
      ]);
      d.setNlText("");
      handleRoleBriefChange(String(created.id));
    } catch (error: any) {
      d.notify(error?.message || "Failed to parse that search", {
        type: "error",
      });
    } finally {
      d.setNlParsing(false);
    }
  };

  const handlePreview = async () => {
    if (!d.selectedId) {
      d.notify("Pick a role brief first", { type: "warning" });
      return;
    }
    d.setPreviewLoading(true);
    d.setCandidates([]);
    d.setScrollToken(null);
    d.setSaveStates({});
    try {
      const data = (await d.dataProvider.sourceCandidates(
        Number(d.selectedId),
        1,
        null,
        true,
      )) as SourceResult;
      d.setRoleBriefTitle(data.role_brief.title);
      d.setTotal(data.total);
      d.setNotes(data.notes);
      d.setStage("previewed");
    } catch (error: any) {
      d.notify(error?.message || "Failed to preview matches", {
        type: "error",
      });
    } finally {
      d.setPreviewLoading(false);
    }
  };

  const handleFetch = async () => {
    if (!d.selectedId) return;
    d.setFetchLoading(true);
    try {
      const data = (await d.dataProvider.sourceCandidates(
        Number(d.selectedId),
        d.size,
      )) as SourceResult;
      const sorted = sortCandidatesForDisplay(
        data.candidates,
        d.sortField,
        d.sortByMatchEvidence,
        d.sortByYearsExperience,
        d.sortByCompanySize,
      );
      d.setCandidates(sorted);
      d.setScrollToken(data.scroll_token);
      d.setTotal(data.total);
      d.setTotalMatchesAll(data.total_matches_all);
      d.setNotes(data.notes);
      const seeded: Record<string, SaveState> = {};
      const seededDbIds: Record<string, number> = {};
      for (const candidate of data.candidates) {
        if (candidate._already_saved) seeded[candidate.id] = "saved";
        if (candidate._candidate_id)
          seededDbIds[candidate.id] = candidate._candidate_id;
      }
      d.setSaveStates(seeded);
      d.setCandidateDbIds((prev) => ({ ...prev, ...seededDbIds }));
      d.setStage("fetched");
      d.resetPagination();
      // Auto-expand why-fit for all; pre-load evidence only for top 25
      d.setEvidenceExpanded(
        Object.fromEntries(data.candidates.map((c) => [c.id, true])),
      );
      void Promise.allSettled(
        sorted
          .slice(0, 25)
          .filter((c) => !seededDbIds[c.id])
          .map((c) => handleDiscoveryEvidence(c)),
      );
      void d.autoSaveAllCandidates(data.candidates, Number(d.selectedId));
      // LLM pre-rank (fire-and-forget; annotates top 25 and re-sorts candidates state)
      void applyLlmRanks(sorted);
    } catch (error: any) {
      d.notify(error?.message || "Failed to fetch candidates", {
        type: "error",
      });
    } finally {
      d.setFetchLoading(false);
    }
  };

  const handleSourceCandidates = async () => {
    if (!d.selectedId) return;
    d.setPreviewLoading(true);
    d.setCandidates([]);
    d.setScrollToken(null);
    d.setSaveStates({});
    try {
      const preview = (await d.dataProvider.sourceCandidates(
        Number(d.selectedId),
        1,
        null,
        true,
      )) as SourceResult;
      d.setRoleBriefTitle(preview.role_brief.title);
      d.setTotal(preview.total);
      d.setNotes(preview.notes);
      d.setStage("previewed");
    } catch (error: any) {
      d.notify(error?.message || "Failed to search for candidates", {
        type: "error",
      });
      d.setPreviewLoading(false);
      return;
    }
    d.setPreviewLoading(false);
    d.setFetchLoading(true);
    try {
      const data = (await d.dataProvider.sourceCandidates(
        Number(d.selectedId),
        d.size,
      )) as SourceResult;
      const sorted = sortCandidatesForDisplay(
        data.candidates,
        d.sortField,
        d.sortByMatchEvidence,
        d.sortByYearsExperience,
        d.sortByCompanySize,
      );
      d.setCandidates(sorted);
      d.setScrollToken(data.scroll_token);
      d.setTotal(data.total);
      d.setTotalMatchesAll(data.total_matches_all);
      d.setNotes(data.notes);
      const seeded: Record<string, SaveState> = {};
      const seededDbIds: Record<string, number> = {};
      for (const candidate of data.candidates) {
        if (candidate._already_saved) seeded[candidate.id] = "saved";
        if (candidate._candidate_id)
          seededDbIds[candidate.id] = candidate._candidate_id;
      }
      d.setSaveStates(seeded);
      d.setCandidateDbIds((prev) => ({ ...prev, ...seededDbIds }));
      d.setStage("fetched");
      d.resetPagination();
      // Auto-expand why-fit for all candidates; pre-load evidence for top 25
      d.setEvidenceExpanded(
        Object.fromEntries(data.candidates.map((c) => [c.id, true])),
      );
      void Promise.allSettled(
        sorted
          .slice(0, 25)
          .filter((c) => !seededDbIds[c.id])
          .map((c) => handleDiscoveryEvidence(c)),
      );
      void d.autoSaveAllCandidates(data.candidates, Number(d.selectedId));
      // LLM pre-rank (fire-and-forget; annotates top 25 and re-sorts candidates state)
      void applyLlmRanks(sorted);
    } catch (error: any) {
      d.notify(error?.message || "Failed to search for candidates", {
        type: "error",
      });
    } finally {
      d.setFetchLoading(false);
    }
  };

  const handleSearchWider = async () => {
    if (!d.selectedId || !d.scrollToken) return;
    d.setWideningLoading(true);
    try {
      const data = (await d.dataProvider.sourceCandidates(
        Number(d.selectedId),
        d.size,
        d.scrollToken,
      )) as SourceResult;
      d.setCandidates((prev) =>
        sortCandidatesForDisplay(
          [...prev, ...data.candidates],
          d.sortField,
          d.sortByMatchEvidence,
          d.sortByYearsExperience,
          d.sortByCompanySize,
        ),
      );
      d.setScrollToken(data.scroll_token);
      d.setTotalMatchesAll(data.total_matches_all);
      d.setNotes(data.notes);
      const seeded: Record<string, SaveState> = {};
      const seededDbIds: Record<string, number> = {};
      for (const candidate of data.candidates) {
        if (candidate._already_saved) seeded[candidate.id] = "saved";
        if (candidate._candidate_id)
          seededDbIds[candidate.id] = candidate._candidate_id;
      }
      d.setSaveStates((prev) => ({ ...prev, ...seeded }));
      d.setCandidateDbIds((prev) => ({ ...prev, ...seededDbIds }));
      void d.autoSaveAllCandidates(data.candidates, Number(d.selectedId));
    } catch (error: any) {
      d.notify(error?.message || "Failed to fetch more candidates", {
        type: "error",
      });
    } finally {
      d.setWideningLoading(false);
    }
  };

  const handleRestoreLastSearch = async () => {
    if (!d.selectedId) {
      d.notify("Pick a role brief first", { type: "warning" });
      return;
    }
    const sessionSnap = loadSourcingSnapshot(d.selectedId);
    if (sessionSnap?.candidates?.length) {
      d.applySourcingSnapshot(sessionSnap as any, "session");
      void Promise.allSettled(
        sessionSnap.candidates
          .filter((c) => !(sessionSnap as any).candidateDbIds[c.id])
          .map((c) => handleDiscoveryEvidence(c as PdlCandidate)),
      );
      return;
    }
    d.setRestoreLoading(true);
    try {
      const data = await d.dataProvider.rehydrateDiscoveryCandidates(
        Number(d.selectedId),
      );
      const sorted = sortCandidatesForDisplay(
        data.candidates as PdlCandidate[],
        d.sortField,
        d.sortByMatchEvidence,
        d.sortByYearsExperience,
        d.sortByCompanySize,
      );
      const seeded: Record<string, SaveState> = {};
      const seededDbIds: Record<string, number> = {};
      for (const candidate of data.candidates) {
        if (candidate._already_saved) seeded[candidate.id] = "saved";
        if (candidate._candidate_id)
          seededDbIds[candidate.id] = candidate._candidate_id;
      }
      d.applySourcingSnapshot(
        {
          version: 1,
          savedAt: new Date().toISOString(),
          dealId: d.selectedId,
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
      d.notify(error?.message || "Could not restore last search", {
        type: "error",
      });
    } finally {
      d.setRestoreLoading(false);
    }
  };

  const handleSteeringContextualize = async () => {
    if (!d.selectedId || !d.steeringText.trim()) return;
    d.setSteeringState("loading");
    try {
      const result = await d.dataProvider.contextualizeCalibrationFeedback(
        Number(d.selectedId),
        d.steeringText.trim(),
      );
      d.setSteeringResult(result);
    } catch (error: any) {
      d.notify(
        error?.message ||
          "Failed to check whether this implies a search criterion",
        { type: "error" },
      );
    } finally {
      d.setSteeringState("done");
    }
  };

  const handleApplySteeringCriterion = async () => {
    if (!d.steeringResult?.criterion || !d.selectedId) return;
    d.setSteeringApplyState("applying");
    try {
      await d.dataProvider.applyLearnedCriterion(
        Number(d.selectedId),
        d.steeringResult.criterion,
      );
      d.setSteeringApplyState("applied");
      d.notify("Criterion applied to future searches for this role", {
        type: "success",
      });
      d.setSteeringText("");
      d.setSteeringResult(null);
      d.setSteeringState("idle");
      d.setSteeringApplyState("idle");
      void handleRefreshCriteriaImpact();
    } catch (error: any) {
      d.setSteeringApplyState("idle");
      d.notify(error?.message || "Failed to apply criterion", {
        type: "error",
      });
    }
  };

  const handleRelaxCriterion = async (criterionId: number) => {
    d.setCriteriaActionStates((prev) => ({
      ...prev,
      [criterionId]: "working",
    }));
    try {
      await d.dataProvider.relaxLearnedCriterion(criterionId);
      await handleRefreshCriteriaImpact();
    } catch (error: any) {
      d.notify(error?.message || "Failed to relax criterion", {
        type: "error",
      });
    } finally {
      d.setCriteriaActionStates((prev) => ({ ...prev, [criterionId]: "idle" }));
    }
  };

  const handleReapplyCriterion = async (criterionId: number) => {
    d.setCriteriaActionStates((prev) => ({
      ...prev,
      [criterionId]: "working",
    }));
    try {
      await d.dataProvider.reapplyLearnedCriterion(criterionId);
      await handleRefreshCriteriaImpact();
    } catch (error: any) {
      d.notify(error?.message || "Failed to reapply criterion", {
        type: "error",
      });
    } finally {
      d.setCriteriaActionStates((prev) => ({ ...prev, [criterionId]: "idle" }));
    }
  };

  return {
    handleRoleBriefChange,
    handleDismissClarifyingQuestions,
    handleNlSearch,
    handlePreview,
    handleFetch,
    handleSourceCandidates,
    handleSearchWider,
    handleRestoreLastSearch,
    handleDiscoveryEvidence,
    handleRefreshCriteriaImpact,
    handleRelaxCriterion,
    handleReapplyCriterion,
    handleSteeringContextualize,
    handleApplySteeringCriterion,
  };
}
