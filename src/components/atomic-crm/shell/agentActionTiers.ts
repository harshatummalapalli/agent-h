// See docs/adr/ADR-617f-phase-c-human-in-the-loop-approval.md

import type { Identifier } from "ra-core";

export type ActionTier = "read" | "reversible" | "leaves_platform";

export type ParsedAgentAction =
  | "create_role"
  | "continue_sourcing"
  | "relax_criterion"
  | "request_resume"
  | "reject_candidates"
  | "show_candidates"
  | "show_roles"
  | "send_first_outreach"
  | "send_offer"
  | "send_booking_link"
  | "unknown";

export type ConversationTurnKind =
  | "command"
  | "proposal"
  | "refinement"
  | "decision"
  | "result";

export type ConversationTurnMetadata = {
  kind?: ConversationTurnKind;
  tier?: ActionTier;
  action?: ParsedAgentAction | string;
  status?: "pending" | "executed" | "cancelled";
  outcome?: "approved" | "stopped";
  explanation?: string;
  params?: Record<string, unknown>;
  email_preview?: {
    to: string;
    reply_to?: string;
    subject: string;
    html: string;
  };
  booking_link_url?: string;
  undo?: {
    action: string;
    params: Record<string, unknown>;
  };
};

const ACTION_TIERS: Record<ParsedAgentAction, ActionTier> = {
  show_roles: "read",
  show_candidates: "read",
  unknown: "read",
  create_role: "reversible",
  continue_sourcing: "reversible",
  relax_criterion: "reversible",
  reject_candidates: "reversible",
  request_resume: "leaves_platform",
  send_first_outreach: "leaves_platform",
  send_offer: "leaves_platform",
  send_booking_link: "leaves_platform",
};

export function getActionTier(action: string): ActionTier {
  return ACTION_TIERS[action as ParsedAgentAction] ?? "read";
}

export function isLeavesPlatformAction(action: string): boolean {
  return getActionTier(action) === "leaves_platform";
}

export function isPendingTier3Proposal(
  metadata: ConversationTurnMetadata | undefined,
): boolean {
  return (
    metadata?.kind === "proposal" &&
    metadata?.tier === "leaves_platform" &&
    metadata?.status === "pending"
  );
}

export function getLatestEmailPreview(
  proposalTurnId: Identifier,
  turns: Array<{
    id: Identifier;
    in_reply_to?: Identifier | null;
    metadata?: ConversationTurnMetadata;
  }>,
): ConversationTurnMetadata["email_preview"] | undefined {
  const proposal = turns.find((t) => t.id === proposalTurnId);
  let preview = proposal?.metadata?.email_preview;

  for (const turn of turns) {
    if (
      turn.in_reply_to === proposalTurnId &&
      turn.metadata?.kind === "refinement" &&
      turn.metadata.email_preview
    ) {
      preview = turn.metadata.email_preview;
    }
  }

  return preview;
}
