// Role Workspace (2026-07-26): Noon-inspired 3-pane layout.
// Left: AppShell rail (existing). Middle: Role memory panel (desktop).
// Main: header buttons + transcript + tabs.
// All T1-T6 behaviour preserved.
import { isValid } from "date-fns";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
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
import { EditButton } from "@/components/admin/edit-button";
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
import { SearchIntentDisplay } from "./SearchIntentDisplay";
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

type WorkspaceTab = "sourcing" | "review" | "build-search";

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
  // True while a sourcing call is in flight (prevents double-trigger).
  const [sourcingInFlight, setSourcingInFlight] = useState(false);
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
    !pipelinePending && pipelineCount > 0 ? "review" : "sourcing";

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
    <AgentHShell context={shellContext}>
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
            />
          </div>

          {/* Two-tab spine */}
          <Tabs
            defaultValue={defaultTab}
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="border-b border-border bg-background sticky top-0 z-10">
              <div className="max-w-4xl mx-auto px-6">
                <TabsList className="h-auto gap-0 bg-transparent p-0 rounded-none">
                  {(
                    [
                      { value: "sourcing", label: "Sourcing" },
                      { value: "review", label: "Review & Contact" },
                      { value: "build-search", label: "Build search" },
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

            {/* Sourcing tab — simplified; Add candidates is now in the header */}
            <TabsContent
              value="sourcing"
              className="flex-1 mt-0 overflow-y-auto"
            >
              <div className="max-w-4xl mx-auto px-6 py-8 flex flex-col items-center gap-4 text-center">
                {sourcingInFlight ? (
                  <p className="text-sm text-muted-foreground max-w-sm animate-pulse">
                    Sourcing candidates — this can take 30–90 seconds. You can
                    stay on this page; no need to refresh.
                  </p>
                ) : hasSearchRun ? (
                  <>
                    <p className="text-sm text-muted-foreground max-w-sm">
                      Use the Role Memory panel to refine your search, or add
                      candidates manually with the{" "}
                      <strong>Add candidates</strong> button above.
                    </p>
                    {hasCacheToken && (
                      <Button
                        size="sm"
                        onClick={handleContinueSearch}
                        disabled={commandBusy || sourcingInFlight}
                      >
                        <Sparkles className="h-4 w-4 mr-1.5" />
                        Show more from search
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground max-w-sm">
                      No search run yet. Start sourcing to find candidates, or
                      add them manually.
                    </p>
                    <div className="flex gap-2 flex-wrap justify-center">
                      <Button
                        size="sm"
                        onClick={handleContinueSearch}
                        disabled={commandBusy || sourcingInFlight}
                      >
                        <Sparkles className="h-4 w-4 mr-1.5" />
                        {sourcingInFlight ? "Sourcing…" : "Start sourcing"}
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
                  </>
                )}
              </div>
            </TabsContent>

            {/* Build search tab */}
            <TabsContent
              value="build-search"
              className="flex-1 mt-0 overflow-y-auto"
            >
              <BuildSearchTab deal={deal} />
            </TabsContent>

            {/* Review & Contact tab */}
            <TabsContent value="review" className="flex-1 mt-0 overflow-y-auto">
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
          {deal.sourcing_paused && (
            <Badge
              variant="secondary"
              className="text-xs text-amber-700 bg-amber-100 border-amber-200"
            >
              Sourcing paused
            </Badge>
          )}
          {deal.expected_closing_date &&
            isValid(new Date(deal.expected_closing_date)) && (
              <span>
                Target: {formatISODateString(deal.expected_closing_date)}
              </span>
            )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
        {/* Add N confident candidates — only when cache has unreviewed people */}
        {nConfident > 0 && (
          <Button
            size="sm"
            onClick={onAddNConfident}
            disabled={commandBusy}
            className="text-xs"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            Add {nConfident} confident candidate{nConfident === 1 ? "" : "s"}
          </Button>
        )}

        {/* Continue search — shown when any search has run */}
        {hasSearchRun && (
          <Button
            size="sm"
            variant={hasCacheToken ? "default" : "outline"}
            onClick={onContinueSearch}
            disabled={commandBusy}
            className="text-xs"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            {hasCacheToken ? "Show more candidates" : "Continue search"}
          </Button>
        )}

        {/* Add candidates */}
        <Button
          size="sm"
          variant="outline"
          onClick={onAddCandidates}
          className="text-xs"
        >
          <UserPlus className="h-3.5 w-3.5 mr-1" />
          Add candidates
        </Button>

        {/* Pause / Resume sourcing */}
        <Button
          size="sm"
          variant={deal.sourcing_paused ? "destructive" : "ghost"}
          onClick={onToggleSourcingPause}
          className="text-xs px-2"
          title={deal.sourcing_paused ? "Resume sourcing" : "Pause sourcing"}
        >
          {deal.sourcing_paused ? "Resume sourcing" : "Pause sourcing"}
        </Button>

        {/* Copy application link */}
        {deal.public_application_token && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyApplicationLink}
            className="text-xs"
          >
            {linkCopied ? "Copied!" : "Copy link"}
          </Button>
        )}

        {/* Role settings */}
        <Button
          variant="ghost"
          size="sm"
          aria-label="Role settings"
          onClick={onSettings}
          className="px-2"
        >
          <Settings className="h-4 w-4" />
        </Button>

        {/* Archive role */}
        <Button
          variant="ghost"
          size="sm"
          aria-label="Archive role"
          onClick={onArchive}
          className="px-2 text-muted-foreground hover:text-destructive"
          title="Archive role"
        >
          <Archive className="h-4 w-4" />
        </Button>

        <EditButton />
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
  const [section, setSection] = useState<"coordinator" | "autopilot">(
    "coordinator",
  );

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
                { key: "autopilot", label: "Autopilot" },
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
            {section === "autopilot" && <AutopilotSettings />}
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
/* Autopilot settings — honest "off" stub                             */
/* ------------------------------------------------------------------ */

const AutopilotSettings = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center gap-3 rounded-lg border border-border p-4">
      <div className="flex-1">
        <p className="text-sm font-medium">Autopilot</p>
        <p className="text-xs text-muted-foreground mt-0.5">Off</p>
      </div>
      <Badge variant="secondary" className="text-xs">
        Disabled
      </Badge>
    </div>
    <p className="text-sm text-muted-foreground">
      Candidates remain in your review queue. Agent H drafts outreach for your
      approval — nothing sends automatically.
    </p>
  </div>
);

/* ------------------------------------------------------------------ */
/* Role Memory Panel (left sidebar on desktop)                        */
/* ------------------------------------------------------------------ */

const RoleMemoryPanel = ({
  dealId,
  deal,
  pipelineCount,
  onRefine,
  commandBusy,
  onClose,
  lastBatch,
}: {
  dealId: string;
  deal: Deal | undefined;
  pipelineCount: number;
  onRefine: (text: string) => void;
  commandBusy: boolean;
  onClose: () => void;
  lastBatch: CalibrationBatch | null;
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const [refineText, setRefineText] = useState("");

  const { data: learnedCriteria = [], refetch: refetchCriteria } = useQuery({
    queryKey: ["role_brief_learned_criteria", dealId],
    queryFn: () => dataProvider.getRoleBriefLearnedCriteria(dealId),
  });

  const { data: calibrationFeedback = [] } = useQuery({
    queryKey: ["calibration_feedback", dealId],
    queryFn: () => dataProvider.getCalibrationFeedback(dealId),
  });

  const activeCriteria = (learnedCriteria as Record<string, unknown>[]).filter(
    (c) => c.status === "active" || !c.status,
  );
  const negativeFeedback = (calibrationFeedback as Record<string, unknown>[])
    .filter((f) => f.judgment === "not_a_fit" || f.judgment === "no")
    .slice(0, 5);

  const handleRelax = async (criterionId: string | number) => {
    try {
      await dataProvider.relaxLearnedCriterion(criterionId as number);
      void refetchCriteria();
      queryClient.invalidateQueries({
        queryKey: ["role_brief_learned_criteria", dealId],
      });
    } catch {
      toast.error("Couldn't relax that criterion");
    }
  };

  const handleRefineSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!refineText.trim()) return;
    onRefine(refineText.trim());
    setRefineText("");
  };

  const dealRecord = deal as unknown as Record<string, unknown> | undefined;

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

        <Separator />

        {/* Active learned criteria */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Active criteria
          </p>
          {activeCriteria.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              None yet — calibrate to learn.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {activeCriteria.map((c) => (
                <li
                  key={c.id as string}
                  className="flex items-start gap-1.5 group"
                >
                  <span className="flex-1 text-xs leading-snug">
                    {c.label as string}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRelax(c.id as number)}
                    className="shrink-0 text-xs text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Relax this criterion"
                  >
                    Relax
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* T6: Search Intent block — rendered from deal.role_brief_search_intent
            (inline here inside the RoleMemoryPanel section, not a separate file).
            SearchIntentDisplay lives at src/components/atomic-crm/roles/SearchIntentDisplay.tsx. */}
        {deal !== undefined && (
          <>
            <Separator />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Sourcing understanding
              </p>
              {deal?.role_brief_search_intent?.current ? (
                <SearchIntentDisplay
                  current={deal.role_brief_search_intent.current}
                  history={deal.role_brief_search_intent.history ?? []}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Sourcing understanding will appear here after the first
                  search.
                </p>
              )}
            </div>
          </>
        )}

        {/* Role must-haves from deal */}
        {((dealRecord?.must_have_keywords as string[] | undefined) ?? [])
          .length > 0 && (
          <>
            <Separator />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Must-haves
              </p>
              <div className="flex flex-wrap gap-1">
                {(dealRecord!.must_have_keywords as string[]).map((k) => (
                  <Badge
                    key={k}
                    variant="outline"
                    className="text-xs py-0 break-words max-w-full"
                  >
                    {k}
                  </Badge>
                ))}
              </div>
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

        {/* Refine input */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Refine ideal candidate
          </p>
          <form onSubmit={handleRefineSubmit} className="flex flex-col gap-2">
            <Textarea
              placeholder="e.g. Must have led a team, fintech background preferred…"
              rows={3}
              className="text-xs resize-none"
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              className="self-start text-xs"
              disabled={!refineText.trim() || commandBusy}
            >
              Update criteria
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

RoleWorkspacePage.path = "/roles/:id";
