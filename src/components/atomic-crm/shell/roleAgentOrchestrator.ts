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

export type RoleAgentOrchestratorDeps = {
  dealId: string;
  deal: Deal | undefined;
  openDeals: Deal[];
  dataProvider: CrmDataProvider;
  queryClient: QueryClient;
  navigate: (path: string) => void;
  invalidateTranscript: () => void;
};

function turnIdempotencyKey(dealId: string, suffix: string) {
  return `${dealId}:${suffix}:${crypto.randomUUID()}`;
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
  parsed: ParsedCommand,
): Promise<ConversationTurnMetadata> {
  return {
    kind: "proposal",
    tier: "leaves_platform",
    action: parsed.action,
    status: "pending",
    explanation: parsed.explanation,
    params: {
      deal_id: parsed.deal_id,
      criterion_id: parsed.criterion_id,
      use_selected_candidates: parsed.use_selected_candidates,
    },
  };
}

export async function dispatchRoleAgentCommand(
  deps: RoleAgentOrchestratorDeps,
  commandText: string,
): Promise<void> {
  const dealIdNum = Number(deps.dealId);

  await appendRecruiterTurn(deps, commandText, { kind: "command" });

  const parsed = await deps.dataProvider.parseAgentCommand(commandText, {
    view: "canvas",
    open_deals: deps.openDeals.map((d) => ({ id: d.id, name: d.name })),
    current_deal_id: Number.isFinite(dealIdNum) ? dealIdNum : null,
  });

  const tier = getActionTier(parsed.action);
  const proposalContent = parsed.explanation;

  if (isLeavesPlatformAction(parsed.action)) {
    const metadata = await buildTier3ProposalMetadata(parsed);
    await appendAgentTurn(deps, proposalContent, metadata);
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
  } else if (action === "request_resume" && candidateId) {
    await deps.dataProvider.requestCandidateResume(candidateId, dealId);
    resultSummary = "Resume request email sent.";
  } else if (action === "send_first_outreach" && candidateId) {
    await deps.dataProvider.sendFirstOutreach(candidateId, dealId);
    resultSummary = "Outreach email sent.";
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
): Promise<void> {
  await appendRecruiterTurn(
    deps,
    note,
    {
      kind: "refinement",
      action: (proposalTurn.metadata as ConversationTurnMetadata | undefined)
        ?.action,
      email_preview: emailPreview,
    },
    proposalTurn.id,
  );
  deps.invalidateTranscript();
}
