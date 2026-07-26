import { useGetList, useDataProvider, useNotify } from "ra-core";
import { useState } from "react";
import type { CrmDataProvider } from "../providers/types";
import type { RoleConversationTurn } from "../types";
import {
  type ConversationTurnMetadata,
  isPendingTier3Proposal,
} from "./agentActionTiers";
import { PendingApprovalCard } from "./PendingApprovalCard";

// Loop B calibration: inline candidate card with Yes/No quick actions.
function CandidateCardTurn({
  metadata,
  onCalibrationYes,
  onCalibrationNo,
  onAddToPipeline,
  pipelineSaveState,
}: {
  metadata: NonNullable<ConversationTurnMetadata["candidate_card"]>;
  onCalibrationYes?: () => void;
  onCalibrationNo?: () => void;
  onAddToPipeline?: () => void;
  pipelineSaveState?: "idle" | "saving" | "saved";
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
      {metadata.why_fit && (
        <div className="text-xs text-muted-foreground italic">
          {metadata.why_fit}
        </div>
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
      <div className="flex gap-2 mt-2 flex-wrap">
        {onAddToPipeline && (
          <button
            type="button"
            className="text-xs border rounded px-2 py-1 transition-colors text-blue-700 border-blue-200 bg-blue-50/60 hover:bg-blue-100 disabled:opacity-50"
            onClick={onAddToPipeline}
            disabled={
              pipelineSaveState === "saving" || pipelineSaveState === "saved"
            }
          >
            {pipelineSaveState === "saved"
              ? "✓ Added to pipeline"
              : pipelineSaveState === "saving"
                ? "Adding…"
                : "+ Add to pipeline"}
          </button>
        )}
        {(onCalibrationYes || onCalibrationNo) && (
          <>
            {onCalibrationYes && (
              <button
                type="button"
                className="text-xs border rounded px-2 py-1 hover:bg-muted transition-colors text-green-700 border-green-200 bg-green-50/60"
                onClick={onCalibrationYes}
              >
                ✓ Yes, show more like this
              </button>
            )}
            {onCalibrationNo && (
              <button
                type="button"
                className="text-xs border rounded px-2 py-1 hover:bg-muted transition-colors text-muted-foreground"
                onClick={onCalibrationNo}
              >
                ✗ Not a fit
              </button>
            )}
          </>
        )}
      </div>
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
  onCalibrationYes?: () => void;
  onCalibrationNo?: () => void;
};

export const RoleConversationTranscript = ({
  dealId,
  onApprove,
  onStop,
  onRefine,
  actionBusy = false,
  onCalibrationYes,
  onCalibrationNo,
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

  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const [pipelineSaveStates, setPipelineSaveStates] = useState<
    Record<string, "idle" | "saving" | "saved">
  >({});

  const handleAddToPipeline = async (
    cardMeta: NonNullable<ConversationTurnMetadata["candidate_card"]>,
  ) => {
    const extId = cardMeta.calibration_external_id;
    if (!extId) return;
    setPipelineSaveStates((prev) => ({ ...prev, [extId]: "saving" }));
    try {
      await dataProvider.saveSourcedCandidate(cardMeta.deal_id, {
        id: extId,
        full_name: cardMeta.name,
        linkedin_url: cardMeta.linkedin_url ?? null,
        // headline is "title at company" — store as job_title for display
        job_title: cardMeta.headline ?? null,
      });
      setPipelineSaveStates((prev) => ({ ...prev, [extId]: "saved" }));
      notify("Added to pipeline", { type: "success" });
    } catch (error: unknown) {
      setPipelineSaveStates((prev) => ({ ...prev, [extId]: "idle" }));
      const msg =
        error instanceof Error ? error.message : "Failed to add to pipeline";
      notify(msg, { type: "error" });
    }
  };

  const list = turns ?? [];

  return (
    <div className="ah-panel p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium tracking-wide uppercase text-muted-foreground">
          Conversation
        </h3>
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">
          Conversation history is not available yet — apply the latest database
          migration.
        </p>
      ) : !list.length ? (
        <p className="text-sm text-muted-foreground">
          Use the command bar below to start sourcing candidates for this role.
        </p>
      ) : (
        <ul className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
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
              // Only the LAST candidate card turn shows the Yes/No buttons
              // so the recruiter acts on the batch as a whole rather than per-card.
              const isLastCard =
                list
                  .filter(
                    (t) =>
                      (t.metadata as ConversationTurnMetadata | undefined)
                        ?.kind === "candidate_card",
                  )
                  .at(-1)?.id === turn.id;
              const card = metadata.candidate_card;
              const extId = card.calibration_external_id;
              return (
                <CandidateCardTurn
                  key={turn.id}
                  metadata={card}
                  onCalibrationYes={isLastCard ? onCalibrationYes : undefined}
                  onCalibrationNo={isLastCard ? onCalibrationNo : undefined}
                  onAddToPipeline={
                    extId ? () => handleAddToPipeline(card) : undefined
                  }
                  pipelineSaveState={
                    extId ? (pipelineSaveStates[extId] ?? "idle") : undefined
                  }
                />
              );
            }

            if (metadata?.kind === "calibration_question") {
              return (
                <li key={turn.id} className="flex flex-col gap-1 text-sm">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Agent H
                  </span>
                  <span className="whitespace-pre-wrap text-foreground">
                    {turn.content}
                  </span>
                </li>
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
