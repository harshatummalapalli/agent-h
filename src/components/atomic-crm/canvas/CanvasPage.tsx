// Agent H, Command Canvas: the drill-in from InboxPage, scoped to one
// role's sourced candidates. Structured, checkbox-selectable, sortable --
// deliberately NOT a chat thread and NOT cards-only, per the approved
// v3/v4 mockups' resolution of "conversational intent vs. scannable bulk
// action" (chat is good at "tell it what to do", bad at "scan 40 rows").
import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { useParams, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDataProvider, useGetOne } from "ra-core";
import { toast } from "sonner";

import type { CrmDataProvider } from "../providers/types";
import { CommandBar } from "../inbox/CommandBar";
import { ShortcutsModal } from "../inbox/ShortcutsModal";
import { ActivityPanel } from "../inbox/ActivityPanel";
import { addActivityEntry, updateActivityEntry } from "../inbox/agentActivityStore";
import "../inbox/agent-h-theme.css";

const CONFIDENT_MATCH_THRESHOLD = 0.85;

export const CanvasPage = () => {
  const { dealId } = useParams();
  const navigate = useNavigate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();

  const { data: deal } = useGetOne("deals", { id: dealId! }, { enabled: !!dealId });

  const { data: rows, isPending } = useQuery({
    queryKey: ["deal_candidates_for_deal", dealId],
    queryFn: () => dataProvider.getCandidatesForDeal(dealId!),
    enabled: !!dealId,
  });

  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [expandedId, setExpandedId] = useState<string | number | null>(null);
  const [expandedScore, setExpandedScore] = useState<Record<string, any>>({});
  const [focusIdx, setFocusIdx] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  // Design decision (2026-07-22, superseding the prior emergency disable):
  // this used to auto-fire getRoleBriefCriteriaImpact on every CanvasPage
  // mount -- one live Coresignal search per learned criterion for this deal,
  // uncapped, with no cache, just from opening the page. source-candidates-
  // discovery's criteria_impact mode is now capped and cached server-side,
  // but Harsha's call was that this data should still only be fetched
  // on-demand, not proactively -- so instead of firing on mount, this now
  // only fires once the recruiter actually opens the "Live criteria &
  // stats" drawer (`enabled: drawerOpen`), and stays off otherwise.
  const { data: criteriaImpact } = useQuery({
    queryKey: ["role_brief_criteria_impact", dealId],
    queryFn: () => dataProvider.getRoleBriefCriteriaImpact(dealId!),
    enabled: !!dealId && drawerOpen,
  });

  const list = rows ?? [];

  const toggleSelect = (id: string | number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpand = async (candidateId: string | number, dealCandidateId: string | number) => {
    if (expandedId === dealCandidateId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(dealCandidateId);
    if (!expandedScore[String(dealCandidateId)]) {
      const score = await dataProvider.getCandidateScore(candidateId, dealId!).catch(() => null);
      setExpandedScore((prev) => ({ ...prev, [String(dealCandidateId)]: score }));
    }
  };

  const invalidateCandidates = () =>
    queryClient.invalidateQueries({ queryKey: ["deal_candidates_for_deal", dealId] });

  const rejectRows = async (dealCandidateIds: (string | number)[]) => {
    const removed = list.filter((r) => dealCandidateIds.includes(r.dealCandidate.id));
    for (const id of dealCandidateIds) {
      await dataProvider.rejectDealCandidate(id);
    }
    invalidateCandidates();
    setSelected(new Set());
    toast.success(`Rejected ${dealCandidateIds.length} candidate${dealCandidateIds.length === 1 ? "" : "s"}`, {
      action: {
        label: "Undo",
        onClick: async () => {
          for (const r of removed) {
            await dataProvider.undoRejectDealCandidate(r.dealCandidate);
          }
          invalidateCandidates();
        },
      },
    });
  };

  const requestResumeForRows = async (candidateIds: (string | number)[]) => {
    await Promise.all(candidateIds.map((id) => dataProvider.requestCandidateResume(id, dealId!)));
    setSelected(new Set());
    toast.success(`Requested resume from ${candidateIds.length} candidate${candidateIds.length === 1 ? "" : "s"}`);
  };

  const relaxCriterion = async (criterionId: string | number) => {
    await dataProvider.relaxLearnedCriterion(criterionId);
    queryClient.invalidateQueries({ queryKey: ["role_brief_criteria_impact", dealId] });
    toast.success("Criterion relaxed — re-scanning this role's pool");
  };

  const runFreeTextCommand = async (commandText: string) => {
    const logId = addActivityEntry(`"${commandText}"`, "pending");
    try {
      const parsed = await dataProvider.parseAgentCommand(commandText, {
        view: "canvas",
        open_deals: deal ? [{ id: deal.id, name: deal.name }] : [],
        current_deal_id: dealId,
        active_criteria: (criteriaImpact?.criteria ?? [])
          .filter((c: any) => c.status === "active")
          .map((c: any) => ({ id: c.id, label: c.label })),
        selected_candidate_count: selected.size,
      });

      if (parsed.action === "continue_sourcing" && parsed.deal_id != null) {
        updateActivityEntry(logId, { summary: `Sourcing more candidates for ${deal?.name ?? "this role"}…` });
        const result = await dataProvider.continueSourcingForDeal(parsed.deal_id);
        invalidateCandidates();
        const filteredNote = result.filteredCount > 0 ? `, ${result.filteredCount} filtered as not relevant` : "";
        updateActivityEntry(logId, {
          status: "success",
          summary: `Found ${result.foundCount}, saved ${result.savedCount} to pipeline${filteredNote}`,
        });
        toast.success(`Found ${result.foundCount}, saved ${result.savedCount} new candidates${filteredNote}`);
      } else if (parsed.action === "relax_criterion" && parsed.criterion_id != null) {
        await relaxCriterion(parsed.criterion_id);
        updateActivityEntry(logId, { status: "success", summary: parsed.explanation });
      } else if (parsed.action === "request_resume" && parsed.use_selected_candidates && selected.size > 0) {
        const candidateIds = list
          .filter((r) => selected.has(r.dealCandidate.id))
          .map((r) => r.candidate.id);
        await requestResumeForRows(candidateIds);
        updateActivityEntry(logId, { status: "success", summary: parsed.explanation });
      } else if (parsed.action === "reject_candidates" && parsed.use_selected_candidates && selected.size > 0) {
        await rejectRows(Array.from(selected));
        updateActivityEntry(logId, { status: "success", summary: parsed.explanation });
      } else if (parsed.action === "show_candidates") {
        updateActivityEntry(logId, { status: "success", summary: "You're already looking at this role's sourced candidates below." });
        toast("Already showing this role's candidates below.");
      } else if (parsed.action === "show_roles") {
        updateActivityEntry(logId, { status: "success", summary: parsed.explanation });
        navigate("/deals");
      } else {
        updateActivityEntry(logId, { status: "info", summary: parsed.explanation });
        toast(parsed.explanation);
      }
    } catch (error) {
      updateActivityEntry(logId, {
        status: "error",
        summary: error instanceof Error ? error.message : "Something went wrong running that command.",
      });
      toast.error("Couldn't run that command");
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const typing = document.activeElement?.tagName === "INPUT";
      if (typing) return;
      if (e.key === "?") {
        setShortcutsOpen((v) => !v);
        return;
      }
      if (shortcutsOpen) {
        if (e.key === "Escape") setShortcutsOpen(false);
        return;
      }
      if (e.key === "Escape") {
        navigate("/");
        return;
      }
      if (list.length === 0) return;

      if (e.key === "j") setFocusIdx((i) => Math.min(list.length - 1, i + 1));
      if (e.key === "k") setFocusIdx((i) => Math.max(0, i - 1));
      if (e.key === " ") {
        e.preventDefault();
        toggleSelect(list[focusIdx].dealCandidate.id);
      }
      if (e.key === "Enter") {
        const row = list[focusIdx];
        toggleExpand(row.candidate.id, row.dealCandidate.id);
      }
      if (e.key === "a") requestResumeForRows([list[focusIdx].candidate.id]);
      if (e.key === "x") rejectRows([list[focusIdx].dealCandidate.id]);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, focusIdx, shortcutsOpen]);

  return (
    <div className="ah-scope" style={{ display: "grid", gridTemplateRows: "auto 1fr auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 22px", borderBottom: "1px solid var(--ah-border)" }}>
        <div
          onClick={() => navigate("/")}
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ah-text-2)", cursor: "pointer" }}
        >
          &larr; All decisions
        </div>
        <div className="ah-chip">{deal?.name ?? "Role"}</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button
            className="ah-btn-ghost"
            onClick={() => setActivityOpen((v) => !v)}
            style={{
              width: 32,
              height: 32,
              borderColor: activityOpen ? "var(--ah-accent)" : undefined,
              color: activityOpen ? "var(--ah-accent)" : undefined,
            }}
            aria-label="Agent H activity"
          >
            &#128337;
          </button>
          <button className="ah-btn-ghost" onClick={() => setShortcutsOpen(true)} style={{ width: 32, height: 32 }}>
            ?
          </button>
          <button
            className="ah-btn-ghost"
            onClick={() => setDrawerOpen((v) => !v)}
            style={{
              width: 32,
              height: 32,
              borderColor: drawerOpen ? "var(--ah-accent)" : undefined,
              color: drawerOpen ? "var(--ah-accent)" : undefined,
            }}
            aria-label="Show criteria & stats"
          >
            &#9881;
          </button>
        </div>
      </div>

      <ActivityPanel open={activityOpen} onClose={() => setActivityOpen(false)} />

      <div style={{ display: "flex", minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "16px 22px 0", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <h1 style={{ fontFamily: "var(--ah-serif)", fontWeight: 400, fontSize: 20, margin: 0 }}>
              {deal?.name ?? "Candidates"}
            </h1>
            <span style={{ fontSize: 12, color: "var(--ah-text-3)" }}>
              {isPending ? "Loading…" : `${list.length} sourced`}
            </span>
          </div>

          <div className="ah-glass-card" style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thStyle("32px")}>
                    <input
                      type="checkbox"
                      checked={selected.size === list.length && list.length > 0}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(list.map((r) => r.dealCandidate.id)) : new Set())
                      }
                    />
                  </th>
                  <th style={thStyle()}>Candidate</th>
                  <th style={thStyle("70px")}>Match</th>
                  <th style={thStyle("140px")}>Status</th>
                  <th style={thStyle("50px")} />
                </tr>
              </thead>
              <tbody>
                {list.map(({ dealCandidate, candidate }, idx) => {
                  const name = [candidate.first_name, candidate.last_name].filter(Boolean).join(" ") || "(no name on file)";
                  const pct = dealCandidate.match_score != null ? Math.round(dealCandidate.match_score * 100) : null;
                  const confident = (dealCandidate.match_score ?? 0) >= CONFIDENT_MATCH_THRESHOLD;
                  const isFocused = idx === focusIdx;
                  const isExpanded = expandedId === dealCandidate.id;
                  const score = expandedScore[String(dealCandidate.id)];
                  return (
                    <Fragment key={dealCandidate.id}>
                      <tr
                        onClick={() => setFocusIdx(idx)}
                        style={{
                          outline: isFocused ? "1.5px solid var(--ah-accent)" : undefined,
                          outlineOffset: "-1.5px",
                          background: selected.has(dealCandidate.id) ? "rgba(124,108,255,0.07)" : undefined,
                          cursor: "pointer",
                        }}
                      >
                        <td style={tdStyle}>
                          <input
                            type="checkbox"
                            checked={selected.has(dealCandidate.id)}
                            onChange={() => toggleSelect(dealCandidate.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td style={tdStyle}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div
                              style={{
                                width: 30,
                                height: 30,
                                borderRadius: "50%",
                                background: "linear-gradient(135deg,#5aa0ff,#7c6cff)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 11,
                                fontWeight: 700,
                                color: "#0a0b0f",
                                flexShrink: 0,
                              }}
                            >
                              {name.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{name}</div>
                              <div style={{ fontSize: 11.5, color: "var(--ah-text-3)" }}>
                                {candidate.current_title ?? "No title on file"}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ ...tdStyle, fontWeight: 700, color: confident ? "var(--ah-good)" : "var(--ah-warn)" }}>
                          {pct != null ? `${pct}%` : "—"}
                        </td>
                        <td style={tdStyle}>
                          <span
                            className="ah-chip"
                            style={confident ? { background: "rgba(124,108,255,0.14)", color: "#bfb6ff", borderColor: "transparent" } : {}}
                          >
                            {confident ? "Confident match" : "Needs review"}
                          </span>
                        </td>
                        <td style={tdStyle}>
                          <button
                            className="ah-btn-ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpand(candidate.id, dealCandidate.id);
                            }}
                            style={{ width: 26, height: 26, fontSize: 11 }}
                          >
                            {isExpanded ? "⤥" : "⤤"}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={5} style={{ background: "rgba(255,255,255,0.015)", padding: "0 14px 14px 56px", fontSize: 12.5, color: "var(--ah-text-2)" }}>
                            {!score ? (
                              "Loading evidence…"
                            ) : score.must_haves_check?.length ? (
                              score.must_haves_check.map((m: any, i: number) => (
                                <div key={i} style={{ display: "flex", gap: 8, padding: "5px 0", alignItems: "flex-start" }}>
                                  <span
                                    style={{
                                      width: 14,
                                      height: 14,
                                      borderRadius: "50%",
                                      flexShrink: 0,
                                      marginTop: 2,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: 9,
                                      background: m.status === "absent" ? "rgba(255,107,107,0.18)" : "rgba(79,216,196,0.18)",
                                      color: m.status === "absent" ? "var(--ah-danger)" : "var(--ah-good)",
                                    }}
                                  >
                                    {m.status === "absent" ? "✕" : "✓"}
                                  </span>
                                  <span>
                                    <b style={{ color: "var(--ah-text-1)" }}>{m.requirement}</b> — {m.status}
                                  </span>
                                </div>
                              ))
                            ) : (
                              "No scoring evidence on file yet for this candidate — run Score from the role workspace."
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected.size > 0 && (
            <div
              style={{
                position: "absolute",
                bottom: 96,
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                alignItems: "center",
                gap: 12,
                background: "var(--ah-bg-1)",
                border: "1px solid var(--ah-border-strong)",
                borderRadius: 100,
                padding: "8px 8px 8px 18px",
                boxShadow: "0 20px 50px rgba(0,0,0,0.45)",
                zIndex: 35,
              }}
            >
              <span style={{ fontSize: 13, color: "var(--ah-text-2)" }}>{selected.size} selected</span>
              <button
                className="ah-btn-primary"
                style={{ fontSize: 12.5, padding: "8px 14px" }}
                onClick={() =>
                  requestResumeForRows(
                    list.filter((r) => selected.has(r.dealCandidate.id)).map((r) => r.candidate.id),
                  )
                }
              >
                Request resume
              </button>
              <button className="ah-btn-ghost" style={{ fontSize: 12.5, padding: "8px 14px", color: "var(--ah-danger)" }} onClick={() => rejectRows(Array.from(selected))}>
                Reject
              </button>
            </div>
          )}
        </div>

        {drawerOpen && (
          <div style={{ width: 280, flexShrink: 0, borderLeft: "1px solid var(--ah-border)", background: "var(--ah-bg-1)", padding: 16, overflowY: "auto" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Live criteria & stats</div>
            {criteriaImpact?.base_total != null && (
              <div style={{ fontSize: 12, color: "var(--ah-text-3)", marginBottom: 12 }}>
                {criteriaImpact.base_total} candidates seen for this role
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(criteriaImpact?.criteria ?? [])
                .filter((c: any) => c.status === "active")
                .map((c: any) => (
                  <div key={c.id} className="ah-glass-card" style={{ padding: "9px 11px" }}>
                    <div style={{ fontSize: 11.5, color: "var(--ah-text-2)", marginBottom: 7 }}>{c.label}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 10.5, color: "var(--ah-danger)", fontWeight: 600 }}>
                        {c.rejected_count ?? 0} rejected
                      </span>
                      <button className="ah-btn-ghost" style={{ fontSize: 10.5, padding: "3px 8px" }} onClick={() => relaxCriterion(c.id)}>
                        Relax
                      </button>
                    </div>
                  </div>
                ))}
              {(!criteriaImpact?.criteria || criteriaImpact.criteria.length === 0) && (
                <div style={{ fontSize: 12, color: "var(--ah-text-3)" }}>No active criteria on file for this role yet.</div>
              )}
            </div>
          </div>
        )}
      </div>

      <CommandBar
        placeholder="Type / for quick actions, or tell Agent H what to do with these candidates"
        hint="Selection-aware: pick rows above, then use /reject or /request-resume, or just describe it."
        slashActions={[
          { cmd: "/reject", label: "Reject selected candidates" },
          { cmd: "/request-resume", label: "Request resume from selected" },
          { cmd: "/relax", label: "Relax a criterion (see drawer)" },
        ]}
        onSubmit={(value) => {
          if (value.startsWith("/reject") && selected.size > 0) {
            rejectRows(Array.from(selected));
          } else if (value.startsWith("/request-resume") && selected.size > 0) {
            const candidateIds = list.filter((r) => selected.has(r.dealCandidate.id)).map((r) => r.candidate.id);
            requestResumeForRows(candidateIds);
          } else if (value.startsWith("/")) {
            toast("That's not a quick action yet — try describing what you want in plain English.");
          } else {
            runFreeTextCommand(value);
          }
        }}
      />

      <ShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        extraRows={[{ label: "Toggle row selection", keys: "space" }]}
      />
    </div>
  );
};

const thStyle = (width?: string): CSSProperties => ({
  position: "sticky",
  top: 0,
  background: "var(--ah-bg-1)",
  textAlign: "left",
  padding: "9px 14px",
  fontSize: 10.5,
  color: "var(--ah-text-3)",
  textTransform: "uppercase",
  letterSpacing: ".03em",
  fontWeight: 600,
  borderBottom: "1px solid var(--ah-border)",
  width,
});

const tdStyle: CSSProperties = {
  padding: "9px 14px",
  borderBottom: "1px solid var(--ah-border)",
  verticalAlign: "middle",
};

CanvasPage.path = "/canvas/:dealId";
