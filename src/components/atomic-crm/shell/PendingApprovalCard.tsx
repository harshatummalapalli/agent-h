import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { RoleConversationTurn } from "../types";
import {
  type ConversationTurnMetadata,
  getLatestEmailPreview,
  getLatestLinkedInPreview,
} from "./agentActionTiers";

const CONNECTION_CHAR_LIMIT = 300;

type PendingApprovalCardProps = {
  turn: RoleConversationTurn;
  allTurns: RoleConversationTurn[];
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
  const initialEmailPreview = getLatestEmailPreview(turn.id, allTurns);
  const initialLinkedInPreview = getLatestLinkedInPreview(turn.id, allTurns);

  const [emailPreview, setEmailPreview] = useState(initialEmailPreview);
  const [linkedinPreview, setLinkedInPreview] = useState(
    initialLinkedInPreview,
  );

  const inputClass =
    "border border-input bg-background text-foreground rounded px-2 py-1 text-xs w-full";

  const charCount = linkedinPreview?.message_body?.length ?? 0;
  const isConnectionChannel =
    linkedinPreview?.channel === "linkedin_connection";
  const overLimit = isConnectionChannel && charCount > CONNECTION_CHAR_LIMIT;

  return (
    <li className="border border-amber-300 bg-amber-50/80 rounded-md p-3 flex flex-col gap-2 text-sm">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-amber-900">
          Pending approval — {metadata?.action ?? "action"}
        </span>
        <span className="whitespace-pre-wrap">{turn.content}</span>
      </div>

      {linkedinPreview ? (
        <>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {linkedinPreview.channel === "linkedin_inmail"
                ? "LinkedIn InMail (open profile)"
                : "LinkedIn connection note"}
            </span>
            <span
              className={overLimit ? "text-destructive font-medium" : undefined}
            >
              {charCount}
              {isConnectionChannel ? `/${CONNECTION_CHAR_LIMIT}` : ""} chars
            </span>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Message
            <textarea
              className={`${inputClass} ${overLimit ? "border-destructive" : ""}`}
              rows={isConnectionChannel ? 4 : 6}
              value={linkedinPreview.message_body}
              onChange={(e) =>
                setLinkedInPreview({
                  ...linkedinPreview,
                  message_body: e.target.value,
                  char_count: e.target.value.length,
                })
              }
            />
          </label>
          {overLimit && (
            <p className="text-xs text-destructive">
              Connection notes must be {CONNECTION_CHAR_LIMIT} characters or
              fewer. Trim the message before sending.
            </p>
          )}
          {linkedinPreview.cap_remaining !== undefined && (
            <p className="text-xs text-muted-foreground">
              {linkedinPreview.cap_remaining} sends remaining today
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onRefine(turn, undefined, linkedinPreview)}
          >
            Save edits
          </Button>
        </>
      ) : emailPreview ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            To
            <input className={inputClass} value={emailPreview.to} readOnly />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Subject
            <input
              className={inputClass}
              value={emailPreview.subject}
              onChange={(e) =>
                setEmailPreview({ ...emailPreview, subject: e.target.value })
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Email body (HTML)
            <textarea
              className={inputClass}
              rows={5}
              value={emailPreview.html}
              onChange={(e) =>
                setEmailPreview({ ...emailPreview, html: e.target.value })
              }
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onRefine(turn, emailPreview)}
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
          disabled={busy || overLimit}
          onClick={() =>
            onApprove(
              turn,
              emailPreview ?? undefined,
              linkedinPreview ?? undefined,
            )
          }
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
