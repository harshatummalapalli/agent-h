// Role Workspace (2026-07-26): Noon-style staged tabs replacing the old
// single long vertical stack. Four tabs: Sourcing → Review & Contact →
// Coordinator → AI Interviewer. Default tab is Sourcing when the
// pipeline is empty; Review & Contact when candidates already exist.
// All existing orchestrator / AgentHShell / outreach logic is preserved —
// only the layout changes.
import { isValid } from "date-fns";
import { useMemo, useState } from "react";
import {
  InfiniteListBase,
  ShowBase,
  useDataProvider,
  useGetList,
  useRecordContext,
} from "ra-core";
import { useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditButton } from "@/components/admin/edit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { DealCandidatesSection } from "../deals/DealCandidatesSection";
import { findDealLabel, formatISODateString } from "../deals/dealUtils";
import { NoteCreate } from "../notes/NoteCreate";
import { NotesIterator } from "../notes/NotesIterator";
import type { CrmDataProvider } from "../providers/types";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { SourceCandidatesPage } from "../sourcing/SourceCandidatesPage";
import { AgentHShell } from "../shell/AgentHShell";
import { RoleConversationTranscript } from "../shell/RoleConversationTranscript";
import { useRoleShellContext } from "../shell/useShellContext";
import {
  approveTier3Proposal,
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

type WorkspaceTab = "sourcing" | "review" | "coordinator" | "interviewer";

const RoleWorkspaceContent = ({ dealId }: { dealId: string }) => {
  const navigate = useNavigate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const { dealStages } = useConfigurationContext();
  const deal = useRecordContext<Deal>();
  const [commandBusy, setCommandBusy] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [linkedInBannerDismissed, setLinkedInBannerDismissed] = useState(
    () =>
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem("linkedin_banner_dismissed") === "1",
  );
  const { data: openDeals } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 20 },
    sort: { field: "updated_at", order: "DESC" },
    filter: { "archived_at@is": null },
  });
  const { total: pipelineCount = 0, isPending: pipelinePending } = useGetList(
    "deal_candidates",
    {
      pagination: { page: 1, perPage: 1 },
      filter: { deal_id: dealId },
    },
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

  const pipelineCandidates = useMemo<ParseCandidateRef[]>(
    () =>
      (pipelineRows ?? []).map(({ candidate }) => {
        const name =
          [candidate.first_name, candidate.last_name]
            .filter(Boolean)
            .join(" ") || `Candidate #${candidate.id}`;
        return { id: Number(candidate.id), name };
      }),
    [pipelineRows],
  );

  const shellContext = useRoleShellContext({
    deal,
    dealStages,
    pipelineCount,
    isPending: !deal || pipelinePending,
  });

  const orchestratorDeps: RoleAgentOrchestratorDeps = useMemo(
    () => ({
      dealId,
      deal,
      openDeals: openDeals ?? [],
      dataProvider,
      queryClient,
      navigate,
      pipelineCandidates,
      selectedCandidates: [],
      invalidateTranscript: () => {
        queryClient.invalidateQueries({
          queryKey: ["role_conversation_turns"],
        });
      },
    }),
    [
      deal,
      dealId,
      dataProvider,
      navigate,
      openDeals,
      pipelineCandidates,
      queryClient,
    ],
  );

  const runFreeTextCommand = async (commandText: string) => {
    setCommandBusy(true);
    try {
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

  // Default tab: if candidates exist show Review & Contact, else Sourcing
  const defaultTab: WorkspaceTab =
    !pipelinePending && pipelineCount > 0 ? "review" : "sourcing";

  return (
    <AgentHShell
      context={shellContext}
      commandBar={{
        placeholder: "Tell Agent H what you need for this role",
        hint: "Try: \u201cfind more candidates like these\u201d or \u201crelax the Python requirement\u201d.",
        slashActions: [
          { cmd: "/relax", label: "Relax a criterion on this role" },
        ],
        onSubmit: runFreeTextCommand,
      }}
    >
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
        {/* Role header — always visible above tabs */}
        <div className="max-w-4xl mx-auto w-full px-6 pt-6 pb-2">
          <RoleWorkspaceHeader />

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

        {/* Staged tabs */}
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
                    { value: "coordinator", label: "Coordinator" },
                    { value: "interviewer", label: "AI Interviewer" },
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

          {/* Sourcing */}
          <TabsContent value="sourcing" className="flex-1 mt-0 overflow-y-auto">
            <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col gap-6">
              <RoleConversationTranscript
                dealId={dealId}
                onApprove={handleApproveProposal}
                onStop={handleStopProposal}
                onRefine={handleRefineProposal}
                actionBusy={approvalBusy || commandBusy}
              />

              <SourceCandidatesPage
                initialRoleBriefId={dealId}
                onCandidateSaved={(candidateId, name) => {
                  void proposeOutreachAfterPipelineAdd(
                    orchestratorDeps,
                    candidateId,
                    name,
                  );
                }}
              />

              <div className="ah-panel p-6 flex flex-col gap-6">
                <ManualResumeUploadPanel dealId={dealId} />
                <Separator />
                <BulkResumeUploadPanel dealId={dealId} />
              </div>
            </div>
          </TabsContent>

          {/* Review & Contact */}
          <TabsContent value="review" className="flex-1 mt-0 overflow-y-auto">
            <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col gap-6">
              <div className="ah-panel p-6">
                <DealCandidatesSection dealId={dealId} />
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

          {/* Coordinator */}
          <TabsContent
            value="coordinator"
            className="flex-1 mt-0 overflow-y-auto"
          >
            <div className="max-w-2xl mx-auto px-6 py-8">
              <CoordinatorPlaceholder />
            </div>
          </TabsContent>

          {/* AI Interviewer */}
          <TabsContent
            value="interviewer"
            className="flex-1 mt-0 overflow-y-auto"
          >
            <div className="max-w-2xl mx-auto px-6 py-16 text-center flex flex-col items-center gap-4">
              <div className="text-4xl">🎙</div>
              <h2 className="text-lg font-semibold text-foreground">
                AI Interviewer
              </h2>
              <p className="text-sm text-muted-foreground max-w-xs">
                Automated voice interviews and async screening are coming in
                Phase 2. Set up your Coordinator in the meantime.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AgentHShell>
  );
};

/* ------------------------------------------------------------------ */
/* Role header                                                          */
/* ------------------------------------------------------------------ */

const RoleWorkspaceHeader = () => {
  const { dealStages } = useConfigurationContext();
  const record = useRecordContext<Deal>();
  const [linkCopied, setLinkCopied] = useState(false);
  if (!record) return null;

  const handleCopyApplicationLink = async () => {
    if (!record.public_application_token) return;
    const url = `${window.location.origin}/apply/${record.public_application_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex items-start justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{record.name}</h1>
        <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
          <Badge variant="outline" className="text-xs">
            {findDealLabel(dealStages, record.stage)}
          </Badge>
          {record.expected_closing_date &&
            isValid(new Date(record.expected_closing_date)) && (
              <span>
                Target close:{" "}
                {formatISODateString(record.expected_closing_date)}
              </span>
            )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {record.public_application_token && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyApplicationLink}
          >
            {linkCopied ? "Link copied!" : "Copy application link"}
          </Button>
        )}
        <EditButton />
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Coordinator placeholder                                             */
/* ------------------------------------------------------------------ */

const CoordinatorPlaceholder = () => {
  const [knowledgeBase, setKnowledgeBase] = useState("");
  const [calendarLink, setCalendarLink] = useState("");
  const [mode, setMode] = useState<"draft" | "auto">("draft");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold">Coordinator setup</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure how Agent H handles candidate communication for this role.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor="kb">
            Knowledge base
          </label>
          <p className="text-xs text-muted-foreground">
            Role context Agent H uses when responding to candidates — FAQs,
            process steps, important details.
          </p>
          <Textarea
            id="kb"
            placeholder="e.g. This is a full-time remote role. Interview process: recruiter screen → technical → founder chat. Salary: $120k–$150k…"
            rows={6}
            value={knowledgeBase}
            onChange={(e) => setKnowledgeBase(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor="cal">
            Calendar link
          </label>
          <Input
            id="cal"
            type="url"
            placeholder="https://cal.com/your-link"
            value={calendarLink}
            onChange={(e) => setCalendarLink(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Reply mode</span>
          <div className="flex gap-3">
            {(["draft", "auto"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 rounded-lg border px-4 py-3 text-sm text-left transition-colors ${
                  mode === m
                    ? "border-[var(--orange-active)] bg-[var(--orange-active-soft,oklch(0.97_0.04_45))] font-medium"
                    : "border-border hover:border-muted-foreground/40"
                }`}
              >
                <div className="font-medium">
                  {m === "draft" ? "Draft for approval" : "Send automatically"}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {m === "draft"
                    ? "Agent H drafts a reply; you approve before it sends."
                    : "Agent H sends replies without approval (coming soon)."}
                </div>
              </button>
            ))}
          </div>
        </div>

        <Button className="self-start" disabled>
          Save (coming soon)
        </Button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Resume upload panels (unchanged logic, moved here)                  */
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
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium tracking-wide uppercase text-muted-foreground">
        Add a candidate manually
      </h3>
      <p className="text-xs text-muted-foreground -mt-2">
        Resume from email, WhatsApp, or a job portal
      </p>
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
    </div>
  );
};

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
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium tracking-wide uppercase text-muted-foreground">
        Bulk upload resumes
      </h3>
      <p className="text-xs text-muted-foreground -mt-2">
        Auto-parsed — name, email, and phone read straight from each file
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk-resumes">
            Resume files (PDF, Word, or RTF — up to 25 at once)
          </Label>
          <Input
            id="bulk-resumes"
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.rtf"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          {files.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {files.length} file(s) selected
            </p>
          )}
        </div>
        {errorMessage && (
          <p className="text-sm text-destructive">{errorMessage}</p>
        )}
        <div>
          <Button type="submit" size="sm" disabled={state === "uploading"}>
            {state === "uploading"
              ? `Uploading and parsing ${files.length || ""}...`
              : `Upload ${files.length > 0 ? files.length : ""} resume${files.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </form>

      {results && (
        <div className="flex flex-col gap-2 pt-2 border-t">
          <p className="text-xs text-muted-foreground">
            {results.filter((r) => r.status !== "failed").length} of{" "}
            {results.length} added to this role's pipeline
          </p>
          <ul className="flex flex-col gap-1.5">
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
    </div>
  );
};

RoleWorkspacePage.path = "/roles/:id";
