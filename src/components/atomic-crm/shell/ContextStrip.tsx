import type { ShellContext } from "./types";

type ContextStripProps = {
  context: ShellContext;
};

export const ContextStrip = ({ context }: ContextStripProps) => {
  const blockerLine =
    context.blockers.length > 0
      ? context.blockers.join(" · ")
      : "All good — no open actions";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 22px",
        borderBottom: "1px solid var(--ah-border)",
        background: "var(--ah-bg-1)",
        fontSize: 12.5,
        color: "var(--ah-text-2)",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontWeight: 600,
          color: "var(--ah-text-1)",
          fontSize: 13,
        }}
      >
        {context.title}
      </span>
      <span style={{ color: "var(--ah-border-strong)" }}>|</span>
      <span style={{ flex: 1, minWidth: 0 }}>{blockerLine}</span>
      {context.lastAction ? (
        <span
          style={{
            fontSize: 11.5,
            color: "var(--ah-text-3)",
            whiteSpace: "nowrap",
          }}
        >
          Last: {context.lastAction}
        </span>
      ) : null}
    </div>
  );
};
