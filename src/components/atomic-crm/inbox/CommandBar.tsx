// Agent H, Triage Inbox + Command Canvas redesign: the one persistent
// command surface shared by InboxPage and CanvasPage. Free text goes to
// onSubmit as-is (the caller decides what "tell Agent H to do X" means in
// its own context); typing "/" opens a scaffolded quick-action menu so the
// bar is never pure guesswork, matching the approved v4 mockup's slash-menu.
// Cmd/Ctrl+K focuses it from anywhere on the page.
import { useEffect, useRef, useState } from "react";

export type SlashAction = {
  cmd: string;
  label: string;
};

type CommandBarProps = {
  placeholder: string;
  hint: string;
  slashActions: SlashAction[];
  onSubmit: (value: string) => void;
};

export const CommandBar = ({
  placeholder,
  hint,
  slashActions,
  onSubmit,
}: CommandBarProps) => {
  const [value, setValue] = useState("");
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const runCommand = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
    setShowSlashMenu(false);
  };

  return (
    <div
      style={{ padding: "12px 22px 16px", flexShrink: 0, position: "relative" }}
    >
      {showSlashMenu && slashActions.length > 0 && (
        <div
          className="ah-glass-card"
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: 22,
            right: 22,
            maxWidth: 760,
            margin: "0 auto",
            overflow: "hidden",
            background: "var(--ah-bg-1)",
            borderColor: "var(--ah-border-strong)",
            boxShadow: "var(--ah-shadow-lg)",
          }}
        >
          {slashActions.map((action) => (
            <div
              key={action.cmd}
              onClick={() => {
                setValue(action.cmd + " ");
                setShowSlashMenu(false);
                inputRef.current?.focus();
              }}
              style={{
                padding: "9px 14px",
                fontSize: 12.5,
                color: "var(--ah-text-2)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--ah-accent-soft)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              <span
                style={{
                  fontFamily: "var(--ah-mono)",
                  fontSize: 10.5,
                  color: "var(--ah-accent-2)",
                  flexShrink: 0,
                  width: 90,
                }}
              >
                {action.cmd}
              </span>
              {action.label}
            </div>
          ))}
        </div>
      )}

      <div
        className="ah-glass-card"
        style={{
          maxWidth: 760,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--ah-bg-1)",
          borderColor: "var(--ah-border-strong)",
          padding: "9px 9px 9px 16px",
          boxShadow: "var(--ah-shadow-md)",
        }}
      >
        <span style={{ color: "var(--ah-text-3)", fontSize: 13 }}>
          &#10024;
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            setShowSlashMenu(e.target.value.startsWith("/"));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runCommand();
            }
            if (e.key === "Escape") {
              setShowSlashMenu(false);
              inputRef.current?.blur();
            }
          }}
          style={{
            flex: 1,
            background: "none",
            border: "none",
            outline: "none",
            color: "var(--ah-text-1)",
            fontSize: 14,
          }}
        />
        <span className="ah-kbd">&#8984;K</span>
        <button
          className="ah-btn-primary"
          onClick={runCommand}
          style={{
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
          }}
          aria-label="Send"
        >
          &#8593;
        </button>
      </div>
      <div
        style={{
          maxWidth: 760,
          margin: "7px auto 0",
          fontSize: 10.5,
          color: "var(--ah-text-3)",
          textAlign: "center",
        }}
      >
        {hint}
      </div>
    </div>
  );
};
