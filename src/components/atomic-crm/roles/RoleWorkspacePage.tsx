// Role Workspace (2026-07-26): Noon-inspired 3-pane layout.
// Left: AppShell rail (existing). Middle: Role memory panel (desktop).
// Main: header buttons + transcript + tabs.
// All T1-T6 behaviour preserved.
import { isValid } from "date-fns";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Link2,
  MoreHorizontal,
  PauseCircle,
  PlayCircle,
  Settings,
  Sparkles,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  InfiniteListBase,
  ShowBase,
  useDataProvider,
  useGetList,
  useRecordContext,
} from "ra-core";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { CandidateReviewTable } from "../deals/CandidateReviewTable";
import { findDealLabel, formatISODateString } from "../deals/dealUtils";
import { NoteCreate } from "../notes/NoteCreate";
import { NotesIterator } from "../notes/NotesIterator";
import type { CrmDataProvider } from "../providers/types";
import type {
  CalibrationBatch,
  CalibrationCandidate,
} from "../providers/supabase/dataProvider.ts";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { AgentHShell } from "../shell/AgentHShell";
import { RoleConversationTranscript } from "../shell/RoleConversationTranscript";
import { useRoleShellContext } from "../shell/useShellContext";
import {
  approveTier3Proposal,
  dispatchCalibrationNo,
  dispatchCalibrationRerank,
  dispatchCalibrationYes,
  dispatchJdPasteCommand,
  dispatchRoleAgentCommand,
  proposeOutreachAfterPipelineAdd,
  refineTier3Proposal,
  stopTier3Proposal,
  type ParseCandidateRef,
  type RoleAgentOrchestratorDeps,
} from "../shell/roleAgentOrchestrator";
import type { ConversationTurnMetadata } from "../shell/agentActionTiers";
import type { Deal, RoleConversationTurn } from "../types";
import { CandidateCard } from "./CandidateCard";
import { SearchIntentDisplay } from "./SearchIntentDisplay";
import { SearchIntentEditor } from "./SearchIntentEditor";
import { BuildSearchTab } from "./BuildSearchTab";
import "../inbox/agent-h-theme.css";

export const RoleWorkspacePage = () => {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return (
    <ShowBase id={id} resource="deals">
      <RoleWorkspaceContent dealId={id} />
    </ShowBase>
  );
};

type WorkspaceTab = "review" | "pipeline" | "build-search";

const RoleWorkspaceContent = ({ dealId }: { dealId: string }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const { dealStages } = useConfigurationContext();
  const deal = useRecordContext<Deal>();
  const [commandBusy, setCommandBusy] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [pendingCalibrationQuestion, setPendingCalibrationQuestion] =
    useState(false);
  const [linkedInBannerDismissed, setLinkedInBannerDismissed] = useState(
    () =>
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem("linkedin_banner_dismissed") === "1",
  );
  const [addCandidatesOpen, setAddCandidatesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(true);
  // Track the latest calibration batch so we can offer "Add N confident candidates"
  const [lastBatch, setLastBatch] = useState<CalibrationBatch | null>(null);
  // Controlled tab state — lets onOpenReview switch to Review tab imperatively.
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("review");
  // True while a sourcing call is in flight (prevents double-trigger).
  const [sourcingInFlight, setSourcingInFlight] = useState(false);
  const [cardSaveStates, setCardSaveStates] = useState<
    Map<string, "idle" | "saving" | "saved">
  >(new Map());
  // Contact enrichment state per candidate external_id (PDL via enrich-candidate-contact)
  const [contactStates, setContactStates] = useState<
    Map<string, "idle" | "loading" | "done" | "error">
  >(new Map());
  const [contactDataMap, setContactDataMap] = useState<
    Map<string, { email?: string | null; phone?: string | null }>
  >(new Map());
  const autostartFiredRef = useRef(false);

  const { data: openDeals } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 20 },
    sort: { field: "updated_at", order: "DESC" },
    filter: { "archived_at@is": null },
  });
  const { total: pipelineCount = 0, isPending: pipelinePending } = useGetList(
    "deal_candidates",
    { pagination: { page: 1, perPage: 1 }, filter: { deal_id: dealId } },
  );

  // Fetch conversation turns to rehydrate lastBatch after reload.
  // React Query caches this alongside RoleConversationTranscript's identical query.
  const { data: turns } = useGetList<RoleConversationTurn>(
    "role_conversation_turns",
    {
      filter: { deal_id: dealId },
      sort: { field: "created_at", order: "ASC" },
      pagination: { page: 1, perPage: 100 },
    },
  );

  // On mount: reconstruct lastBatch from the latest run of candidate_card turns.
  // Fires once turns are available and only when lastBatch is still null (no live batch).
  useEffect(() => {
    if (!turns || lastBatch !== null) return;
    const batchTurns: RoleConversationTurn[] = [];
    for (let i = turns.length - 1; i >= 0; i--) {
      const m = turns[i].metadata as ConversationTurnMetadata | undefined;
      if (m?.kind === "candidate_card" && m.candidate_card) {
        batchTurns.unshift(turns[i]);
      } else if (m?.kind === "decision" || m?.kind === "refinement") {
        continue;
      } else {
        break;
      }
    }
    if (batchTurns.length === 0) return;
    const candidates: CalibrationCandidate[] = batchTurns.map((t) => {
      const card = (t.metadata as ConversationTurnMetadata).candidate_card!;
      return {
        external_id: card.calibration_external_id ?? String(card.candidate_id),
        name: card.name,
        headline: card.headline,
        why_fit: card.why_fit ?? "",
        match_score: card.match_score,
        linkedin_url: card.linkedin_url,
        location_name: card.location_name ?? null,
        from_bench: false,
        must_haves: card.must_haves ?? [],
      };
    });
    setLastBatch({
      candidates,
      pool_size: candidates.length,
      cursor: candidates.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns]);

  const { data: pipelineRows } = useQuery({
    queryKey: ["deal_candidates_for_deal", dealId],
    queryFn: () => dataProvider.getCandidatesForDeal(dealId),
    enabled: !!dealId,
  });

  const { data: linkedInAccount } = useQuery({
    queryKey: ["unipile_linkedin_account"],
    queryFn: () => dataProvider.getUnipileLinkedInAccount(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const showLinkedInBanner =
    !linkedInBannerDismissed &&
    linkedInAccount !== undefined &&
    (linkedInAccount as { status?: string }).status !== "connected";

  const pipelineCandidates = (pipelineRows ?? []).map(({ candidate }) => {
    const name =
      [candidate.first_name, candidate.last_name].filter(Boolean).join(" ") ||
      `Candidate #${candidate.id}`;
    return { id: Number(candidate.id), name };
  }) as ParseCandidateRef[];

  // Set of external IDs already in pipeline (for "Add N" deduplication)
  const pipelineExternalIds = new Set(
    (pipelineRows ?? []).flatMap(({ candidate }) => {
      const fields = candidate as unknown as Record<string, unknown>;
      return [fields.external_id, fields.linkedin_url].filter(
        Boolean,
      ) as string[];
    }),
  );

  // Map linkedin_url → DB candidate id for Contact button wiring (saved candidates only)
  const dbIdByLinkedinUrl = new Map(
    (pipelineRows ?? []).map(({ candidate }) => {
      const fields = candidate as unknown as Record<string, unknown>;
      return [fields.linkedin_url as string | undefined, candidate.id];
    }),
  );

  // Contact enrichment handler — PDL via enrich-candidate-contact edge fn
  const handleContactEnrich = async (c: CalibrationCandidate) => {
    const dbId = c.linkedin_url
      ? dbIdByLinkedinUrl.get(c.linkedin_url)
      : undefined;
    if (!dbId) return; // candidate not saved yet
    setContactStates((prev) => new Map(prev).set(c.external_id, "loading"));
    try {
      const result = await dataProvider.enrichCandidateContact(dbId);
      setContactDataMap((prev) =>
        new Map(prev).set(c.external_id, {
          email: result?.email ?? null,
          phone: result?.phone ?? null,
        }),
      );
      setContactStates((prev) => new Map(prev).set(c.external_id, "done"));
    } catch {
      setContactStates((prev) => new Map(prev).set(c.external_id, "error"));
    }
  };

  const shellContext = useRoleShellContext({
    deal,
    dealStages,
    pipelineCount,
    isPending: !deal || pipelinePending,
  });

  const orchestratorDeps: RoleAgentOrchestratorDeps = {
    dealId,
    deal,
    openDeals: openDeals ?? [],
    dataProvider,
    queryClient,
    navigate,
    pipelineCandidates,
    selectedCandidates: [],
    invalidateTranscript: () => {
      queryClient.invalidateQueries({ queryKey: ["role_conversation_turns"] });
    },
  };

  const handleToggleSourcingPause = async () => {
    if (!deal) return;
    const next = !deal.sourcing_paused;
    try {
      await dataProvider.update("deals", {
        id: dealId,
        data: { sourcing_paused: next },
        previousData: deal,
      });
      queryClient.invalidateQueries({ queryKey: ["deals", dealId] });
      toast.success(next ? "Sourcing paused" : "Sourcing resumed");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't update sourcing status",
      );
    }
  };

  const runFreeTextCommand = async (commandText: string) => {
    if (deal?.sourcing_paused && commandText.length < 200) {
      toast.info("Sourcing is paused — resume it before running new searches.");
      return;
    }
    setCommandBusy(true);
    try {
      if (pendingCalibrationQuestion) {
        setPendingCalibrationQuestion(false);
        await dispatchCalibrationRerank(orchestratorDeps, commandText);
        return;
      }
      const isJdPaste =
        commandText.length >= 200 &&
        /responsibilities|requirements|qualifications|experience|skills|about the role|what you.ll do|who you are/i.test(
          commandText,
        );
      if (isJdPaste) {
        await dispatchJdPasteCommand(orchestratorDeps, commandText);
      } else {
        await dispatchRoleAgentCommand(orchestratorDeps, commandText);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't run that command",
      );
    } finally {
      setCommandBusy(false);
    }
  };

  const handleContinueSearch = async () => {
    if (deal?.sourcing_paused) {
      toast.info("Sourcing is paused for this role — resume it to continue.");
      return;
    }
    if (sourcingInFlight || commandBusy) return;
    setSourcingInFlight(true);
    setCommandBusy(true);
    try {
      // If cache exists, get next batch; otherwise start fresh sourcing
      if (deal?.role_brief_last_scroll_token) {
        const batch = await dataProvider.calibrationNextBatch(dealId);
        setLastBatch(batch);
        queryClient.invalidateQueries({
          queryKey: ["role_conversation_turns"],
        });
        if (batch.candidates.length === 0) {
          toast.info(
            "No more candidates in the current pool. Try relaxing the criteria in Role Memory.",
          );
        }
      } else {
        const batch = await dataProvider.startCalibrationSourcing(dealId);
        setLastBatch(batch);
        queryClient.invalidateQueries({
          queryKey: ["role_conversation_turns"],
        });
        queryClient.invalidateQueries({ queryKey: ["deals", dealId] });
        if (batch.candidates.length === 0) {
          toast.info(
            "No candidates found right now. Try relaxing the criteria in Role Memory.",
          );
        }
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Search ran but found no candidates — try relaxing the criteria or starting again.",
      );
    } finally {
      setSourcingInFlight(false);
      setCommandBusy(false);
    }
  };

  // Autostart: when the role page loads with ?autostart=1 and no prior search,
  // trigger sourcing once. Home seeds the transcript before navigating, so this
  // is a safety net for page refreshes.
  useEffect(() => {
    if (
      !autostartFiredRef.current &&
      searchParams.get("autostart") === "1" &&
      deal &&
      !deal.role_brief_last_scroll_query &&
      !lastBatch
    ) {
      autostartFiredRef.current = true;
      // Remove the query param so a manual refresh doesn't re-trigger.
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("autostart");
          return next;
        },
        { replace: true },
      );
      void handleContinueSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal]);

  const handleAddNConfident = async (candidates: CalibrationCandidate[]) => {
    const toAdd = candidates
      .filter(
        (c) =>
          !pipelineExternalIds.has(c.external_id) &&
          !(c.linkedin_url && pipelineExternalIds.has(c.linkedin_url)),
      )
      .slice(0, 7);
    if (toAdd.length === 0) {
      toast.info(
        "All candidates from the search are already in your pipeline.",
      );
      return;
    }
    setCommandBusy(true);
    try {
      await Promise.all(
        toAdd.map((c) =>
          dataProvider.saveSourcedCandidate(dealId, {
            id: c.external_id,
            full_name: c.name,
            linkedin_url: c.linkedin_url ?? null,
            job_title: c.headline ?? null,
          }),
        ),
      );
      queryClient.invalidateQueries({ queryKey: ["deal_candidates"] });
      queryClient.invalidateQueries({
        queryKey: ["deal_candidates_for_deal", dealId],
      });
      toast.success(
        `Added ${toAdd.length} candidate${toAdd.length === 1 ? "" : "s"} to your pipeline.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't add candidates",
      );
    } finally {
      setCommandBusy(false);
    }
  };

  const handleAddCardToPipeline = async (candidate: CalibrationCandidate) => {
    const { external_id } = candidate;
    if (pipelineExternalIds.has(external_id)) {
      toast.info("Already in your pipeline.");
      return;
    }
    setCardSaveStates((prev) => new Map(prev).set(external_id, "saving"));
    try {
      await dataProvider.saveSourcedCandidate(dealId, {
        id: external_id,
        full_name: candidate.name,
        linkedin_url: candidate.linkedin_url ?? null,
        job_title: candidate.headline ?? null,
      });
      queryClient.invalidateQueries({ queryKey: ["deal_candidates"] });
      queryClient.invalidateQueries({
        queryKey: ["deal_candidates_for_deal", dealId],
      });
      setCardSaveStates((prev) => new Map(prev).set(external_id, "saved"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't add candidate",
      );
      setCardSaveStates((prev) => new Map(prev).set(external_id, "idle"));
    }
  };

  const handleCalibrationYes = () => {
    if (deal?.sourcing_paused) {
      toast.info("Sourcing is paused — resume it before continuing.");
      return;
    }
    setCommandBusy(true);
    void dispatchCalibrationYes(orchestratorDeps)
      .catch((error: unknown) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "Couldn't show more candidates",
        ),
      )
      .finally(() => setCommandBusy(false));
  };
  const handleCalibrationNo = () => {
    setPendingCalibrationQuestion(true);
    setCommandBusy(true);
    void dispatchCalibrationNo(orchestratorDeps)
      .catch((error: unknown) =>
        toast.error(
          error instanceof Error ? error.message : "Couldn't process that",
        ),
      )
      .finally(() => setCommandBusy(false));
  };

  const handleApproveProposal = async (
    turn: RoleConversationTurn,
    preview?: ConversationTurnMetadata["email_preview"],
    linkedinPreview?: ConversationTurnMetadata["linkedin_preview"],
  ) => {
    setApprovalBusy(true);
    try {
      await approveTier3Proposal(
        orchestratorDeps,
        turn,
        preview,
        linkedinPreview,
      );
      toast.success("Approved and sent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Approval failed");
    } finally {
      setApprovalBusy(false);
    }
  };

  const handleStopProposal = async (turn: RoleConversationTurn) => {
    setApprovalBusy(true);
    try {
      await stopTier3Proposal(orchestratorDeps, turn);
      toast.success("Stopped — nothing was sent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't stop");
    } finally {
      setApprovalBusy(false);
    }
  };

  const handleRefineProposal = async (
    turn: RoleConversationTurn,
    preview?: ConversationTurnMetadata["email_preview"],
    linkedinPreview?: ConversationTurnMetadata["linkedin_preview"],
  ) => {
    setApprovalBusy(true);
    try {
      await refineTier3Proposal(
        orchestratorDeps,
        turn,
        "Updated the draft before sending.",
        preview,
        linkedinPreview,
      );
      toast.success("Draft updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save edits",
      );
    } finally {
      setApprovalBusy(false);
    }
  };

  const handleArchiveRole = async () => {
    try {
      // 1. Set archived_at on the deal
      await dataProvider.update("deals", {
        id: dealId,
        data: { archived_at: new Date().toISOString() },
        previousData: deal ?? { id: dealId },
      });
      // 2. Remove all deal_candidates links for this role
      //    (candidates rows are never deleted — GDPR: keep on platform)
      const { data: links } = await dataProvider.getList("deal_candidates", {
        filter: { deal_id: dealId },
        sort: { field: "id", order: "ASC" },
        pagination: { page: 1, perPage: 1000 },
      });
      if (links.length > 0) {
        await dataProvider.deleteMany("deal_candidates", {
          ids: links.map((l: { id: string | number }) => l.id),
        });
      }
      // 3. Clear role_discovery_cache for this deal
      const { data: cacheRows } = await dataProvider.getList(
        "role_discovery_cache",
        {
          filter: { deal_id: dealId },
          sort: { field: "id", order: "ASC" },
          pagination: { page: 1, perPage: 100 },
        },
      );
      if (cacheRows.length > 0) {
        await dataProvider.deleteMany("role_discovery_cache", {
          ids: cacheRows.map((r: { id: string | number }) => r.id),
        });
      }
      toast.success("Role archived");
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      navigate("/");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't archive this role",
      );
    }
  };

  const defaultTab: WorkspaceTab =
    !pipelinePending && pipelineCount > 0 ? "pipeline" : "review";

  // Sync controlled tab when pipeline data resolves (once, on first load).
  const tabInitRef = useRef(false);
  useEffect(() => {
    if (pipelinePending || tabInitRef.current) return;
    tabInitRef.current = true;
    setActiveTab(defaultTab);
  }, [pipelinePending, defaultTab]);

  // Candidates from last batch not yet in pipeline (for "Add N")
  const confidentCandidates = (lastBatch?.candidates ?? []).filter(
    (c) =>
      !pipelineExternalIds.has(c.external_id) &&
      !(c.linkedin_url && pipelineExternalIds.has(c.linkedin_url)),
  );
  const nConfident = Math.min(7, confidentCandidates.length);

  // "Continue search" is shown when any search has run; label depends on cache
  const hasCacheToken = !!deal?.role_brief_last_scroll_token;
  const hasSearchRun =
    !!deal?.role_brief_last_scroll_query || lastBatch !== null;

  return (
    <AgentHShell
      context={shellContext}
      commandBar={{
        placeholder: "Exclude Cognizant, require Python, or paste a JD…",
        hint: "Press ⌘K to focus · /refine, /exclude, /start",
        slashActions: [
          { cmd: "/refine", label: "Refine search criteria" },
          { cmd: "/exclude", label: "Exclude a company or profile type" },
          { cmd: "/start", label: "Start or restart sourcing" },
        ],
        onSubmit: (v) => {
          if (commandBusy || sourcingInFlight) return;
          void runFreeTextCommand(v);
        },
        busy: commandBusy || sourcingInFlight,
      }}
    >
      {/* 3-pane: memory panel (desktop) + main content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Role Memory Panel — desktop left sidebar */}
        {memoryPanelOpen ? (
          <aside className="hidden lg:flex flex-col w-64 xl:w-72 shrink-0 border-r border-border overflow-y-auto bg-sidebar/30">
            <RoleMemoryPanel
              dealId={dealId}
              deal={deal}
              pipelineCount={pipelineCount}
              onRefine={runFreeTextCommand}
              commandBusy={commandBusy}
              onClose={() => setMemoryPanelOpen(false)}
              lastBatch={lastBatch}
            />
          </aside>
        ) : (
          <button
            type="button"
            className="hidden lg:flex items-center justify-center w-6 shrink-0 border-r border-border hover:bg-accent text-muted-foreground"
            onClick={() => setMemoryPanelOpen(true)}
            aria-label="Open role memory panel"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Main content column */}
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
          {/* Role header — always visible above tabs */}
          <div className="max-w-4xl mx-auto w-full px-6 pt-6 pb-2">
            <RoleWorkspaceHeader
              deal={deal}
              dealStages={dealStages}
              pipelineCount={pipelineCount}
              hasCacheToken={hasCacheToken}
              hasSearchRun={hasSearchRun}
              commandBusy={commandBusy || sourcingInFlight}
              nConfident={nConfident}
              confidentCandidates={confidentCandidates}
              onAddCandidates={() => setAddCandidatesOpen(true)}
              onContinueSearch={handleContinueSearch}
              onAddNConfident={() => handleAddNConfident(confidentCandidates)}
              onSettings={() => setSettingsOpen(true)}
              onArchive={() => setArchiveConfirmOpen(true)}
              onToggleSourcingPause={handleToggleSourcingPause}
            />

            {showLinkedInBanner && (
              <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/40 px-3 py-2 text-sm mt-3">
                <span className="flex-1 text-amber-800 dark:text-amber-300">
                  LinkedIn is not connected —{" "}
                  <button
                    type="button"
                    className="underline font-medium"
                    onClick={() => navigate("/preferences?tab=accounts")}
                  >
                    connect in Preferences
                  </button>
                </span>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  aria-label="Dismiss LinkedIn banner"
                  onClick={() => {
                    sessionStorage.setItem("linkedin_banner_dismissed", "1");
                    setLinkedInBannerDismissed(true);
                  }}
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* Transcript — shared above tabs */}
          <div className="max-w-4xl mx-auto w-full px-6 pt-2">
            <RoleConversationTranscript
              dealId={dealId}
              onApprove={handleApproveProposal}
              onStop={handleStopProposal}
              onRefine={handleRefineProposal}
              actionBusy={approvalBusy || commandBusy}
              onCalibrationYes={handleCalibrationYes}
              onCalibrationNo={handleCalibrationNo}
              hideCardTurns={
                lastBatch !== null && lastBatch.candidates.length > 0
              }
              onOpenReview={() => setActiveTab("review")}
            />
          </div>

          {/* Three-tab spine: Review / Pipeline / Search */}
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as WorkspaceTab)}
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="border-b border-border bg-background sticky top-0 z-10">
              <div className="max-w-4xl mx-auto px-6">
                <TabsList className="h-auto gap-0 bg-transparent p-0 rounded-none">
                  {(
                    [
                      { value: "review", label: "Review" },
                      { value: "pipeline", label: "Pipeline" },
                      { value: "build-search", label: "Search" },
                    ] as const
                  ).map(({ value, label }) => (
                    <TabsTrigger
                      key={value}
                      value={value}
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--orange-active)] data-[state=active]:text-[var(--orange-active)] data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </div>

            {/* Review tab — sourced/calibration CandidateCards */}
            <TabsContent value="review" className="flex-1 mt-0 overflow-y-auto">
              <div className="max-w-4xl mx-auto px-6 py-6">
                {sourcingInFlight ? (
                  <p className="text-sm text-muted-foreground animate-pulse">
                    Sourcing candidates — this usually takes 30–90 seconds.
                    Results will appear here automatically.
                  </p>
                ) : lastBatch && lastBatch.candidates.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-muted-foreground">
                      {lastBatch.candidates.length} candidate
                      {lastBatch.candidates.length === 1 ? "" : "s"} from the
                      latest search — add the ones you like to Pipeline.
                    </p>
                    <ul className="flex flex-col gap-3 list-none p-0 m-0">
                      {lastBatch.candidates.map((c) => (
                        <li key={c.external_id}>
                          <CandidateCard
                            density="queue"
                            name={c.name}
                            headline={c.headline}
                            location={c.location_name}
                            fitScore={c.match_score}
                            whyFit={c.why_fit}
                            mustHaves={c.must_haves}
                            linkedinUrl={c.linkedin_url}
                            photoUrl={c.photo_url}
                            onAddToPipeline={
                              pipelineExternalIds.has(c.external_id)
                                ? undefined
                                : () => handleAddCardToPipeline(c)
                            }
                            pipelineSaveState={
                              pipelineExternalIds.has(c.external_id)
                                ? "saved"
                                : (cardSaveStates.get(c.external_id) ?? "idle")
                            }
                            onContact={
                              pipelineExternalIds.has(c.external_id) &&
                              c.linkedin_url &&
                              dbIdByLinkedinUrl.has(c.linkedin_url)
                                ? () => handleContactEnrich(c)
                                : undefined
                            }
                            contactState={
                              contactStates.get(c.external_id) ?? "idle"
                            }
                            contactData={
                              contactDataMap.get(c.external_id) ?? null
                            }
                          />
                        </li>
                      ))}
                    </ul>
                    {/* Calibration actions */}
                    <div className="flex gap-2 flex-wrap pt-2 border-t border-dashed">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleCalibrationYes}
                        disabled={commandBusy}
                        className="text-xs"
                      >
                        These look right — show more
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleCalibrationNo}
                        disabled={commandBusy}
                        className="text-xs text-muted-foreground"
                      >
                        Not a fit
                      </Button>
                      {hasCacheToken && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleContinueSearch}
                          disabled={commandBusy || sourcingInFlight}
                          className="text-xs ml-auto"
                        >
                          <Sparkles className="h-3.5 w-3.5 mr-1" />
                          Show more from search
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4 py-12 text-center">
                    <p className="text-sm text-muted-foreground max-w-sm">
                      No candidates yet — start sourcing to see results here.
                    </p>
                    <div className="flex gap-2 flex-wrap justify-center">
                      <Button
                        size="sm"
                        onClick={handleContinueSearch}
                        disabled={commandBusy || sourcingInFlight}
                      >
                        <Sparkles className="h-4 w-4 mr-1.5" />
                        Start sourcing
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAddCandidatesOpen(true)}
                      >
                        <UserPlus className="h-4 w-4 mr-1.5" />
                        Add candidates
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Pipeline tab — review table + notes */}
            <TabsContent
              value="pipeline"
              className="flex-1 mt-0 overflow-y-auto"
            >
              <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col gap-6">
                <div className="ah-panel p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium tracking-wide uppercase text-muted-foreground">
                      Pipeline
                    </h3>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAddCandidatesOpen(true)}
                    >
                      <Upload className="h-4 w-4 mr-1.5" />
                      Add candidates
                    </Button>
                  </div>
                  <CandidateReviewTable
                    dealId={dealId}
                    onContactRequested={async (candidateId, name) => {
                      await proposeOutreachAfterPipelineAdd(
                        orchestratorDeps,
                        Number(candidateId),
                        name,
                      );
                    }}
                  />
                </div>

                <div className="ah-panel p-6">
                  <h3 className="text-sm font-medium tracking-wide uppercase text-muted-foreground mb-3">
                    Notes
                  </h3>
                  <InfiniteListBase
                    resource="deal_notes"
                    filter={{ deal_id: dealId }}
                    sort={{ field: "date", order: "DESC" }}
                    perPage={25}
                    disableSyncWithLocation
                    storeKey={false}
                    empty={<NoteCreate reference="deals" />}
                  >
                    <NotesIterator reference="deals" />
                  </InfiniteListBase>
                </div>
              </div>
            </TabsContent>

            {/* Search tab */}
            <TabsContent
              value="build-search"
              className="flex-1 mt-0 overflow-y-auto"
            >
              <BuildSearchTab deal={deal} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Add candidates modal */}
      <AddCandidatesModal
        dealId={dealId}
        open={addCandidatesOpen}
        onOpenChange={setAddCandidatesOpen}
      />

      {/* Understand sourcing dialog */}

      {/* Role settings dialog */}
      {settingsOpen && (
        <RoleSettingsDialog
          dealId={dealId}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      )}

      {/* Archive confirm dialog */}
      <Dialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Archive this role?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The role and all its sourcing history will be archived. Candidates
            already on the platform are kept — only the link to this role is
            removed.
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setArchiveConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setArchiveConfirmOpen(false);
                void handleArchiveRole();
              }}
            >
              Archive role
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AgentHShell>
  );
};

/* ------------------------------------------------------------------ */
/* Role header                                                         */
/* ------------------------------------------------------------------ */

type RoleWorkspaceHeaderProps = {
  deal: Deal | undefined;
  dealStages: { value: string; label: string }[];
  pipelineCount: number;
  hasCacheToken: boolean;
  hasSearchRun: boolean;
  commandBusy: boolean;
  nConfident: number;
  confidentCandidates: CalibrationCandidate[];
  onAddCandidates: () => void;
  onContinueSearch: () => void;
  onAddNConfident: () => void;
  onSettings: () => void;
  onArchive: () => void;
  onToggleSourcingPause: () => void;
};

const RoleWorkspaceHeader = ({
  deal,
  dealStages,
  hasCacheToken,
  hasSearchRun,
  commandBusy,
  nConfident,
  onAddCandidates,
  onContinueSearch,
  onAddNConfident,
  onSettings,
  onArchive,
  onToggleSourcingPause,
}: RoleWorkspaceHeaderProps) => {
  const [linkCopied, setLinkCopied] = useState(false);
  if (!deal) return null;

  const handleCopyApplicationLink = async () => {
    if (!deal.public_application_token) return;
    const url = `${window.location.origin}/apply/${deal.public_application_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const stateText = deal.sourcing_paused
    ? "Paused"
    : hasSearchRun
      ? "Actively searching"
      : "Ready to search";

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight truncate">
          {deal.name}
        </h1>
        <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground flex-wrap">
          <Badge variant="outline" className="text-xs">
            {findDealLabel(dealStages, deal.stage)}
          </Badge>
          <span className="text-xs">{stateText}</span>
          {deal.expected_closing_date &&
            isValid(new Date(deal.expected_closing_date)) && (
              <span>
                Target: {formatISODateString(deal.expected_closing_date)}
              </span>
            )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
        {/* Situational: add N confident candidates when cache has unreviewed */}
        {nConfident > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={onAddNConfident}
            disabled={commandBusy}
            className="text-xs"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            Add {nConfident} candidate{nConfident === 1 ? "" : "s"}
          </Button>
        )}

        {/* Situational: continue / show more when a search has run */}
        {hasSearchRun && (
          <Button
            size="sm"
            variant="outline"
            onClick={onContinueSearch}
            disabled={commandBusy}
            className="text-xs"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            {hasCacheToken ? "Show more" : "Continue search"}
          </Button>
        )}

        {/* Primary CTA — always visible */}
        <Button size="sm" onClick={onAddCandidates} className="text-xs">
          <UserPlus className="h-3.5 w-3.5 mr-1" />
          Add candidates
        </Button>

        {/* Overflow menu — secondary actions */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label="More options"
              className="px-2"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={onToggleSourcingPause}>
              {deal.sourcing_paused ? (
                <>
                  <PlayCircle className="h-4 w-4 mr-2" />
                  Resume sourcing
                </>
              ) : (
                <>
                  <PauseCircle className="h-4 w-4 mr-2" />
                  Pause sourcing
                </>
              )}
            </DropdownMenuItem>
            {deal.public_application_token && (
              <DropdownMenuItem onClick={handleCopyApplicationLink}>
                <Link2 className="h-4 w-4 mr-2" />
                {linkCopied ? "Copied!" : "Copy application link"}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onSettings}>
              <Settings className="h-4 w-4 mr-2" />
              Role settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onArchive}
              className="text-destructive focus:text-destructive"
            >
              <Archive className="h-4 w-4 mr-2" />
              Archive role
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Add Candidates Modal                                                */
/* ------------------------------------------------------------------ */

const AddCandidatesModal = ({
  dealId,
  open,
  onOpenChange,
}: {
  dealId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>Add candidates</DialogTitle>
      </DialogHeader>
      <Tabs defaultValue="upload" className="mt-2">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="upload">Upload resumes</TabsTrigger>
          <TabsTrigger value="one">One person</TabsTrigger>
        </TabsList>
        <TabsContent value="upload" className="mt-4">
          <BulkResumeUploadPanel dealId={dealId} />
        </TabsContent>
        <TabsContent value="one" className="mt-4">
          <ManualResumeUploadPanel dealId={dealId} />
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>
);

/* ------------------------------------------------------------------ */
/* Manual resume upload (one person)                                   */
/* ------------------------------------------------------------------ */

type UploadState = "idle" | "uploading" | "done" | "error";

const ManualResumeUploadPanel = ({ dealId }: { dealId: string }) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !resumeFile) {
      setErrorMessage("Full name and a resume file are required.");
      return;
    }
    setState("uploading");
    setErrorMessage(null);
    try {
      await dataProvider.uploadCandidateResume(dealId, {
        fullName: fullName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        resumeFile,
      });
      setState("done");
      setFullName("");
      setEmail("");
      setPhone("");
      setResumeFile(null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to upload this resume",
      );
      setState("error");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="manual-full-name">Full name</Label>
          <Input
            id="manual-full-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="manual-email">Email (optional)</Label>
          <Input
            id="manual-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="manual-phone">Phone (optional)</Label>
          <Input
            id="manual-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="manual-resume">Resume (PDF, Word, or RTF)</Label>
        <Input
          id="manual-resume"
          type="file"
          accept=".pdf,.doc,.docx,.rtf"
          onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
        />
      </div>
      {errorMessage && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}
      {state === "done" && (
        <p className="text-sm text-muted-foreground">
          Candidate added to this role's pipeline.
        </p>
      )}
      <div>
        <Button type="submit" size="sm" disabled={state === "uploading"}>
          {state === "uploading" ? "Uploading..." : "Add candidate"}
        </Button>
      </div>
    </form>
  );
};

/* ------------------------------------------------------------------ */
/* Bulk resume upload with drag-and-drop                               */
/* ------------------------------------------------------------------ */

type BulkUploadState = "idle" | "uploading" | "done" | "error";

type BulkUploadFileResult = {
  filename: string;
  status: "created" | "linked_existing" | "failed";
  candidate_id?: number;
  parsed_name?: string | null;
  parsed_email?: string | null;
  error?: string;
};

const BulkResumeUploadPanel = ({ dealId }: { dealId: string }) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [files, setFiles] = useState<File[]>([]);
  const [state, setState] = useState<BulkUploadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [results, setResults] = useState<BulkUploadFileResult[] | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const accepted = Array.from(incoming).filter((f) =>
      /\.(pdf|doc|docx|rtf)$/i.test(f.name),
    );
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...accepted.filter((f) => !names.has(f.name))];
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) {
      setErrorMessage("Choose at least one resume file.");
      return;
    }
    setState("uploading");
    setErrorMessage(null);
    setResults(null);
    try {
      const response = await dataProvider.bulkUploadCandidateResumes(
        dealId,
        files,
      );
      setResults(response.results);
      setState("done");
      setFiles([]);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to upload these resumes",
      );
      setState("error");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {/* Drag-and-drop zone */}
      <div
        ref={dropRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-sm transition-colors cursor-pointer ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-muted-foreground/40"
        }`}
        onClick={() => document.getElementById("bulk-resumes-input")?.click()}
        aria-label="Drop resumes here or click to browse"
      >
        <Upload className="h-8 w-8 text-muted-foreground/50" />
        <p className="font-medium text-muted-foreground">
          Drop resumes here or{" "}
          <span className="text-primary underline">browse</span>
        </p>
        <p className="text-xs text-muted-foreground">
          PDF, Word, or RTF — up to 25 files
        </p>
        <input
          id="bulk-resumes-input"
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.rtf"
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">
            {files.length} file{files.length === 1 ? "" : "s"} selected
          </p>
          <ul className="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
            {files.map((f, i) => (
              <li key={i} className="flex items-center justify-between text-xs">
                <span className="truncate text-foreground">{f.name}</span>
                <button
                  type="button"
                  className="ml-2 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() =>
                    setFiles((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {errorMessage && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}
      <Button
        type="submit"
        size="sm"
        disabled={state === "uploading" || files.length === 0}
      >
        {state === "uploading"
          ? `Uploading ${files.length} file${files.length === 1 ? "" : "s"}...`
          : `Upload ${files.length > 0 ? files.length : ""} resume${files.length === 1 ? "" : "s"}`}
      </Button>

      {results && (
        <div className="flex flex-col gap-2 pt-2 border-t">
          <p className="text-xs text-muted-foreground">
            {results.filter((r) => r.status !== "failed").length} of{" "}
            {results.length} added
          </p>
          <ul className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
            {results.map((r, i) => (
              <li key={i} className="text-xs flex items-center gap-2">
                <span
                  className={
                    r.status === "failed"
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  {r.status === "failed"
                    ? "Failed"
                    : r.status === "created"
                      ? "Added"
                      : "Already known"}
                </span>
                <span className="font-medium">
                  {r.parsed_name ?? r.filename}
                </span>
                {r.parsed_email && (
                  <span className="text-muted-foreground">
                    {r.parsed_email}
                  </span>
                )}
                {r.error && (
                  <span className="text-destructive">— {r.error}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
};

/* ------------------------------------------------------------------ */
/* Role Settings Dialog (expanded)                                     */
/* ------------------------------------------------------------------ */

const RoleSettingsDialog = ({
  dealId,
  open,
  onOpenChange,
}: {
  dealId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) => {
  const [section, setSection] = useState<"coordinator">("coordinator");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Role settings</DialogTitle>
        </DialogHeader>
        <div className="flex gap-4 mt-2 min-h-64">
          {/* Sidebar nav */}
          <nav className="flex flex-col gap-1 w-36 shrink-0">
            {(
              [
                { key: "coordinator", label: "Coordinator" },
                // Autopilot is not yet a live feature — hidden from nav
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setSection(key)}
                className={`text-left text-sm rounded px-2 py-1.5 transition-colors ${
                  section === key
                    ? "bg-accent font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <Separator orientation="vertical" />

          <div className="flex-1 min-w-0">
            {section === "coordinator" && (
              <CoordinatorSettings dealId={dealId} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/* ------------------------------------------------------------------ */
/* Coordinator settings — persisted to the deal row                   */
/* ------------------------------------------------------------------ */

const CoordinatorSettings = ({ dealId }: { dealId: string }) => {
  const dataProvider = useDataProvider();
  const queryClient = useQueryClient();
  const deal = useRecordContext<Deal>();

  const saved = deal?.coordinator_settings ?? {};
  const [knowledgeBase, setKnowledgeBase] = useState(
    saved.knowledge_base ?? "",
  );
  const [calendarLink, setCalendarLink] = useState(saved.calendar_link ?? "");
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setSavedOk(false);
    try {
      await dataProvider.update("deals", {
        id: dealId,
        data: {
          coordinator_settings: {
            knowledge_base: knowledgeBase,
            calendar_link: calendarLink,
            reply_mode: "draft",
          },
        },
        previousData: deal ?? { id: dealId },
      });
      void queryClient.invalidateQueries({ queryKey: ["deals", dealId] });
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save settings",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Agent H drafts every reply for your approval before anything sends.
      </p>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium" htmlFor="coord-kb">
          Knowledge base
        </label>
        <p className="text-xs text-muted-foreground">
          Role context Agent H uses when responding to candidates — FAQs,
          process steps, important details.
        </p>
        <Textarea
          id="coord-kb"
          placeholder="e.g. This is a full-time remote role. Interview process: recruiter screen → technical → founder chat. Salary: $120k–$150k…"
          rows={5}
          value={knowledgeBase}
          onChange={(e) => setKnowledgeBase(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium" htmlFor="coord-cal">
          Calendar link
        </label>
        <Input
          id="coord-cal"
          type="url"
          placeholder="https://cal.com/your-link"
          value={calendarLink}
          onChange={(e) => setCalendarLink(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button className="self-start" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {savedOk && (
          <span className="text-sm text-muted-foreground">Saved.</span>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Role Memory Panel (left sidebar on desktop)                        */
/* ------------------------------------------------------------------ */

const RoleMemoryPanel = ({
  dealId,
  deal,
  pipelineCount,
  onClose,
  lastBatch,
}: {
  dealId: string;
  deal: Deal | undefined;
  pipelineCount: number;
  /** @deprecated Refine textarea removed — use command bar */
  onRefine?: (text: string) => void;
  /** @deprecated Refine textarea removed — use command bar */
  commandBusy?: boolean;
  onClose: () => void;
  lastBatch: CalibrationBatch | null;
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  // Toggle SearchIntentEditor in the T6 Sourcing criteria block.
  const [editingIntent, setEditingIntent] = useState(false);
  const [intentSaving, setIntentSaving] = useState(false);

  const { data: calibrationFeedback = [] } = useQuery({
    queryKey: ["calibration_feedback", dealId],
    queryFn: () => dataProvider.getCalibrationFeedback(dealId),
  });

  const negativeFeedback = (calibrationFeedback as Record<string, unknown>[])
    .filter((f) => f.judgment === "not_a_fit" || f.judgment === "no")
    .slice(0, 5);

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Role memory
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-0.5 rounded"
          aria-label="Close role memory panel"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-4 p-3 overflow-y-auto flex-1 text-sm">
        {/* Pipeline stats */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Pipeline
          </p>
          <p className="text-2xl font-bold tabular-nums">{pipelineCount}</p>
          <p className="text-xs text-muted-foreground">
            candidate{pipelineCount === 1 ? "" : "s"} added
          </p>
        </div>

        {/* T6: Search Intent block — rendered from deal.role_brief_search_intent.
            Switches between read-only SearchIntentDisplay and editable SearchIntentEditor. */}
        {deal !== undefined && (
          <>
            <Separator />
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Sourcing criteria
                </p>
                <button
                  type="button"
                  onClick={() => setEditingIntent((v) => !v)}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={
                    editingIntent ? "Close editor" : "Edit sourcing criteria"
                  }
                >
                  {editingIntent ? "Close" : "Edit"}
                </button>
              </div>
              {editingIntent ? (
                <SearchIntentEditor
                  initialConditions={
                    deal.role_brief_search_intent?.current?.conditions ?? []
                  }
                  initialUnenforceable={
                    deal.role_brief_search_intent?.current
                      ?.unenforceable_constraints ?? []
                  }
                  saveLabel="Save"
                  saving={intentSaving}
                  onSave={async (conditions, unenforced) => {
                    if (!deal?.id) return;
                    setIntentSaving(true);
                    try {
                      await dataProvider.saveSearchIntent(
                        deal.id,
                        conditions,
                        unenforced,
                      );
                      await queryClient.invalidateQueries({
                        queryKey: ["deals", String(deal.id)],
                      });
                      setEditingIntent(false);
                    } catch {
                      // error shown by dataProvider
                    } finally {
                      setIntentSaving(false);
                    }
                  }}
                />
              ) : deal?.role_brief_search_intent?.current ? (
                <SearchIntentDisplay
                  current={deal.role_brief_search_intent.current}
                  history={deal.role_brief_search_intent.history ?? []}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  No sourcing criteria yet. Click Edit to add chips, or start
                  sourcing to auto-generate them.
                </p>
              )}
            </div>
          </>
        )}

        {/* Rejection learnings */}
        {negativeFeedback.length > 0 && (
          <>
            <Separator />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Not-a-fit patterns
              </p>
              <ul className="space-y-1">
                {negativeFeedback.map((f, i) => (
                  <li
                    key={i}
                    className="text-xs text-muted-foreground leading-snug break-words"
                  >
                    • {(f.rejection_reason ?? f.reason ?? "—") as string}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        {/* Search pool stats */}
        {lastBatch && (
          <>
            <Separator />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Search pool
              </p>
              <dl className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Pool size</dt>
                  <dd className="font-medium tabular-nums">
                    {lastBatch.pool_size}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Reviewed</dt>
                  <dd className="font-medium tabular-nums">
                    {lastBatch.cursor}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Remaining</dt>
                  <dd
                    className={`font-medium tabular-nums ${lastBatch.pool_exhausted ? "text-muted-foreground" : "text-green-600"}`}
                  >
                    {lastBatch.pool_exhausted
                      ? "Exhausted"
                      : Math.max(0, lastBatch.pool_size - lastBatch.cursor)}
                  </dd>
                </div>
              </dl>
            </div>
          </>
        )}

        <Separator />

        {/* Refine hint — use the command bar below to adjust search criteria */}
        <div>
          <p className="text-xs text-muted-foreground">
            To refine your search criteria, use the command bar — type what you
            want to add, change, or exclude.
          </p>
        </div>
      </div>
    </div>
  );
};

RoleWorkspacePage.path = "/roles/:id";
