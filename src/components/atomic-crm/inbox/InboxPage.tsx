// Agent H, Triage Inbox: the new landing experience (wired as the app's
// `dashboard` in CRM.tsx), replacing the old stat-card Dashboard. Approved
// design direction (mockup v4-triage, after three earlier rounds informed
// by Noon.ai / Spott / Kharta research): a ranked decision queue instead of
// a metrics page, driven by one keyboard grammar shared with CanvasPage
// (j/k move, Enter opens, a approves, x dismisses, / for quick actions).
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useDataProvider, useGetList } from "ra-core";
import { toast } from "sonner";

import type { CrmDataProvider } from "../providers/types";
import type { Deal } from "../types";
import { useInboxDecisions, type InboxDecision } from "./useInboxDecisions";
import { ShortcutsModal } from "./ShortcutsModal";
import { ActivityPanel } from "./ActivityPanel";
import { addActivityEntry, updateActivityEntry } from "./agentActivityStore";
import { SourcingSidebar } from "../sourcing/SourcingSidebar";
import { AgentHShell } from "../shell/AgentHShell";
import { useInboxShellContext } from "../shell/useShellContext";
import "./agent-h-theme.css";

const GROUP_LABEL: Record<InboxDecision["priority"], string> = {
  high: "Now",
  med: "Today",
  low: "This week",
};

const PRIORITY_DOT_COLOR: Record<InboxDecision["priority"], string> = {
  high: "var(--ah-danger)",
  med: "var(--ah-warn)",
  low: "var(--ah-good)",
};

export const InboxPage = () => {
  const navigate = useNavigate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const { decisions, isPending } = useInboxDecisions();
  const { data: openDeals } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 20 },
    sort: { field: "updated_at", order: "DESC" },
    filter: { "archived_at@is": null },
  });

  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [focusIdx, setFocusIdx] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [sourcingOpen, setSourcingOpen] = useState(false);
  const approveCountRef = useRef(0);
  const [showLearningPill, setShowLearningPill] = useState(false);

  const visible = useMemo(
    () => decisions.filter((d) => !dismissedIds.has(d.id)),
    [decisions, dismissedIds],
  );

  useEffect(() => {
    setFocusIdx((i) => Math.min(i, Math.max(0, visible.length - 1)));
  }, [visible.length]);

  const openDecision = (decision: InboxDecision) => {
    if (decision.dealId != null) {
      navigate(`/canvas/${decision.dealId}`);
    } else if (decision.candidateId != null) {
      navigate(`/candidates/${decision.candidateId}/show`);
    }
  };

  const pulseLearning = () => {
    approveCountRef.current += 1;
    if (approveCountRef.current >= 2) {
      setShowLearningPill(true);
      setTimeout(() => setShowLearningPill(false), 4000);
    }
  };

  const approveDecision = async (decision: InboxDecision) => {
    if (decision.kind === "low_pass_rate" && decision.criterionId != null) {
      await dataProvider.relaxLearnedCriterion(decision.criterionId);
      queryClient.invalidateQueries({ queryKey: ["inbox_per_deal_signals"] });
      toast.success("Criterion relaxed — re-scanning that role's pool");
      setDismissedIds((prev) => new Set(prev).add(decision.id));
    } else {
      openDecision(decision);
    }
    pulseLearning();
  };

  const runFreeTextCommand = async (commandText: string) => {
    const logId = addActivityEntry(`"${commandText}"`, "pending");
    try {
      const parsed = await dataProvider.parseAgentCommand(commandText, {
        view: "inbox",
        open_deals: (openDeals ?? []).map((d) => ({ id: d.id, name: d.name })),
        current_deal_id: null,
      });

      if (parsed.action === "create_role") {
        updateActivityEntry(logId, {
          status: "success",
          summary: parsed.explanation,
        });
        navigate("/");
      } else if (
        parsed.action === "continue_sourcing" &&
        parsed.deal_id != null
      ) {
        const dealName =
          openDeals?.find((d) => d.id === parsed.deal_id)?.name ?? "that role";
        updateActivityEntry(logId, {
          summary: `Sourcing more candidates for ${dealName}…`,
        });
        const result = await dataProvider.continueSourcingForDeal(
          parsed.deal_id,
        );
        const filteredNote =
          result.filteredCount > 0
            ? `, ${result.filteredCount} filtered as not relevant`
            : "";
        updateActivityEntry(logId, {
          status: "success",
          summary: `${dealName}: found ${result.foundCount} candidates${filteredNote}`,
        });
        toast.success(
          `Found ${result.foundCount} candidate${result.foundCount === 1 ? "" : "s"} for ${dealName}${filteredNote} — open the role to add to pipeline`,
        );
      } else if (
        parsed.action === "relax_criterion" &&
        parsed.criterion_id != null
      ) {
        await dataProvider.relaxLearnedCriterion(parsed.criterion_id);
        queryClient.invalidateQueries({ queryKey: ["inbox_per_deal_signals"] });
        updateActivityEntry(logId, {
          status: "success",
          summary: parsed.explanation,
        });
        toast.success("Criterion relaxed");
      } else if (
        parsed.action === "show_candidates" &&
        parsed.deal_id != null
      ) {
        updateActivityEntry(logId, {
          status: "success",
          summary: parsed.explanation,
        });
        navigate(`/canvas/${parsed.deal_id}`);
      } else if (parsed.action === "show_roles") {
        updateActivityEntry(logId, {
          status: "success",
          summary: parsed.explanation,
        });
        navigate("/deals");
      } else if (parsed.action === "refine_search_intent") {
        if (parsed.deal_id == null) {
          updateActivityEntry(logId, {
            status: "info",
            summary:
              "Please mention which role to adjust, or open a specific role first.",
          });
          toast(
            "Please mention which role to adjust, or open a specific role first.",
          );
        } else {
          await dataProvider.refineSearchIntent(parsed.deal_id, commandText);
          queryClient.invalidateQueries({
            queryKey: ["inbox_per_deal_signals"],
          });
          queryClient.invalidateQueries({
            queryKey: ["deals", parsed.deal_id],
          });
          updateActivityEntry(logId, {
            status: "success",
            summary: parsed.explanation,
          });
        }
      } else {
        updateActivityEntry(logId, {
          status: "info",
          summary: parsed.explanation,
        });
        toast(parsed.explanation);
      }
    } catch (error) {
      updateActivityEntry(logId, {
        status: "error",
        summary:
          error instanceof Error
            ? error.message
            : "Something went wrong running that command.",
      });
      toast.error("Couldn't run that command");
    }
  };

  const dismissDecision = (decision: InboxDecision) => {
    setDismissedIds((prev) => new Set(prev).add(decision.id));
    toast("Dismissed", {
      action: {
        label: "Undo",
        onClick: () =>
          setDismissedIds((prev) => {
            const next = new Set(prev);
            next.delete(decision.id);
            return next;
          }),
      },
    });
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const typing = document.activeElement?.tagName === "INPUT";
      if (typing) return;
      if (e.key === "?") {
        setShortcutsOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        setShortcutsOpen(false);
        return;
      }
      if (shortcutsOpen) return;
      if (visible.length === 0) return;

      if (e.key === "j")
        setFocusIdx((i) => Math.min(visible.length - 1, i + 1));
      if (e.key === "k") setFocusIdx((i) => Math.max(0, i - 1));
      if (e.key === "Enter") openDecision(visible[focusIdx]);
      if (e.key === "a") approveDecision(visible[focusIdx]);
      if (e.key === "x") dismissDecision(visible[focusIdx]);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, focusIdx, shortcutsOpen]);

  const groups: InboxDecision["priority"][] = ["high", "med", "low"];
  const shellContext = useInboxShellContext({
    pendingDecisionCount: visible.length,
    isPending,
  });

  return (
    <AgentHShell
      context={shellContext}
      commandBar={{
        placeholder: "Tell Agent H what you need",
        hint: "Try: “start a new role for a backend engineer” or “find more candidates for the designer role”.",
        slashActions: [
          { cmd: "/open", label: "Open the focused decision" },
          { cmd: "/relax", label: "Relax a criterion on a role" },
        ],
        onSubmit: runFreeTextCommand,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 22px",
            borderBottom: "1px solid var(--ah-border)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 7,
                background: "var(--ah-accent-grad)",
              }}
            />
            Agent H
          </div>
          {showLearningPill && (
            <div
              className="ah-chip"
              style={{
                background: "var(--ah-accent-soft)",
                borderColor: "var(--ah-accent-soft-border)",
                color: "var(--ah-accent-text)",
              }}
            >
              <div className="ah-pulse-dot" />
              Agent H is adapting to your feedback
            </div>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {/* Recruiter-persona redesign (2026-07-24): starting a new role
              is the single most common thing a recruiter does here, so it
              gets a real, always-visible button -- not something that only
              works if you type the right words into the command bar (see
              /jd-intake's own header comment: it was previously a fully-
              built page with no link pointing to it anywhere in the UI). */}
            <button
              className="ah-btn-primary"
              onClick={() => navigate("/")}
              style={{
                height: 32,
                padding: "0 14px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12.5,
              }}
            >
              + New role
            </button>
            <button
              className="ah-btn-ghost"
              onClick={() => setSourcingOpen((v) => !v)}
              style={{
                height: 32,
                padding: "0 14px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12.5,
                borderColor: sourcingOpen ? "var(--ah-accent)" : undefined,
                color: sourcingOpen ? "var(--ah-accent)" : undefined,
              }}
            >
              &#10024; Sourcing
            </button>
            <button
              className="ah-btn-ghost"
              onClick={() => setActivityOpen((v) => !v)}
              style={{
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderColor: activityOpen ? "var(--ah-accent)" : undefined,
                color: activityOpen ? "var(--ah-accent)" : undefined,
              }}
              aria-label="Agent H activity"
            >
              &#128337;
            </button>
            <button
              className="ah-btn-ghost"
              onClick={() => setShortcutsOpen(true)}
              style={{
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              aria-label="Keyboard shortcuts"
            >
              ?
            </button>
          </div>
        </div>

        <ActivityPanel
          open={activityOpen}
          onClose={() => setActivityOpen(false)}
        />

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px 24px" }}>
          <h1
            style={{
              fontFamily: "var(--ah-serif)",
              fontWeight: 400,
              fontSize: 24,
              margin: "0 0 4px",
            }}
          >
            Good day, Harsha
          </h1>
          <div
            style={{
              fontSize: 13,
              color: "var(--ah-text-2)",
              marginBottom: 18,
            }}
          >
            {isPending
              ? "Checking on your roles…"
              : visible.length === 0
                ? "Nothing needs you right now."
                : `${visible.length} decision${visible.length === 1 ? "" : "s"} need you · `}
            {!isPending && visible.length > 0 && (
              <>
                use <span className="ah-kbd">j</span>{" "}
                <span className="ah-kbd">k</span> to move,{" "}
                <span className="ah-kbd">↵</span> to open,{" "}
                <span className="ah-kbd">a</span> to approve,{" "}
                <span className="ah-kbd">x</span> to dismiss
              </>
            )}
          </div>

          {groups.map((group) => {
            const rows = visible.filter((d) => d.priority === group);
            if (rows.length === 0) return null;
            return (
              <div key={group}>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--ah-text-3)",
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                    margin: "18px 0 8px",
                  }}
                >
                  {GROUP_LABEL[group]}
                </div>
                {rows.map((decision) => {
                  const idx = visible.indexOf(decision);
                  const focused = idx === focusIdx;
                  return (
                    <div
                      key={decision.id}
                      onClick={() => openDecision(decision)}
                      className="ah-glass-card"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        padding: "13px 14px",
                        marginBottom: 7,
                        cursor: "pointer",
                        borderColor: focused ? "var(--ah-accent)" : undefined,
                        background: focused
                          ? "var(--ah-accent-row)"
                          : undefined,
                        boxShadow: focused
                          ? "var(--ah-accent-focus-ring)"
                          : undefined,
                      }}
                    >
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          flexShrink: 0,
                          background: PRIORITY_DOT_COLOR[decision.priority],
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                          {decision.title}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--ah-text-3)",
                            marginTop: 2,
                          }}
                        >
                          {decision.subtitle}
                        </div>
                      </div>
                      {focused && (
                        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                          <span className="ah-kbd">A</span>
                          <span className="ah-kbd">↵</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <ShortcutsModal
          open={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
        />

        <SourcingSidebar
          open={sourcingOpen}
          onClose={() => setSourcingOpen(false)}
          openDeals={openDeals ?? []}
        />
      </div>
    </AgentHShell>
  );
};
