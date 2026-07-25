import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { RoleConversationTurn } from "../types";
import {
  type ConversationTurnMetadata,
  getLatestEmailPreview,
} from "./agentActionTiers";

type PendingApprovalCardProps = {
  turn: RoleConversationTurn;
  allTurns: RoleConversationTurn[];
  onApprove: (
    turn: RoleConversationTurn,
    preview?: ConversationTurnMetadata["email_preview"],
  ) => void | Promise<void>;
  onStop: (turn: RoleConversationTurn) => void | Promise<void>;
  onRefine: (
    turn: RoleConversationTurn,
    preview?: ConversationTurnMetadata["email_preview"],
  ) => void | Promise<void>;
  busy?: boolean;
};

export const PendingApprovalCard = ({
  turn,
  allTurns,
  onApprove,
  onStop,
  onRefine,
  busy = false,
}: PendingApprovalCardProps) => {
  const metadata = turn.metadata as ConversationTurnMetadata | undefined;
  const initialPreview = getLatestEmailPreview(turn.id, allTurns);
  const [preview, setPreview] = useState(initialPreview);

  const inputClass =
    "border border-input bg-background text-foreground rounded px-2 py-1 text-xs w-full";

  return (
    <li className="border border-amber-300 bg-amber-50/80 rounded-md p-3 flex flex-col gap-2 text-sm">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-amber-900">
          Pending approval — {metadata?.action ?? "action"}
        </span>
        <span className="whitespace-pre-wrap">{turn.content}</span>
      </div>

      {preview ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            To
            <input className={inputClass} value={preview.to} readOnly />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Subject
            <input
              className={inputClass}
              value={preview.subject}
              onChange={(e) =>
                setPreview({ ...preview, subject: e.target.value })
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Email body (HTML)
            <textarea
              className={inputClass}
              rows={5}
              value={preview.html}
              onChange={(e) => setPreview({ ...preview, html: e.target.value })}
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onRefine(turn, preview)}
          >
            Save edits
          </Button>
        </>
      ) : metadata?.booking_link_url ? (
        <a
          href={metadata.booking_link_url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-700 underline break-all"
        >
          {metadata.booking_link_url}
        </a>
      ) : null}

      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => onApprove(turn, preview ?? undefined)}
        >
          {busy ? "Sending…" : "Approve & send"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onStop(turn)}
        >
          Stop
        </Button>
      </div>
    </li>
  );
};
