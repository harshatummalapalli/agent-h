import { useGetList } from "ra-core";
import type { RoleConversationTurn } from "../types";
import {
  type ConversationTurnMetadata,
  isPendingTier3Proposal,
} from "./agentActionTiers";
import { PendingApprovalCard } from "./PendingApprovalCard";

type RoleConversationTranscriptProps = {
  dealId: string;
  onApprove: (
    turn: RoleConversationTurn,
    preview?: ConversationTurnMetadata["email_preview"],
    linkedinPreview?: ConversationTurnMetadata["linkedin_preview"],
  ) => void | Promise<void>;
  onStop: (turn: RoleConversationTurn) => void | Promise<void>;
  onRefine: (
    turn: RoleConversationTurn,
    preview?: ConversationTurnMetadata["email_preview"],
    linkedinPreview?: ConversationTurnMetadata["linkedin_preview"],
  ) => void | Promise<void>;
  actionBusy?: boolean;
};

export const RoleConversationTranscript = ({
  dealId,
  onApprove,
  onStop,
  onRefine,
  actionBusy = false,
}: RoleConversationTranscriptProps) => {
  const {
    data: turns,
    isPending,
    isError,
  } = useGetList<RoleConversationTurn>("role_conversation_turns", {
    filter: { deal_id: dealId },
    sort: { field: "created_at", order: "ASC" },
    pagination: { page: 1, perPage: 100 },
  });

  const list = turns ?? [];

  return (
    <div className="ah-panel p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium tracking-wide uppercase text-muted-foreground">
          Conversation
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Shared with everyone assigned to this role. Tier 3 actions block here
          until you approve or stop.
        </p>
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading conversation…</p>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">
          Conversation history is not available yet — apply the latest database
          migration.
        </p>
      ) : !list.length ? (
        <p className="text-sm text-muted-foreground">
          Ask Agent H anything about this role using the command bar below.
        </p>
      ) : (
        <ul className="flex flex-col gap-3 max-h-80 overflow-y-auto">
          {list.map((turn) => {
            const metadata = turn.metadata as
              | ConversationTurnMetadata
              | undefined;

            if (isPendingTier3Proposal(metadata)) {
              const hasLaterDecision = list.some(
                (other) =>
                  other.in_reply_to === turn.id &&
                  (other.metadata as ConversationTurnMetadata | undefined)
                    ?.kind === "decision",
              );
              if (hasLaterDecision) return null;

              return (
                <PendingApprovalCard
                  key={turn.id}
                  turn={turn}
                  allTurns={list}
                  onApprove={onApprove}
                  onStop={onStop}
                  onRefine={onRefine}
                  busy={actionBusy}
                />
              );
            }

            if (
              metadata?.kind === "decision" ||
              metadata?.kind === "refinement"
            ) {
              return null;
            }

            return (
              <li key={turn.id} className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {turn.speaker === "agent" ? "Agent H" : "You"}
                  {metadata?.kind === "result" ? " — result" : ""}
                </span>
                <span className="whitespace-pre-wrap">{turn.content}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
