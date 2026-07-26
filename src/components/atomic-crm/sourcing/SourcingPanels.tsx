// Extracted panel components for SourceCandidatesPage — pure display,
// all state/handlers flow in via the `s` sourcing context prop.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  AH_CALLOUT_WARN,
  buildXrayQueries,
  sourcingPanelClass,
  titleCase,
} from "./sourcingTypes";
import { CalibrationFeedbackWidget } from "./CandidateResultsList";
import type { useCandidateSourcing } from "./useCandidateSourcing";

type SourcingContext = ReturnType<typeof useCandidateSourcing>;

// Disabled while per-criterion preview API spend is unbounded; flip to true
// to re-enable once a server-side fix lands.
const CRITERIA_IMPACT_DISABLED = false;

// ---------------------------------------------------------------------------
// RoleBriefPanel — compact collapsible "Searching for:" chip
// ---------------------------------------------------------------------------

export function RoleBriefPanel({
  s,
  embedded,
}: {
  s: SourcingContext;
  embedded: boolean;
}) {
  const d = s.roleBriefDetail;
  const [expanded, setExpanded] = useState(false);
  if (!d) return null;

  // Build a compact one-liner summary
  const summaryParts = [
    d.seniority ? `${d.seniority} ` : "",
    d.name ?? "(untitled role)",
    d.location ? ` · ${d.location}` : "",
    d.years_experience_min || d.years_experience_max
      ? ` · ${d.years_experience_min ?? "0"}–${d.years_experience_max ?? "any"}y exp`
      : "",
  ].join("");

  return (
    <div className={sourcingPanelClass(embedded, "p-3")}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0">
            Searching for
          </span>
          <span className="text-sm font-medium truncate">{summaryParts}</span>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 border-t pt-3">
          <ul className="text-sm list-disc pl-4 flex flex-col gap-0.5">
            {d.must_have_keywords && d.must_have_keywords.length > 0 && (
              <li>Must have: {d.must_have_keywords.join(", ")}</li>
            )}
            {d.required_skills && d.required_skills.length > 0 && (
              <li>Skills: {d.required_skills.join(", ")}</li>
            )}
            {d.nice_to_have_keywords && d.nice_to_have_keywords.length > 0 && (
              <li>Nice to have: {d.nice_to_have_keywords.join(", ")}</li>
            )}
            {d.industry && <li>Industry (preferred): {d.industry}</li>}
            {(d.company_type || d.company_size_min || d.company_size_max) && (
              <li>
                Companies:{" "}
                {[
                  d.company_type,
                  d.company_size_min || d.company_size_max
                    ? `${d.company_size_min ?? "any"}–${d.company_size_max ?? "any"} employees`
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </li>
            )}
            {d.excluded_companies && d.excluded_companies.length > 0 && (
              <li>Excluding: {d.excluded_companies.join(", ")}</li>
            )}
            {d.past_titles && d.past_titles.length > 0 && (
              <li>Boosting past titles: {d.past_titles.join(", ")}</li>
            )}
            {d.past_companies && d.past_companies.length > 0 && (
              <li>Boosting past companies: {d.past_companies.join(", ")}</li>
            )}
          </ul>

          {d.clarifying_questions &&
            d.clarifying_questions.length > 0 &&
            !d.clarifying_questions_dismissed && (
              <div
                className={`flex flex-col gap-2 mt-2 rounded-md p-3 ${AH_CALLOUT_WARN}`}
              >
                <h4 className="text-xs font-medium">
                  Worth confirming before sourcing further
                </h4>
                <ul className="list-disc pl-5 text-xs">
                  {d.clarifying_questions.map((question, i) => (
                    <li key={i}>{question}</li>
                  ))}
                </ul>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={s.handleDismissClarifyingQuestions}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            )}

          {d.preference_tiers && d.preference_tiers.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-2 border-t pt-2">
              {[...d.preference_tiers]
                .sort((a, b) => a.rank - b.rank)
                .map((tier) => (
                  <div key={tier.rank} className="text-sm">
                    <span className="font-medium">{tier.label}: </span>
                    {tier.keywords.join(", ")}
                    {tier.condition && (
                      <span className="text-muted-foreground">
                        {" "}
                        ({tier.condition})
                      </span>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourcingControlPanel — learned-criteria impact only.
// Criteria refinement (tighten / loosen / add) is handled by the
// SourcingSidebar chat — type there rather than duplicating an input here.
// ---------------------------------------------------------------------------

export function SourcingControlPanel({
  s,
  embedded,
  onOpenSidebar,
}: {
  s: SourcingContext;
  embedded: boolean;
  onOpenSidebar?: () => void;
}) {
  if (!s.selectedId) return null;
  // Nothing to show if criteria impact is disabled and nothing is loaded
  const hasCriteria = s.criteriaImpact && s.criteriaImpact.criteria.length > 0;
  if (!hasCriteria && !s.criteriaImpactLoading && !CRITERIA_IMPACT_DISABLED)
    return null;

  return (
    <div
      ref={s.controlPanelRef}
      className={sourcingPanelClass(embedded, "flex flex-col gap-2 p-4")}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Learned criteria</h3>
        {!CRITERIA_IMPACT_DISABLED && (
          <Button
            size="sm"
            variant="outline"
            onClick={s.handleRefreshCriteriaImpact}
            disabled={s.criteriaImpactLoading}
          >
            {s.criteriaImpactLoading
              ? "Computing..."
              : s.criteriaImpact
                ? "Refresh"
                : "Load"}
          </Button>
        )}
      </div>

      {onOpenSidebar && (
        <p className="text-xs text-muted-foreground">
          To tighten or loosen the search, type in the chat sidebar.{" "}
          <button
            type="button"
            onClick={onOpenSidebar}
            className="underline cursor-pointer"
          >
            Open sidebar
          </button>
        </p>
      )}

      {s.criteriaImpact && (
        <>
          {s.criteriaImpact.criteria.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No criteria learned from calibration feedback yet.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {s.criteriaImpact.base_total ?? "?"} candidates match · active
                learned criteria below.
              </p>
              <ul className="flex flex-col gap-1.5">
                {s.criteriaImpact.criteria.map((c) => {
                  const actionState = s.criteriaActionStates[c.id] ?? "idle";
                  return (
                    <li
                      key={c.id}
                      className="flex items-center justify-between gap-3 text-xs border rounded-md p-2"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span
                          className={
                            c.status === "relaxed"
                              ? "text-muted-foreground line-through"
                              : ""
                          }
                        >
                          {c.label}
                        </span>
                        <span className="text-muted-foreground">
                          {c.status === "active"
                            ? c.rejected_count !== null
                              ? `${c.rejected_count} rejected`
                              : "reject count unavailable"
                            : c.rejected_count !== null
                              ? `would reject ${c.rejected_count} if reapplied`
                              : "reapply impact unavailable"}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actionState === "working"}
                        onClick={() =>
                          c.status === "active"
                            ? s.handleRelaxCriterion(c.id)
                            : s.handleReapplyCriterion(c.id)
                        }
                      >
                        {actionState === "working"
                          ? "Working..."
                          : c.status === "active"
                            ? "Relax"
                            : "Reapply"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SearchActionsSection — simplified accordion or preview/restore buttons
// X-ray links moved to a discreet "Advanced ›" toggle at the top.
// ---------------------------------------------------------------------------

export function SearchActionsSection({
  s,
  simplified,
}: {
  s: SourcingContext;
  simplified: boolean;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const xrayQueries = s.roleBriefDetail
    ? buildXrayQueries(s.roleBriefDetail)
    : [];

  if (simplified) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={s.handlePreview}
            disabled={s.previewLoading || !s.selectedId}
            variant="outline"
            size="sm"
          >
            {s.previewLoading ? "Searching..." : "Preview match count"}
          </Button>
          {s.selectedId && s.candidates.length === 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={s.handleRestoreLastSearch}
              disabled={
                s.restoreLoading ||
                s.previewLoading ||
                s.fetchLoading ||
                !s.selectedId
              }
            >
              {s.restoreLoading ? "Restoring..." : "Restore last search"}
            </Button>
          )}
          {xrayQueries.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Advanced {showAdvanced ? "▲" : "›"}
            </button>
          )}
        </div>

        {showAdvanced && (
          <div className="pl-3 border-l border-border flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                X-ray search (open in new tab)
              </p>
              <div className="flex flex-wrap gap-2">
                {xrayQueries.map((q) => (
                  <a
                    key={q.url}
                    href={q.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline text-muted-foreground hover:text-foreground"
                  >
                    {q.label}
                  </a>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Free &amp; low-cost sources
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={s.handleSearchFreePortals}
                  disabled={s.freePortalLoading}
                >
                  {s.freePortalLoading
                    ? "Searching..."
                    : s.freePortalSearched
                      ? "Search again (GitHub, Stack Exchange, Exa)"
                      : "Search GitHub, Stack Exchange, Exa"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={s.handleSearchXray}
                  disabled={s.xrayLoading}
                >
                  {s.xrayLoading
                    ? "Searching..."
                    : "Run X-ray search (LinkedIn)"}
                </Button>
              </div>
              {s.freePortalNotes.length > 0 && (
                <ul className="text-muted-foreground text-xs list-disc pl-4">
                  {s.freePortalNotes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={s.handlePreview}
          disabled={s.previewLoading || !s.selectedId}
        >
          {s.previewLoading ? "Searching..." : "Preview matches"}
        </Button>
        {s.selectedId && s.candidates.length === 0 && (
          <Button
            variant="outline"
            onClick={s.handleRestoreLastSearch}
            disabled={
              s.restoreLoading ||
              s.previewLoading ||
              s.fetchLoading ||
              !s.selectedId
            }
          >
            {s.restoreLoading ? "Restoring..." : "Restore last search"}
          </Button>
        )}
        {xrayQueries.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Advanced {showAdvanced ? "▲" : "›"}
          </button>
        )}
      </div>
      {s.selectedId && s.candidates.length === 0 && (
        <p className="text-xs text-muted-foreground max-w-xl">
          Lost fetched candidates after a refresh? Restore last search reloads
          them from this browser session or from saved search ids (one profile
          lookup each, not a new discovery search).
        </p>
      )}
      {showAdvanced && (
        <div className="pl-3 border-l border-border flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              X-ray links (manual)
            </p>
            <div className="flex flex-wrap gap-2">
              {xrayQueries.map((q) => (
                <a
                  key={q.url}
                  href={q.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline text-muted-foreground hover:text-foreground"
                >
                  {q.label}
                </a>
              ))}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={s.handleSearchFreePortals}
            disabled={s.freePortalLoading}
          >
            {s.freePortalLoading
              ? "Searching..."
              : "Search GitHub, Stack Exchange, Exa"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FreePortalSection — search buttons + notes container (non-simplified only)
// ---------------------------------------------------------------------------

export function FreePortalSection({ s }: { s: SourcingContext }) {
  return (
    <div className="flex flex-col gap-3 border rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">
            Free &amp; low-cost search (GitHub, Stack Exchange, Exa)
          </h3>
          <p className="text-xs text-muted-foreground">
            GitHub/Stack Exchange are official free APIs — no scraping, no
            vendor bill. Exa is a paid, general public-web people-search API
            (roughly $0.015 per search) run alongside them since its cost is
            negligible. Try this before Coresignal, which costs real money per
            candidate record.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={s.handleSearchFreePortals}
          disabled={s.freePortalLoading}
        >
          {s.freePortalLoading
            ? "Searching..."
            : s.freePortalSearched
              ? "Search again"
              : "Search free & low-cost portals"}
        </Button>
      </div>

      <div className="flex items-center justify-between border-t pt-3">
        <div>
          <h4 className="text-xs font-medium">
            X-ray search (LinkedIn, CodeChef, HackerRank)
          </h4>
          <p className="text-xs text-muted-foreground">
            Runs a narrow-to-broad query ladder per site via Exa: exact
            title/location first, then a title synonym, then the candidate's
            state name, then nearby metros, then a skill-only wide net.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={s.handleSearchXray}
          disabled={s.xrayLoading}
        >
          {s.xrayLoading ? "Searching..." : "Run X-ray search"}
        </Button>
      </div>

      {s.freePortalNotes.length > 0 && (
        <ul className="text-muted-foreground text-xs list-disc pl-4">
          {s.freePortalNotes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      )}

      {s.freePortalSearched && s.freePortalCandidates.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No candidates found across these portals for this role brief.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// XrayAssistSection — now hidden from primary flow (merged into Advanced ›)
// Kept as a component for the standalone (non-simplified) route.
// ---------------------------------------------------------------------------

export function XrayAssistSection({ s }: { s: SourcingContext }) {
  if (!s.selectedId || !s.roleBriefDetail) return null;
  const queries = buildXrayQueries(s.roleBriefDetail);
  if (queries.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 border rounded-lg p-4">
      <h3 className="text-sm font-medium">X-ray Assist</h3>
      <p className="text-xs text-muted-foreground">
        Opens a search engine with a ready-made query for this role — you do the
        actual searching and reviewing, same as manual X-ray search always
        worked.
      </p>
      <div className="flex flex-wrap gap-2">
        {queries.map(({ label, url }) => (
          <Button
            key={label}
            size="sm"
            variant="outline"
            type="button"
            onClick={() => window.open(url, "_blank", "noreferrer")}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CalibrationSection — calibration review cards (stage === "previewed")
// ---------------------------------------------------------------------------

export function CalibrationSection({ s }: { s: SourcingContext }) {
  if (s.stage !== "previewed") return null;

  if (!s.calibrationStarted) {
    return (
      <div className="flex flex-col gap-3">
        {s.existingCalibrationFeedback.length > 0 && (
          <p className="text-muted-foreground text-xs">
            You've already calibrated {s.existingCalibrationFeedback.length}{" "}
            candidate(s) for this role brief.
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => s.handleStartCalibration()}
            disabled={s.calibrationLoading || s.total === 0}
          >
            {s.calibrationLoading
              ? "Pulling top matches..."
              : "Calibrate first (review top 3)"}
          </Button>
          <span className="text-muted-foreground text-xs">
            Cheap gut-check before pulling more — mark the top 3 matches fit /
            not a fit with a reason.
          </span>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-2 max-w-[200px]">
            <Label htmlFor="size">
              How many to fetch (max 100 — all saved, top 25 shown)
            </Label>
            <input
              id="size"
              type="number"
              min={1}
              max={100}
              className="border border-input bg-background text-foreground rounded-md h-9 px-2"
              value={s.size}
              onChange={(e) => s.setSize(Number(e.target.value))}
            />
          </div>
          <Button
            onClick={s.handleFetch}
            disabled={s.fetchLoading || s.total === 0}
          >
            {s.fetchLoading ? "Fetching..." : "Fetch candidates"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-medium">
        Calibration: top {s.calibrationCandidates.length} match
        {s.calibrationCandidates.length === 1 ? "" : "es"}
      </h3>
      {s.calibrationCandidates.map((candidate) => {
        const entryState = s.calibrationEntryStates[candidate.id] ?? "idle";
        const submitted = entryState === "submitted";
        return (
          <div
            key={candidate.id}
            className="border rounded-md p-3 flex flex-col gap-2"
          >
            <div>
              <div className="font-medium flex items-center gap-2">
                {titleCase(candidate.full_name) ?? "(name unavailable)"}
                {typeof candidate._match_score === "number" && (
                  <span className="text-xs font-normal text-muted-foreground border rounded px-1.5 py-0.5">
                    Match {Math.round(candidate._match_score * 100)}
                  </span>
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
              {candidate.linkedin_url && (
                <div className="text-sm">
                  <a
                    href={`https://${candidate.linkedin_url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ah-link"
                  >
                    LinkedIn
                  </a>
                </div>
              )}
              {candidate.skills && candidate.skills.length > 0 && (
                <div className="text-xs text-muted-foreground mt-1">
                  Skills: {candidate.skills.slice(0, 10).join(", ")}
                </div>
              )}
              {candidate._match_evidence && (
                <div className={`text-xs mt-1 ${AH_CALLOUT_WARN}`}>
                  Why this surfaced: {candidate._match_evidence}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Check the LinkedIn profile before judging — it may be stale, so
              use your own read on whether it's actually a fit, not just what's
              listed here.
            </p>
            <CalibrationFeedbackWidget
              reason={s.calibrationReasons[candidate.id] ?? ""}
              onReasonChange={(value) =>
                s.setCalibrationReasons((prev) => ({
                  ...prev,
                  [candidate.id]: value,
                }))
              }
              submitted={submitted}
              entryState={entryState}
              onSubmitJudgment={(fit) =>
                s.handleSubmitCalibrationJudgment(candidate, fit)
              }
              contextualizeState={s.contextualizeStates[candidate.id]}
              contextualizeResult={s.contextualizeResults[candidate.id]}
              applyState={s.applyStates[candidate.id] ?? "idle"}
              onApplyCriterion={() => s.handleApplyCriterion(candidate.id)}
            />
          </div>
        );
      })}

      <div className="flex items-end gap-3 pt-2 border-t">
        <div className="flex flex-col gap-2 max-w-[200px]">
          <Label htmlFor="size">How many more to fetch (max 100)</Label>
          <input
            id="size"
            type="number"
            min={1}
            max={100}
            className="border border-input bg-background text-foreground rounded-md h-9 px-2"
            value={s.size}
            onChange={(e) => s.setSize(Number(e.target.value))}
          />
        </div>
        <Button
          onClick={s.handleFetch}
          disabled={s.fetchLoading || s.total === 0}
        >
          {s.fetchLoading ? "Fetching..." : "Fetch candidates"}
        </Button>
      </div>
    </div>
  );
}
