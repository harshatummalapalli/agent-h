// Role Workspace (2026-07-19): the "one continuous role screen" Harsha
// asked for after we looked at how Noon.ai structures its product -- Noon
// keeps Sourcing/Review & Contact/Coordinator/AI Interviewer under ONE role
// and ONE URL, with context (JD, must-haves, location) typed once at intake
// reappearing pre-filled several stages later. Agent H's equivalent stages
// (Job Intake, Source Candidates, Screening) existed but lived in separate,
// disconnected routes/tabs that didn't share visible context -- this page
// is the fix: a single `/roles/:id` URL that shows the role brief itself,
// the full sourcing/calibration panel (embedded, not linked out to), and
// every candidate saved into this role's pipeline so far, all in one place.
//
// Deliberately NOT a rewrite of SourceCandidatesPage's ~2000 lines of
// sourcing/calibration/screening logic -- that logic is reused as-is via
// the `initialRoleBriefId` prop added to it, which auto-selects this role
// brief on mount and hides its own dropdown/heading (see that file's
// `embedded` handling). Growing the file count, not the file: this page is
// a thin composition of already-existing, already-tested pieces
// (DealCandidatesSection for the pipeline list, deal_notes for notes,
// SourceCandidatesPage for sourcing) plus a small role-brief header of its
// own.
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
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditButton } from "@/components/admin/edit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

import { DealCandidatesSection } from "../deals/DealCandidatesSection";
import { findDealLabel, formatISODateString } from "../deals/dealUtils";
import { NoteCreate } from "../notes/NoteCreate";
import { NotesIterator } from "../notes/NotesIterator";
import type { CrmDataProvider } from "../providers/types";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { SourceCandidatesPage } from "../sourcing/SourceCandidatesPage";
import { SourcingSidebar } from "../sourcing/SourcingSidebar";
import { AgentHShell } from "../shell/AgentHShell";
import { RoleConversationTranscript } from "../shell/RoleConversationTranscript";
import { useRoleShellContext } from "../shell/useShellContext";
import {
  approveTier3Proposal,
  dispatchRoleAgentCommand,
  refineTier3Proposal,
  stopTier3Proposal,
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

const RoleWorkspaceContent = ({ dealId }: { dealId: string }) => {
  const navigate = useNavigate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const { dealStages } = useConfigurationContext();
  const deal = useRecordContext<Deal>();
  const [sourcingOpen, setSourcingOpen] = useState(false);
  const [commandBusy, setCommandBusy] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
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
      invalidateTranscript: () => {
        queryClient.invalidateQueries({
          queryKey: ["role_conversation_turns"],
        });
      },
    }),
    [deal, dealId, dataProvider, navigate, openDeals, queryClient],
  );

  const runFreeTextCommand = async (commandText: string) => {
    setCommandBusy(true);
    try {
      await dispatchRoleAgentCommand(orchestratorDeps, commandText);
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
  ) => {
    setApprovalBusy(true);
    try {
      await approveTier3Proposal(orchestratorDeps, turn, preview);
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
  ) => {
    setApprovalBusy(true);
    try {
      await refineTier3Proposal(
        orchestratorDeps,
        turn,
        "Updated the draft before sending.",
        preview,
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

  return (
    <AgentHShell
      context={shellContext}
      commandBar={{
        placeholder: "Tell Agent H what you need for this role",
        hint: "Try: “find more candidates like these” or “relax the Python requirement”.",
        slashActions: [
          { cmd: "/relax", label: "Relax a criterion on this role" },
        ],
        onSubmit: runFreeTextCommand,
      }}
    >
      <div className="flex flex-col gap-8 max-w-3xl mx-auto p-6 pb-8 overflow-y-auto flex-1 min-h-0">
        <RoleWorkspaceHeader
          sourcingOpen={sourcingOpen}
          onToggleSourcing={() => setSourcingOpen((v) => !v)}
        />

        <RoleConversationTranscript
          dealId={dealId}
          onApprove={handleApproveProposal}
          onStop={handleStopProposal}
          onRefine={handleRefineProposal}
          actionBusy={approvalBusy || commandBusy}
        />

        <SourceCandidatesPage initialRoleBriefId={dealId} />

        <div className="ah-panel p-6 flex flex-col gap-6">
          <ManualResumeUploadPanel dealId={dealId} />
          <Separator />
          <BulkResumeUploadPanel dealId={dealId} />
        </div>

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

        <SourcingSidebar
          open={sourcingOpen}
          onClose={() => setSourcingOpen(false)}
          openDeals={openDeals ?? []}
        />
      </div>
    </AgentHShell>
  );
};

// Deliberately lighter than DealShowContent's header -- this page's
// SourceCandidatesPage panel below already renders a detailed "Searching
// for:" summary (title, seniority, location, must-haves/skills), so this
// header only needs to orient the recruiter (which role, what stage, a way
// back to the full deal record) without duplicating that detail.
const RoleWorkspaceHeader = ({
  sourcingOpen,
  onToggleSourcing,
}: {
  sourcingOpen: boolean;
  onToggleSourcing: () => void;
}) => {
  const { dealStages } = useConfigurationContext();
  const record = useRecordContext<Deal>();
  const [linkCopied, setLinkCopied] = useState(false);
  if (!record) return null;

  // Outbound candidate application link (2026-07-19): built client-side
  // from the deal's own public_application_token (schema 30) -- no API
  // call needed, the token is already on the record this page loaded.
  // Shareable anywhere (job boards, email, WhatsApp); the public
  // /apply/:token page (CandidateApplicationPage) resolves it back to this
  // exact role via submit-candidate-application.
  const handleCopyApplicationLink = async () => {
    if (!record.public_application_token) return;
    const url = `${window.location.origin}/apply/${record.public_application_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy application link", error);
    }
  };

  return (
    <div className="flex items-start justify-between">
      <div>
        <h1 className="text-2xl font-semibold">{record.name}</h1>
        <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
          <Badge variant="outline">
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
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onToggleSourcing}
          className={sourcingOpen ? "border-primary text-primary" : undefined}
        >
          ✨ Sourcing
        </Button>
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

// Manual resume upload (2026-07-19, task #54): "more of Kharta's features"
// -- a recruiter who got a resume some other way (job portal, email
// forward, WhatsApp attachment) adds that person straight into this role's
// pipeline with the resume attached from the start, via
// upload-candidate-resume. The resume-first counterpart to sourcing
// (discovery-vendor-first) and the public application page
// (candidate-self-service-first) -- three distinct entry points into the
// same pipeline now.
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

// Bulk resume upload (2026-07-19, tasks #56-59): "more of Kharta's
// features", part 2 -- Harsha's direct follow-up asking whether bulk
// upload + auto-parsing existed yet (it didn't; ManualResumeUploadPanel
// above only ever handled one recruiter-typed candidate at a time). This
// panel hands a WHOLE BATCH of resumes to bulk-upload-candidate-resumes,
// which auto-parses each file's name/email/phone from its own resume text
// via Claude (no typing per file -- that would defeat the point of "bulk"),
// creates/links a candidate per file, and auto-scores each one. Failures
// are per-file, not batch-fatal, and are shown inline so a recruiter can
// see exactly which files need to be added manually instead.
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
            Resume files (PDF, Word, or RTF -- up to 25 at once)
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
                  <span className="text-destructive">-- {r.error}</span>
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
