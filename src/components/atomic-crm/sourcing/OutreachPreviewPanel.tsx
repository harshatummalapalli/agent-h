import { Button } from "@/components/ui/button";
import { AH_CALLOUT_WARN, type OutreachPrepared } from "./sourcingTypes";

const CONNECTION_CHAR_LIMIT_OUTREACH = 300;

export function OutreachPreviewPanel({
  prepared,
  onPreparedChange,
  onConfirm,
  onCancel,
  confirming,
}: {
  prepared: OutreachPrepared;
  onPreparedChange: (next: OutreachPrepared) => void;
  onConfirm: () => void;
  onCancel: () => void;
  confirming: boolean;
}) {
  const inputClass =
    "border border-input bg-background text-foreground rounded px-2 py-1 text-xs w-full";
  const isLinkedIn =
    prepared.channel === "linkedin_connection" ||
    prepared.channel === "linkedin_inmail";
  const charCount = prepared.message_body?.length ?? 0;
  const overLimit =
    prepared.channel === "linkedin_connection" &&
    charCount > CONNECTION_CHAR_LIMIT_OUTREACH;

  return (
    <div className={AH_CALLOUT_WARN}>
      {isLinkedIn ? (
        <>
          <p className="text-xs font-medium">
            Review before sending —{" "}
            {prepared.channel === "linkedin_inmail"
              ? "LinkedIn InMail (open profile)"
              : "LinkedIn connection note"}
          </p>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Message
            <textarea
              className={`${inputClass} ${overLimit ? "border-destructive" : ""}`}
              rows={prepared.channel === "linkedin_connection" ? 4 : 6}
              value={prepared.message_body ?? ""}
              onChange={(e) =>
                onPreparedChange({ ...prepared, message_body: e.target.value })
              }
            />
          </label>
          <p
            className={`text-xs ${overLimit ? "text-destructive font-medium" : "text-muted-foreground"}`}
          >
            {prepared.channel === "linkedin_connection" &&
              `${charCount}/${CONNECTION_CHAR_LIMIT_OUTREACH} chars${overLimit ? " — trim before sending" : ""}`}
          </p>
          {prepared.cap_remaining !== null && (
            <p className="text-xs text-muted-foreground">
              {prepared.cap_remaining} sends remaining today
            </p>
          )}
          {prepared.dual_channel && prepared.email_preview && (
            <div className="border-t pt-2 flex flex-col gap-2">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(prepared.send_email_too)}
                  onChange={(e) =>
                    onPreparedChange({
                      ...prepared,
                      send_email_too: e.target.checked,
                    })
                  }
                />
                Also send email to {prepared.email_preview.to}
              </label>
              {prepared.send_email_too && (
                <>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Subject
                    <input
                      className={inputClass}
                      value={prepared.email_preview.subject}
                      onChange={(e) =>
                        onPreparedChange({
                          ...prepared,
                          email_preview: {
                            ...prepared.email_preview!,
                            subject: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Email body
                    <textarea
                      className={inputClass}
                      rows={4}
                      value={prepared.email_preview.html}
                      onChange={(e) =>
                        onPreparedChange({
                          ...prepared,
                          email_preview: {
                            ...prepared.email_preview!,
                            html: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                </>
              )}
            </div>
          )}
        </>
      ) : prepared.email_preview ? (
        <>
          <p className="text-xs font-medium">
            Review before sending to {prepared.email_preview.to}
          </p>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Subject
            <input
              className={inputClass}
              value={prepared.email_preview.subject}
              onChange={(e) =>
                onPreparedChange({
                  ...prepared,
                  email_preview: {
                    ...prepared.email_preview!,
                    subject: e.target.value,
                  },
                })
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Email body (HTML)
            <textarea
              className={inputClass}
              rows={5}
              value={prepared.email_preview.html}
              onChange={(e) =>
                onPreparedChange({
                  ...prepared,
                  email_preview: {
                    ...prepared.email_preview!,
                    html: e.target.value,
                  },
                })
              }
            />
          </label>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Outreach ready to send.</p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={confirming || overLimit}
          onClick={onConfirm}
        >
          {confirming ? "Sending..." : "Approve & send"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={confirming}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
