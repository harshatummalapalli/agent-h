// See docs/adr/ADR-617f-phase-c-human-in-the-loop-approval.md

import type { QueryClient } from "@tanstack/react-query";
import type { Identifier } from "ra-core";
import type { CrmDataProvider } from "../providers/types";
import type { Deal, RoleConversationTurn } from "../types";
import {
  type ConversationTurnMetadata,
  getActionTier,
  isLeavesPlatformAction,
} from "./agentActionTiers";

type ParsedCommand = Awaited<ReturnType<CrmDataProvider["parseAgentCommand"]>>;

export type ParseCandidateRef = { id: number; name: string };

export type RoleAgentOrchestratorDeps = {
  dealId: string;
  deal: Deal | undefined;
  openDeals: Deal[];
  dataProvider: CrmDataProvider;
  queryClient: QueryClient;
  navigate: (path: string) => void;
  invalidateTranscript: () => void;
  pipelineCandidates?: ParseCandidateRef[];
  selectedCandidates?: ParseCandidateRef[];
};

function turnIdempotencyKey(dealId: string, suffix: string) {
  return `${dealId}:${suffix}:${crypto.randomUUID()}`;
}

function resolveCandidateId(
  parsed: ParsedCommand,
  selectedCandidates: ParseCandidateRef[],
): number | null {
  if (parsed.candidate_id != null) return parsed.candidate_id;
  if (parsed.use_selected_candidates && selectedCandidates.length === 1) {
    return selectedCandidates[0].id;
  }
  return null;
}

async function appendRecruiterTurn(
  deps: RoleAgentOrchestratorDeps,
  content: string,
  metadata: ConversationTurnMetadata,
  inReplyTo?: Identifier | null,
): Promise<RoleConversationTurn> {
  return (await deps.dataProvider.createRoleConversationTurn(deps.dealId, {
    content,
    metadata,
    in_reply_to: inReplyTo ?? null,
    idempotency_key: turnIdempotencyKey(deps.dealId, "recruiter"),
  })) as RoleConversationTurn;
}

async function appendAgentTurn(
  deps: RoleAgentOrchestratorDeps,
  content: string,
  metadata: ConversationTurnMetadata,
  inReplyTo?: Identifier | null,
): Promise<RoleConversationTurn> {
  return (await deps.dataProvider.appendAgentConversationTurn(deps.dealId, {
    content,
    metadata,
    in_reply_to: inReplyTo ?? null,
    idempotency_key: turnIdempotencyKey(deps.dealId, "agent"),
  })) as RoleConversationTurn;
}

async function executeReversibleOrRead(
  deps: RoleAgentOrchestratorDeps,
  parsed: ParsedCommand,
): Promise<{ summary: string; undo?: ConversationTurnMetadata["undo"] }> {
  if (parsed.action === "create_role") {
    deps.navigate("/jd-intake");
    return { summary: parsed.explanation };
  }

  if (parsed.action === "show_roles") {
    deps.navigate("/deals");
    return { summary: parsed.explanation };
  }

  if (parsed.action === "show_candidates" && parsed.deal_id != null) {
    deps.navigate(`/roles/${parsed.deal_id}`);
    return { summary: parsed.explanation };
  }

  if (parsed.action === "continue_sourcing" && parsed.deal_id != null) {
    const result = await deps.dataProvider.continueSourcingForDeal(
      parsed.deal_id,
    );
    deps.queryClient.invalidateQueries({ queryKey: ["deals", deps.dealId] });
    deps.queryClient.invalidateQueries({ queryKey: ["deal_candidates"] });
    const filteredNote =
      result.filteredCount > 0
        ? `, ${result.filteredCount} filtered as not relevant`
        : "";
    return {
      summary: `Found ${result.foundCount}, saved ${result.savedCount} new candidates${filteredNote}.`,
    };
  }

  if (parsed.action === "relax_criterion" && parsed.criterion_id != null) {
    await deps.dataProvider.relaxLearnedCriterion(parsed.criterion_id);
    deps.queryClient.invalidateQueries({
      queryKey: ["inbox_per_deal_signals"],
    });
    return {
      summary: parsed.explanation,
      undo: {
        action: "note_only",
        params: { criterion_id: parsed.criterion_id },
      },
    };
  }

  if (parsed.action === "unknown") {
    return { summary: parsed.explanation };
  }

  return {
    summary:
      parsed.explanation ||
      "I understood the request but can't run that action in this context yet.",
  };
}

async function buildTier3ProposalMetadata(
  deps: RoleAgentOrchestratorDeps,
  parsed: ParsedCommand,
): Promise<ConversationTurnMetadata> {
  const selectedCandidates = deps.selectedCandidates ?? [];
  const candidateId = resolveCandidateId(parsed, selectedCandidates);
  const dealId = (parsed.deal_id as number | undefined) ?? Number(deps.dealId);

  const params: Record<string, unknown> = {
    deal_id: dealId,
    criterion_id: parsed.criterion_id,
    use_selected_candidates: parsed.use_selected_candidates,
    candidate_id: candidateId,
  };

  const base: ConversationTurnMetadata = {
    kind: "proposal",
    tier: "leaves_platform",
    action: parsed.action,
    status: "pending",
    explanation: parsed.explanation,
    params,
  };

  if (parsed.action === "request_resume" && candidateId && dealId) {
    try {
      const result = await deps.dataProvider.prepareRequestResume(
        candidateId,
        dealId,
      );
      return {
        ...base,
        email_preview:
          result.email_preview as ConversationTurnMetadata["email_preview"],
      };
    } catch (error) {
      return {
        ...base,
        explanation: `${parsed.explanation} (${error instanceof Error ? error.message : "Couldn't prepare the email preview"})`,
      };
    }
  }

  if (parsed.action === "send_first_outreach" && candidateId && dealId) {
    try {
      const result = await deps.dataProvider.prepareFirstOutreach(
        candidateId,
        dealId,
      );
      if (result.channel === "email" && result.email_preview) {
        return {
          ...base,
          email_preview:
            result.email_preview as ConversationTurnMetadata["email_preview"],
        };
      }
      if (
        (result.channel === "linkedin_connection" ||
          result.channel === "linkedin_inmail") &&
        result.message_body &&
        result.linkedin_provider_id
      ) {
        return {
          ...base,
          linkedin_preview: {
            channel: result.channel,
            message_body: result.message_body,
            char_count: result.char_count ?? result.message_body.length,
            is_open_profile: result.is_open_profile ?? false,
            linkedin_provider_id: result.linkedin_provider_id,
            cap_remaining: result.cap_remaining ?? undefined,
            drafted_by: result.drafted_by,
          } as ConversationTurnMetadata["linkedin_preview"],
        };
      }
      return base;
    } catch (error) {
      return {
        ...base,
        explanation: `${parsed.explanation} (${error instanceof Error ? error.message : "Couldn't prepare the outreach preview"})`,
      };
    }
  }

  if (isLeavesPlatformAction(parsed.action) && !candidateId) {
    return {
      ...base,
      explanation: `${parsed.explanation} (Select a candidate in the table or name someone from the pipeline so I know who to contact.)`,
    };
  }

  return base;
}

export async function dispatchRoleAgentCommand(
  deps: RoleAgentOrchestratorDeps,
  commandText: string,
): Promise<void> {
  const dealIdNum = Number(deps.dealId);
  const selectedCandidates = deps.selectedCandidates ?? [];
  const pipelineCandidates = deps.pipelineCandidates ?? [];

  await appendRecruiterTurn(deps, commandText, { kind: "command" });

  const parsed = await deps.dataProvider.parseAgentCommand(commandText, {
    view: "canvas",
    open_deals: deps.openDeals.map((d) => ({ id: d.id, name: d.name })),
    current_deal_id: Number.isFinite(dealIdNum) ? dealIdNum : null,
    selected_candidates: selectedCandidates.map((c) => ({
      id: c.id,
      name: c.name,
    })),
    pipeline_candidates: pipelineCandidates.map((c) => ({
      id: c.id,
      name: c.name,
    })),
  });

  const tier = getActionTier(parsed.action);
  const proposalContent = parsed.explanation;

  if (isLeavesPlatformAction(parsed.action)) {
    const metadata = await buildTier3ProposalMetadata(deps, parsed);
    await appendAgentTurn(
      deps,
      metadata.explanation ?? proposalContent,
      metadata,
    );
    deps.invalidateTranscript();
    return;
  }

  const proposalTurn = await appendAgentTurn(deps, proposalContent, {
    kind: "proposal",
    tier,
    action: parsed.action,
    status: "executed",
    explanation: parsed.explanation,
    params: {
      deal_id: parsed.deal_id,
      criterion_id: parsed.criterion_id,
      candidate_id: resolveCandidateId(parsed, selectedCandidates),
    },
  });

  const { summary, undo } = await executeReversibleOrRead(deps, parsed);

  await appendAgentTurn(
    deps,
    summary,
    {
      kind: "result",
      tier,
      action: parsed.action,
      status: "executed",
      undo,
    },
    proposalTurn.id,
  );
  deps.invalidateTranscript();
}

export async function approveTier3Proposal(
  deps: RoleAgentOrchestratorDeps,
  proposalTurn: RoleConversationTurn,
  approvedPreview?: ConversationTurnMetadata["email_preview"],
  approvedLinkedInPreview?: ConversationTurnMetadata["linkedin_preview"],
): Promise<void> {
  const metadata = proposalTurn.metadata as
    | ConversationTurnMetadata
    | undefined;
  const action = metadata?.action;
  if (!action || !isLeavesPlatformAction(action)) {
    throw new Error("This turn is not a pending approval.");
  }

  await appendRecruiterTurn(
    deps,
    "Approved — send it.",
    { kind: "decision", outcome: "approved", action },
    proposalTurn.id,
  );

  const params = metadata.params ?? {};
  const candidateId = params.candidate_id as number | undefined;
  const dealId = (params.deal_id as number | undefined) ?? Number(deps.dealId);
  let resultSummary = "Done.";

  if (action === "send_offer" && candidateId && approvedPreview) {
    await deps.dataProvider.sendOffer(candidateId, dealId, {
      subject: approvedPreview.subject,
      html: approvedPreview.html,
    });
    resultSummary = `Offer email sent to ${approvedPreview.to}.`;
  } else if (
    action === "send_booking_link" &&
    candidateId &&
    metadata.booking_link_url
  ) {
    await deps.dataProvider.sendBookingLink(candidateId, dealId, {
      booking_link_url: metadata.booking_link_url,
      subject: approvedPreview?.subject,
      html: approvedPreview?.html,
    });
    resultSummary = "Booking link saved and email sent.";
  } else if (action === "request_resume" && candidateId && approvedPreview) {
    await deps.dataProvider.requestCandidateResume(candidateId, dealId, {
      subject: approvedPreview.subject,
      html: approvedPreview.html,
    });
    resultSummary = `Resume request sent to ${approvedPreview.to}.`;
  } else if (action === "send_first_outreach" && candidateId) {
    const linkedInPreview =
      approvedLinkedInPreview ?? metadata?.linkedin_preview;
    const emailPreviewForSend = approvedPreview;
    if (linkedInPreview) {
      await deps.dataProvider.sendFirstOutreach(candidateId, dealId, {
        channel: linkedInPreview.channel,
        message_body: linkedInPreview.message_body,
        linkedin_provider_id: linkedInPreview.linkedin_provider_id,
      });
      const channelLabel =
        linkedInPreview.channel === "linkedin_inmail"
          ? "LinkedIn InMail"
          : "LinkedIn connection request";
      resultSummary = `${channelLabel} sent.`;
    } else if (emailPreviewForSend) {
      await deps.dataProvider.sendFirstOutreach(candidateId, dealId, {
        channel: "email",
        subject: emailPreviewForSend.subject,
        html: emailPreviewForSend.html,
      });
      resultSummary = `Outreach email sent to ${emailPreviewForSend.to}.`;
    } else {
      await deps.dataProvider.sendFirstOutreach(candidateId, dealId);
      resultSummary = "Outreach sent.";
    }
  } else {
    resultSummary =
      metadata.explanation ??
      "Approved, but this action still needs wiring with a candidate context.";
  }

  await appendAgentTurn(
    deps,
    resultSummary,
    { kind: "result", action, status: "executed" },
    proposalTurn.id,
  );
  deps.invalidateTranscript();
}

export async function stopTier3Proposal(
  deps: RoleAgentOrchestratorDeps,
  proposalTurn: RoleConversationTurn,
): Promise<void> {
  const metadata = proposalTurn.metadata as
    | ConversationTurnMetadata
    | undefined;

  await appendRecruiterTurn(
    deps,
    "Stopped — don't send.",
    {
      kind: "decision",
      outcome: "stopped",
      action: metadata?.action,
    },
    proposalTurn.id,
  );

  await appendAgentTurn(
    deps,
    "Stopped. Nothing was sent.",
    { kind: "result", action: metadata?.action, status: "cancelled" },
    proposalTurn.id,
  );
  deps.invalidateTranscript();
}

export async function refineTier3Proposal(
  deps: RoleAgentOrchestratorDeps,
  proposalTurn: RoleConversationTurn,
  note: string,
  emailPreview?: ConversationTurnMetadata["email_preview"],
  linkedinPreview?: ConversationTurnMetadata["linkedin_preview"],
): Promise<void> {
  await appendRecruiterTurn(
    deps,
    note,
    {
      kind: "refinement",
      action: (proposalTurn.metadata as ConversationTurnMetadata | undefined)
        ?.action,
      email_preview: emailPreview,
      linkedin_preview: linkedinPreview,
    },
    proposalTurn.id,
  );
  deps.invalidateTranscript();
}
