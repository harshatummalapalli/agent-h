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
  | "result"
  | "candidate_card";

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
  linkedin_preview?: {
    channel: "linkedin_connection" | "linkedin_inmail";
    message_body: string;
    char_count: number;
    is_open_profile: boolean;
    linkedin_provider_id: string;
    cap_remaining?: number;
    drafted_by?: "claude" | "fallback_template";
  };
  booking_link_url?: string;
  undo?: {
    action: string;
    params: Record<string, unknown>;
  };
  // TASK-003: candidate card embedded in the transcript after sourcing runs.
  candidate_card?: {
    candidate_id: number;
    deal_id: number;
    name: string;
    headline: string | null;
    linkedin_url: string | null;
    match_score: number | null;
    must_haves: Array<{
      label: string;
      status: "found" | "inferred" | "missing";
    }>;
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

type TurnSummary = {
  id: Identifier;
  in_reply_to?: Identifier | null;
  metadata?: ConversationTurnMetadata;
};

export function getLatestEmailPreview(
  proposalTurnId: Identifier,
  turns: TurnSummary[],
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

/** Like getLatestEmailPreview but for LinkedIn outreach previews. */
export function getLatestLinkedInPreview(
  proposalTurnId: Identifier,
  turns: TurnSummary[],
): ConversationTurnMetadata["linkedin_preview"] | undefined {
  const proposal = turns.find((t) => t.id === proposalTurnId);
  let preview = proposal?.metadata?.linkedin_preview;

  for (const turn of turns) {
    if (
      turn.in_reply_to === proposalTurnId &&
      turn.metadata?.kind === "refinement" &&
      turn.metadata.linkedin_preview
    ) {
      preview = turn.metadata.linkedin_preview;
    }
  }

  return preview;
}
