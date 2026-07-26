import { useGetList, useDataProvider, useNotify } from "ra-core";
import { useState, useMemo } from "react";
import type { CrmDataProvider } from "../providers/types";
import type { RoleConversationTurn } from "../types";
import {
  type ConversationTurnMetadata,
  isPendingTier3Proposal,
} from "./agentActionTiers";
import { PendingApprovalCard } from "./PendingApprovalCard";
import { normalizeLinkedinUrl } from "../misc/normalizeLinkedinUrl";

// Loop B calibration: inline candidate card — pipeline action only.
// Yes / Not-a-fit appears once as a BatchFooter after the latest batch.
function CandidateCardTurn({
  metadata,
  onAddToPipeline,
  pipelineSaveState,
}: {
  metadata: NonNullable<ConversationTurnMetadata["candidate_card"]>;
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
      {/* why_fit is always non-empty from the server; show it prominently */}
      {metadata.why_fit && (
        <div className="text-xs text-muted-foreground italic">
          {metadata.why_fit}
        </div>
      )}
      {metadata.location_name && (
        <div className="text-xs text-muted-foreground">
          📍 {metadata.location_name}
        </div>
      )}
      {(() => {
        const normalized = normalizeLinkedinUrl(metadata.linkedin_url);
        const href =
          normalized ??
          (metadata.linkedin_url
            ? `https://${metadata.linkedin_url.replace(/^https?:\/\//i, "")}`
            : null);
        return href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-700 underline"
          >
            LinkedIn profile
          </a>
        ) : null;
      })()}
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
        <div className="flex gap-2 mt-2">
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
        </div>
      )}
    </li>
  );
}

// Batch-level calibration actions — shown once after the latest candidate batch.
function BatchFooter({
  onCalibrationYes,
  onCalibrationNo,
}: {
  onCalibrationYes?: () => void;
  onCalibrationNo?: () => void;
}) {
  if (!onCalibrationYes && !onCalibrationNo) return null;
  return (
    <div className="flex gap-2 flex-wrap pt-1 border-t border-dashed">
      {onCalibrationYes && (
        <button
          type="button"
          className="text-xs border rounded px-2 py-1 hover:bg-muted transition-colors text-green-700 border-green-200 bg-green-50/60"
          onClick={onCalibrationYes}
        >
          ✓ These look right — show more like this
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
    </div>
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
  const [showHistory, setShowHistory] = useState(false);

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

  // Pending approval turns must always be visible.
  const pendingApprovalIds = useMemo(
    () =>
      new Set(
        list
          .filter((t) => {
            const m = t.metadata as ConversationTurnMetadata | undefined;
            if (!isPendingTier3Proposal(m)) return false;
            return !list.some(
              (other) =>
                other.in_reply_to === t.id &&
                (other.metadata as ConversationTurnMetadata | undefined)
                  ?.kind === "decision",
            );
          })
          .map((t) => t.id),
      ),
    [list],
  );

  // Latest calibration batch: the trailing run of consecutive candidate_card turns.
  // These stay visible even when the transcript is collapsed.
  const latestBatchIds = useMemo(() => {
    const ids: string[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i].metadata as ConversationTurnMetadata | undefined;
      if (m?.kind === "candidate_card") {
        ids.unshift(String(list[i].id));
      } else if (m?.kind === "decision" || m?.kind === "refinement") {
        // skip invisible turns
        continue;
      } else {
        break;
      }
    }
    return new Set(ids);
  }, [list]);

  // In collapsed state: show the latest candidate batch + any pending approvals.
  // Falls back to last 2 rendered turns if there are no calibration cards.
  const visibleIds = useMemo(() => {
    if (showHistory) return null; // null = show all
    const rendered = list.filter((t) => {
      const m = t.metadata as ConversationTurnMetadata | undefined;
      return m?.kind !== "decision" && m?.kind !== "refinement";
    });
    if (latestBatchIds.size > 0) {
      return new Set([...latestBatchIds, ...pendingApprovalIds]);
    }
    return new Set([
      ...rendered.slice(-2).map((t) => String(t.id)),
      ...pendingApprovalIds,
    ]);
  }, [showHistory, list, pendingApprovalIds, latestBatchIds]);

  return (
    <div className="ah-panel p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium tracking-wide uppercase text-muted-foreground">
          Conversation
        </h3>
        {list.length > 2 && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            onClick={() => setShowHistory((v) => !v)}
          >
            {showHistory ? "Collapse" : `Show history (${list.length} turns)`}
          </button>
        )}
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
          Start sourcing to see Agent H's activity here.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
            {list.map((turn) => {
              if (visibleIds !== null && !visibleIds.has(String(turn.id)))
                return null;
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
                const card = metadata.candidate_card;
                const extId = card.calibration_external_id;
                return (
                  <CandidateCardTurn
                    key={turn.id}
                    metadata={card}
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
          {/* Batch footer — shown once after the latest candidate batch */}
          {latestBatchIds.size > 0 && (
            <BatchFooter
              onCalibrationYes={onCalibrationYes}
              onCalibrationNo={onCalibrationNo}
            />
          )}
        </>
      )}
    </div>
  );
};
