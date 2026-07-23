// Agent H, Triage Inbox + Command Canvas: slide-out panel showing what
// Agent H has actually done in this session -- every command bar action,
// pending/success/error, newest first. Answers "what's loaded so far, what
// happened" directly at the point of use instead of a separate page you'd
// have to remember to check.
import { useAgentActivityLog } from "./agentActivityStore";

const STATUS_COLOR: Record<string, string> = {
  pending: "var(--ah-warn)",
  success: "var(--ah-good)",
  error: "var(--ah-danger)",
  info: "var(--ah-text-3)",
};

const timeAgo = (ts: number) => {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
};

export const ActivityPanel = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const entries = useAgentActivityLog();
  if (!open) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 60,
        right: 22,
        width: 340,
        maxHeight: "min(70vh, 520px)",
        overflowY: "auto",
        background: "var(--ah-bg-1)",
        border: "1px solid var(--ah-border-strong)",
        borderRadius: "var(--ah-radius)",
        boxShadow: "0 20px 50px rgba(0,0,0,0.45)",
        zIndex: 45,
        padding: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Agent H activity</div>
        <div onClick={onClose} style={{ marginLeft: "auto", cursor: "pointer", color: "var(--ah-text-3)" }}>
          &times;
        </div>
      </div>
      {entries.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--ah-text-3)" }}>
          Nothing yet — actions you run from the command bar will show up here.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {entries.map((entry) => (
            <div key={entry.id} className="ah-glass-card" style={{ padding: "8px 10px", display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  marginTop: 5,
                  flexShrink: 0,
                  background: STATUS_COLOR[entry.status],
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: "var(--ah-text-1)" }}>{entry.summary}</div>
                <div style={{ fontSize: 10.5, color: "var(--ah-text-3)", marginTop: 2 }}>{timeAgo(entry.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
