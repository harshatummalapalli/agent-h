import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import {
  AH_CALLOUT_WARN,
  sourcingPanelClass,
  getInitials,
  titleCase,
  type MustHaveCheck,
  type PdlCandidate,
} from "./sourcingTypes";
import type { useCandidateSourcing } from "./useCandidateSourcing";
import { CandidateQuickActionBar } from "./CandidateQuickActionBar";

type SourcingContext = ReturnType<typeof useCandidateSourcing>;

export function MainCandidateList({
  s,
  handleAddToPipeline,
  visibleCount,
  showMore,
  embedded,
  onOpenSidebar,
}: {
  s: SourcingContext;
  handleAddToPipeline: (candidate: PdlCandidate) => void;
  visibleCount: number;
  showMore: (total: number) => void;
  embedded: boolean;
  onOpenSidebar?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Funnel bar + sort controls */}
      {s.stage === "fetched" && s.candidates.length > 0 && (
        <div
          className={sourcingPanelClass(
            embedded,
            "flex items-center justify-between gap-3 flex-wrap p-3",
            "md",
          )}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-sm text-muted-foreground">
              {s.totalMatchesAll !== null
                ? `${s.totalMatchesAll.toLocaleString()} candidates match · `
                : ""}
              <span className="text-foreground font-medium">
                {s.candidates.length} fetched
              </span>
              {s.candidates.length > 25 && (
                <span className="text-muted-foreground">
                  {" "}
                  · showing top 25 first
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (onOpenSidebar) {
                  onOpenSidebar();
                } else {
                  s.controlPanelRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  });
                }
              }}
            >
              Relax criteria
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (onOpenSidebar) {
                  onOpenSidebar();
                } else {
                  s.controlPanelRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  });
                }
              }}
            >
              Tighten
            </Button>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Sort by
              <select
                className="border border-input bg-background text-foreground rounded-md h-8 px-2 text-xs"
                value={s.sortField}
                onChange={(e) => s.setSortField(e.target.value as any)}
              >
                <option value="default">Default order</option>
                <option value="name">Name (A&ndash;Z)</option>
                <option value="location">Location</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs bg-accent/40 rounded-md px-2 py-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={s.sortByMatchEvidence}
                onChange={(e) => s.setSortByMatchEvidence(e.target.checked)}
              />
              Sort by match evidence
            </label>
          </div>
        </div>
      )}

      {s.stage === "fetched" && s.candidates.length > 0 && (
        <div className="flex items-center justify-between gap-3 -mt-2">
          <p className="text-xs text-muted-foreground">
            {s.candidates.some((c) => c._llm_rank != null)
              ? "Top 25 ranked by AI fit — best matches first."
              : s.candidates.some((c) => typeof c._match_score === "number")
                ? "Sorted by match score (highest first)."
                : "Candidates shown in discovery order."}{" "}
          </p>
          {s.bulkSelected.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {s.bulkSelected.size} selected
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => s.setBulkSelected(new Set())}
              >
                Clear
              </Button>
              <Button
                size="sm"
                disabled={s.bulkPreparing}
                onClick={s.handleBulkPrepareOutreach}
              >
                {s.bulkPreparing
                  ? "Preparing..."
                  : `Prepare outreach (${s.bulkSelected.size})`}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Candidate cards */}
      {(() => {
        const hasLlmRanks = s.candidates.some((c) => c._llm_rank != null);
        const ranked25Count = hasLlmRanks
          ? s.candidates.filter((c) => c._llm_rank != null).length
          : 0;
        return s.candidates.slice(0, visibleCount).map((candidate, idx) => {
          const saveState = s.saveStates[candidate.id] ?? "idle";
          const candidateId = s.candidateDbIds[candidate.id];
          const evidenceState = s.evidenceStates[candidate.id] ?? "idle";
          const evidenceResult = s.evidenceResults[candidate.id];
          const isFirstUnranked =
            hasLlmRanks && candidate._llm_rank == null && idx === ranked25Count;

          return (
            <div key={candidate.id}>
              {isFirstUnranked && (
                <div className="flex items-center gap-2 py-2 my-1">
                  <div className="flex-1 border-t border-dashed" />
                  <span className="text-xs text-muted-foreground shrink-0">
                    Additional candidates ({s.candidates.length - ranked25Count}{" "}
                    more)
                  </span>
                  <div className="flex-1 border-t border-dashed" />
                </div>
              )}
              <div className="border rounded-md p-3 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={`Select ${candidate.full_name ?? candidate.id} for bulk outreach`}
                    checked={s.bulkSelected.has(candidate.id)}
                    onChange={(e) => {
                      s.setBulkSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(candidate.id);
                        else next.delete(candidate.id);
                        return next;
                      });
                    }}
                    className="w-4 h-4 shrink-0"
                  />
                  <div className="flex-1">
                    <CandidateQuickActionBar emails={candidate.emails} />
                  </div>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <div
                      className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground shrink-0"
                      aria-hidden="true"
                    >
                      {getInitials(candidate.full_name)}
                    </div>
                    <div>
                      <div className="font-medium">
                        {candidateId ? (
                          <Link
                            to={`/candidates/${candidateId}/show`}
                            className="hover:underline"
                          >
                            {titleCase(candidate.full_name) ??
                              "(name unavailable)"}
                          </Link>
                        ) : (
                          (titleCase(candidate.full_name) ??
                          "(name unavailable)")
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {titleCase(candidate.job_title)}
                        {candidate.job_company_name
                          ? ` at ${titleCase(candidate.job_company_name)}`
                          : ""}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {titleCase(candidate.location_name)}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {candidate.linkedin_url && (
                          <a
                            href={`https://${candidate.linkedin_url}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs ah-link"
                          >
                            LinkedIn
                          </a>
                        )}
                      </div>
                      {candidate.skills && candidate.skills.length > 0 && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Skills: {candidate.skills.slice(0, 10).join(", ")}
                        </div>
                      )}
                      {candidate._llm_why_fit && (
                        <div className="text-xs mt-1 text-muted-foreground italic">
                          {candidate._llm_why_fit}
                        </div>
                      )}
                      {candidate._match_evidence && (
                        <div className={`text-xs mt-1 ${AH_CALLOUT_WARN}`}>
                          {candidate._match_evidence}
                        </div>
                      )}
                    </div>
                  </div>

                  <Button
                    variant={saveState === "saved" ? "outline" : "default"}
                    disabled={saveState === "saving" || saveState === "saved"}
                    onClick={() => handleAddToPipeline(candidate)}
                    className="shrink-0"
                  >
                    {saveState === "saved"
                      ? "Added"
                      : saveState === "saving"
                        ? "Adding..."
                        : "Add to pipeline"}
                  </Button>
                </div>

                {/* Why this could be a fit — auto-expanded for scored candidates */}
                {s.selectedId && (
                  <div className="border-t pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        const isOpen = Boolean(
                          s.evidenceExpanded[candidate.id],
                        );
                        s.setEvidenceExpanded((prev) => ({
                          ...prev,
                          [candidate.id]: !isOpen,
                        }));
                        if (
                          !isOpen &&
                          !evidenceResult &&
                          evidenceState === "idle"
                        ) {
                          s.handleDiscoveryEvidence(candidate);
                        }
                      }}
                      className="text-xs ah-link flex items-center gap-1"
                    >
                      Why this could be a fit
                      <span aria-hidden="true">
                        {s.evidenceExpanded[candidate.id] ? "▲" : "▼"}
                      </span>
                    </button>
                    {s.evidenceExpanded[candidate.id] && (
                      <div className="mt-2 flex flex-col gap-1">
                        {evidenceState === "loading" && (
                          <p className="text-xs text-muted-foreground">
                            Gathering evidence...
                          </p>
                        )}
                        {(() => {
                          const checks = evidenceResult;
                          if (evidenceState === "loading" || !checks)
                            return null;
                          if (checks.length === 0) {
                            return (
                              <p className="text-xs text-muted-foreground">
                                No specific evidence available for this
                                candidate.
                              </p>
                            );
                          }
                          return checks.map((m: MustHaveCheck, i: number) => (
                            <div
                              key={i}
                              className="text-xs flex items-center gap-1.5"
                            >
                              <span
                                className={
                                  m.status === "found"
                                    ? "ah-text-good"
                                    : m.status === "inferred"
                                      ? "ah-text-warn"
                                      : "ah-text-danger"
                                }
                                aria-hidden="true"
                              >
                                {m.status === "found"
                                  ? "✓"
                                  : m.status === "inferred"
                                    ? "~"
                                    : "✗"}
                              </span>
                              <span>{m.requirement}</span>
                            </div>
                          ));
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        });
      })()}

      {s.stage === "fetched" && visibleCount < s.candidates.length && (
        <Button variant="outline" onClick={() => showMore(s.candidates.length)}>
          Show more ({s.candidates.length - visibleCount} remaining)
        </Button>
      )}

      {s.stage === "fetched" && (
        <div className="flex flex-col gap-1">
          <Button
            variant="outline"
            onClick={s.handleSearchWider}
            disabled={!s.canSearchWider || s.wideningLoading}
          >
            {s.wideningLoading
              ? "Fetching more..."
              : s.canSearchWider
                ? `Search wider (${s.candidates.length} of ${s.total} reviewed)`
                : `All ${s.total} match(es) reviewed`}
          </Button>
          <p className="text-muted-foreground text-xs">
            Pulls the next batch further down this same search — not a
            different, looser search.
          </p>
        </div>
      )}
    </div>
  );
}
