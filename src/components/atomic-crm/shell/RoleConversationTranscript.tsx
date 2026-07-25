import { useGetList } from "ra-core";
import type { RoleConversationTurn } from "../types";
import {
  type ConversationTurnMetadata,
  isPendingTier3Proposal,
} from "./agentActionTiers";
import { PendingApprovalCard } from "./PendingApprovalCard";

// TASK-003: inline candidate card rendered in the transcript after sourcing.
function CandidateCardTurn({
  metadata,
  onAddToPipeline,
}: {
  metadata: NonNullable<ConversationTurnMetadata["candidate_card"]>;
  onAddToPipeline?: (candidateId: number, dealId: number, name: string) => void;
}) {
  return (
    <li className="border rounded-md p-3 flex flex-col gap-1.5 text-sm bg-muted/20">
      <div className="font-medium flex items-center gap-2 flex-wrap">
        {metadata.name}
        {metadata.match_score != null && (
          <span className="text-xs font-normal text-muted-foreground border rounded px-1.5 py-0.5">
            Match {Math.round(metadata.match_score * 100)}%
          </span>
        )}
      </div>
      {metadata.headline && (
        <div className="text-xs text-muted-foreground">{metadata.headline}</div>
      )}
      {metadata.linkedin_url && (
        <a
          href={`https://${metadata.linkedin_url}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-700 underline"
        >
          LinkedIn profile
        </a>
      )}
      {metadata.must_haves.length > 0 && (
        <ul className="flex flex-col gap-0.5 mt-0.5">
          {metadata.must_haves.map((m, i) => (
            <li key={i} className="text-xs flex items-center gap-1.5">
              <span
                className={
                  m.status === "found"
                    ? "text-green-600"
                    : m.status === "inferred"
                      ? "text-yellow-600"
                      : "text-red-500"
                }
              >
                {m.status === "found"
                  ? "✓"
                  : m.status === "inferred"
                    ? "~"
                    : "✗"}
              </span>
              {m.label}
            </li>
          ))}
        </ul>
      )}
      {onAddToPipeline && (
        <button
          type="button"
          className="text-xs text-blue-700 underline text-left mt-1 w-fit"
          onClick={() =>
            onAddToPipeline(
              metadata.candidate_id,
              metadata.deal_id,
              metadata.name,
            )
          }
        >
          View in sourcing panel ↓
        </button>
      )}
    </li>
  );
}

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

            if (
              metadata?.kind === "candidate_card" &&
              metadata.candidate_card
            ) {
              return (
                <CandidateCardTurn
                  key={turn.id}
                  metadata={metadata.candidate_card}
                />
              );
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
