// Agent H, Triage Inbox + Command Canvas redesign: the "?" cheat sheet.
// Same keyboard grammar applies in both InboxPage and CanvasPage, so this
// is one shared component rather than a per-view help panel.
type ShortcutRow = { label: string; keys: string };

const SHARED_SHORTCUTS: ShortcutRow[] = [
  { label: "Move focus", keys: "j / k" },
  { label: "Open focused item", keys: "↵" },
  { label: "Approve / add focused item", keys: "a" },
  { label: "Dismiss / reject focused item", keys: "x" },
  { label: "Quick actions", keys: "/" },
  { label: "Jump anywhere / global command", keys: "⌘K" },
  { label: "Back", keys: "esc" },
  { label: "This cheat sheet", keys: "?" },
];

export const ShortcutsModal = ({
  open,
  onClose,
  extraRows = [],
}: {
  open: boolean;
  onClose: () => void;
  extraRows?: ShortcutRow[];
}) => {
  if (!open) return null;
  const rows = [...SHARED_SHORTCUTS.slice(0, 4), ...extraRows, ...SHARED_SHORTCUTS.slice(4)];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(6,7,11,0.6)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="ah-glass-card"
        style={{
          width: 420,
          maxWidth: "90vw",
          background: "var(--ah-bg-1)",
          borderColor: "var(--ah-border-strong)",
          padding: 22,
        }}
      >
        <h2 style={{ fontFamily: "var(--ah-serif)", fontWeight: 400, fontSize: 18, margin: "0 0 14px" }}>
          Keyboard shortcuts
        </h2>
        {rows.map((row, i) => (
          <div
            key={row.label + i}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "7px 0",
              fontSize: 13,
              color: "var(--ah-text-2)",
              borderTop: i === 0 ? "none" : "1px solid var(--ah-border)",
            }}
          >
            <span>{row.label}</span>
            <span className="ah-kbd">{row.keys}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
