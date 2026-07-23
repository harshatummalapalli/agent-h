// Agent H, sourcing sidebar (2026-07-21): the persistent, always-there
// sourcing conversation Harsha asked for -- "let recruiters breathe"
// means generous spacing and a calm, uncluttered thread, not a dense
// command bar. Docked to the right edge, toggleable, survives navigating
// within the session (thread state lives in useSourcingThread, owned by
// whichever page mounts this). Vendor names are deliberately anonymized
// ("developer & community search", "web search") -- Harsha's explicit
// call not to expose sourcing vendors to end users.
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useDataProvider } from "ra-core";
import { useRef, useState } from "react";

import type { CrmDataProvider } from "../providers/types";
import type { Deal } from "../types";
import { useSourcingThread } from "./useSourcingThread";
import { useVoiceInput } from "./useVoiceInput";
import type { SourcingStep, ThreadItem } from "./sourcingThreadTypes";

const STEP_DOT: Record<SourcingStep["status"], string> = {
  pending: "var(--ah-text-3)",
  active: "var(--ah-accent)",
  done: "var(--ah-good)",
};

const StepRow = ({ step }: { step: SourcingStep }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, padding: "3px 0" }}>
    <div
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        flexShrink: 0,
        background: STEP_DOT[step.status],
        ...(step.status === "active" ? { animation: "ah-pulse 1.2s infinite" } : {}),
      }}
    />
    <span style={{ color: step.status === "pending" ? "var(--ah-text-3)" : "var(--ah-text-2)" }}>
      {step.label}
      {step.status === "done" ? " — done" : step.status === "active" ? "…" : ""}
    </span>
  </div>
);

const ThreadEntry = ({ item }: { item: ThreadItem }) => {
  const navigate = useNavigate();

  if (item.kind === "user") {
    return (
      <div
        style={{
          alignSelf: "flex-end",
          maxWidth: "85%",
          background: "rgba(124,108,255,0.14)",
          color: "var(--ah-text-1)",
          borderRadius: 12,
          padding: "9px 13px",
          fontSize: 13.5,
        }}
      >
        {item.text}
      </div>
    );
  }

  if (item.kind === "assistant") {
    const color = item.tone === "error" ? "var(--ah-danger)" : item.tone === "success" ? "var(--ah-good)" : "var(--ah-text-2)";
    return (
      <div style={{ fontSize: 13, color, lineHeight: 1.5 }}>{item.text}</div>
    );
  }

  // kind === "sourcing"
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="ah-glass-card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 12, color: "var(--ah-text-3)", marginBottom: 4 }}>Sourcing for {item.dealName}</div>
        {item.steps.map((step) => (
          <StepRow key={step.key} step={step} />
        ))}
        {item.error && (
          <div style={{ fontSize: 12.5, color: "var(--ah-danger)", marginTop: 6 }}>{item.error}</div>
        )}
      </div>

      {item.result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--ah-text-3)" }}>
            Found {item.result.foundCount}, saved {item.result.savedCount}
            {item.result.filteredCount > 0 ? `, ${item.result.filteredCount} filtered as not relevant` : ""}
          </div>
          {item.result.savedCandidates.map((candidate) => (
            <div
              key={candidate.id}
              onClick={() => navigate(`/candidates/${candidate.id}/show`)}
              className="ah-glass-card"
              style={{ padding: "10px 13px", cursor: "pointer" }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{candidate.fullName}</div>
              <div style={{ fontSize: 12, color: "var(--ah-text-3)", marginTop: 2 }}>
                {[candidate.title, candidate.company].filter(Boolean).join(" · ") || "No details yet"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const SourcingSidebar = ({
  open,
  onClose,
  openDeals,
}: {
  open: boolean;
  onClose: () => void;
  openDeals: Deal[];
}) => {
  const navigate = useNavigate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { thread, submit, isBusy } = useSourcingThread({
    dataProvider,
    queryClient,
    openDeals: openDeals.map((d) => ({ id: d.id, name: d.name })),
    onNavigate: navigate,
  });

  const { isSupported: voiceSupported, isListening, toggleListening } = useVoiceInput((transcript) => {
    setValue((prev) => (prev ? `${prev} ${transcript}` : transcript));
  });

  const runSubmit = () => {
    if (!value.trim() || isBusy) return;
    submit(value);
    setValue("");
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        height: "100vh",
        width: 380,
        zIndex: 60,
        background: "var(--ah-bg-1)",
        borderLeft: "1px solid var(--ah-border-strong)",
        boxShadow: "-20px 0 50px rgba(0,0,0,0.35)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "18px 20px 14px",
          borderBottom: "1px solid var(--ah-border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600 }}>Sourcing</span>
        <div
          onClick={onClose}
          style={{ marginLeft: "auto", cursor: "pointer", color: "var(--ah-text-3)", fontSize: 18, lineHeight: 1 }}
          aria-label="Close sourcing panel"
        >
          &times;
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {thread.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--ah-text-3)", lineHeight: 1.6, padding: "8px 2px" }}>
            Tell me who you're looking for — paste a JD, describe the role, or ask me to keep sourcing for one that's open.
          </div>
        )}
        {thread.map((item) => (
          <ThreadEntry key={item.id} item={item} />
        ))}
      </div>

      <div
        style={{
          borderTop: "1px solid var(--ah-border)",
          padding: 14,
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        {voiceSupported && (
          <button
            className="ah-btn-ghost"
            onClick={toggleListening}
            aria-label={isListening ? "Stop listening" : "Talk instead of typing"}
            style={{
              width: 34,
              height: 34,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              borderColor: isListening ? "var(--ah-accent)" : undefined,
              color: isListening ? "var(--ah-accent)" : undefined,
            }}
          >
            &#127908;
          </button>
        )}
        <input
          ref={inputRef}
          type="text"
          value={value}
          disabled={isBusy}
          placeholder={isBusy ? "Working on it…" : "Relax the company size a bit"}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runSubmit();
            }
          }}
          style={{
            flex: 1,
            background: "var(--ah-glass)",
            border: "1px solid var(--ah-border)",
            borderRadius: 100,
            padding: "8px 14px",
            outline: "none",
            color: "var(--ah-text-1)",
            fontSize: 13.5,
          }}
        />
        <button
          className="ah-btn-primary"
          onClick={runSubmit}
          disabled={isBusy}
          aria-label="Send"
          style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0, opacity: isBusy ? 0.5 : 1 }}
        >
          &#8593;
        </button>
      </div>
    </div>
  );
};
