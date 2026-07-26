import { Button } from "@/components/ui/button";
import {
  EMPTY_OFFER_DRAFT,
  sourcingPanelClass,
  getInitials,
  titleCase,
  type MustHaveCheck,
  type PdlCandidate,
} from "./sourcingTypes";
import type { useCandidateSourcing } from "./useCandidateSourcing";
import { CandidateActionsPanel } from "./CandidateActionsPanel";
import { CandidateQuickActionBar } from "./CandidateQuickActionBar";
import { OutreachPreviewPanel } from "./OutreachPreviewPanel";

type SourcingContext = ReturnType<typeof useCandidateSourcing>;

export function MainCandidateList({
  s,
  handleAddToPipeline,
  visibleCount,
  showMore,
  embedded,
}: {
  s: SourcingContext;
  handleAddToPipeline: (candidate: PdlCandidate) => void;
  visibleCount: number;
  showMore: (total: number) => void;
  embedded: boolean;
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
                {s.candidates.length} shown
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                s.controlPanelRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                });
                if (!s.criteriaImpact && !s.criteriaImpactLoading) {
                  void s.handleRefreshCriteriaImpact();
                }
              }}
            >
              Relax criteria
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                s.controlPanelRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                });
                s.steeringInputRef.current?.focus();
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
            <label className="flex items-center gap-2 text-xs bg-accent/40 rounded-md px-2 py-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={s.sortByYearsExperience}
                onChange={(e) => s.setSortByYearsExperience(e.target.checked)}
              />
              Sort by years of experience
            </label>
            <label className="flex items-center gap-2 text-xs bg-accent/40 rounded-md px-2 py-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={s.sortByCompanySize}
                onChange={(e) => s.setSortByCompanySize(e.target.checked)}
              />
              Sort by company size
            </label>
          </div>
        </div>
      )}

      {s.stage === "fetched" && s.candidates.length > 0 && (
        <div className="flex items-center justify-between gap-3 -mt-2">
          <p className="text-xs text-muted-foreground">
            {s.candidates.some((c) => typeof c._match_score === "number")
              ? "Sorted by match score (highest first)."
              : "Candidates shown in discovery order."}{" "}
            {s.backgroundSaving && (
              <span>Saving {s.candidates.length} candidates…</span>
            )}
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
      {s.candidates.slice(0, visibleCount).map((candidate) => {
        const saveState = s.saveStates[candidate.id] ?? "idle";
        const candidateId = s.candidateDbIds[candidate.id];
        const contactState = s.contactEnrichStates[candidate.id] ?? "idle";
        const contactResult = s.contactEnrichResults[candidate.id];
        const devSignalState = s.devSignalEnrichStates[candidate.id] ?? "idle";
        const devSignalResult = s.devSignalEnrichResults[candidate.id];
        const fullProfileState = s.fullProfileStates[candidate.id] ?? "idle";
        const fullProfile = s.fullProfileData[candidate.id];
        const fullProfileIsOpen = Boolean(s.fullProfileExpanded[candidate.id]);
        const scoreState = s.scoreStates[candidate.id] ?? "idle";
        const scoreResult = s.scoreResults[candidate.id];
        const evidenceState = s.evidenceStates[candidate.id] ?? "idle";
        const evidenceResult = s.evidenceResults[candidate.id];
        const fitState = s.fitStates[candidate.id] ?? "idle";
        const fitResult = s.fitResults[candidate.id];
        const interviewState = s.interviewStates[candidate.id] ?? "idle";
        const interviewResult = s.interviewResults[candidate.id];
        const resumeState = s.resumeStates[candidate.id] ?? "idle";
        const resumeInfo = s.resumeInfos[candidate.id];
        const offerState = s.offerStates[candidate.id] ?? "idle";
        const offerInfo = s.offerInfos[candidate.id];
        const offerFormIsOpen = Boolean(s.offerFormOpen[candidate.id]);
        const offerDraft = s.offerDrafts[candidate.id] ?? EMPTY_OFFER_DRAFT;

        return (
          <div
            key={candidate.id}
            className="border rounded-md p-3 flex flex-col gap-3"
          >
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
                <CandidateQuickActionBar
                  emails={candidate.emails}
                  linkedInUrl={candidate.linkedin_url}
                  isLinkedInSource={Boolean(candidate.linkedin_url)}
                  outreachState={s.outreachStates[candidate.id] ?? "idle"}
                  onLinkedInOutreach={() =>
                    s.handleOutreachFromSearch(candidate)
                  }
                />
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
                    {titleCase(candidate.full_name) ?? "(name unavailable)"}
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
                    {candidate.emails && candidate.emails.length > 0 && (
                      <span
                        className="text-xs text-muted-foreground border rounded px-1.5 py-0.5"
                        title="Email on file"
                      >
                        Email
                      </span>
                    )}
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

            {/* Evidence panel (collapsed by default) */}
            {s.selectedId && (
              <div className="border-t pt-2">
                <button
                  type="button"
                  onClick={() => {
                    const isOpen = Boolean(s.evidenceExpanded[candidate.id]);
                    s.setEvidenceExpanded((prev) => ({
                      ...prev,
                      [candidate.id]: !isOpen,
                    }));
                    if (!isOpen) {
                      if (candidateId) {
                        if (!scoreResult && scoreState === "idle") {
                          s.handleScoreCandidate(candidate);
                        }
                      } else if (!evidenceResult && evidenceState === "idle") {
                        s.handleDiscoveryEvidence(candidate);
                      }
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
                    {(candidateId
                      ? scoreState === "loading"
                      : evidenceState === "loading") && (
                      <p className="text-xs text-muted-foreground">
                        Gathering evidence...
                      </p>
                    )}
                    {(() => {
                      const checks = candidateId
                        ? scoreResult?.must_haves_check
                        : evidenceResult;
                      if (
                        (candidateId ? scoreState : evidenceState) ===
                          "loading" ||
                        !checks
                      )
                        return null;
                      if (checks.length === 0) {
                        return (
                          <p className="text-xs text-muted-foreground">
                            No specific evidence available for this candidate.
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

            {candidateId && (
              <CandidateActionsPanel
                candidate={candidate}
                showFullProfile
                contactState={contactState}
                contactResult={contactResult}
                onEnrichContact={() => s.handleEnrichContact(candidate)}
                devSignalState={devSignalState}
                devSignalResult={devSignalResult}
                onEnrichDevSignals={() => s.handleEnrichDevSignals(candidate)}
                fullProfileState={fullProfileState}
                fullProfile={fullProfile}
                fullProfileIsOpen={fullProfileIsOpen}
                onViewFullProfile={() => s.handleViewFullProfile(candidate)}
                scoreState={scoreState}
                scoreResult={scoreResult}
                onScoreCandidate={() => s.handleScoreCandidate(candidate)}
                fitState={fitState}
                fitResult={fitResult}
                onAssessFit={() => s.handleAssessFit(candidate)}
                interviewState={interviewState}
                interviewResult={interviewResult}
                onCreateBookingLink={() =>
                  s.handlePrepareBookingLink(candidate)
                }
                bookingAwaitingConfirm={!!s.bookingPrepared[candidate.id]}
                bookingEmailPreview={
                  s.bookingPrepared[candidate.id]
                    ? s.bookingPrepared[candidate.id]!.email_preview
                    : undefined
                }
                onBookingPreviewChange={(next) =>
                  s.setBookingPrepared((prev) => {
                    const current = prev[candidate.id];
                    if (!current) return prev;
                    return {
                      ...prev,
                      [candidate.id]: { ...current, email_preview: next },
                    };
                  })
                }
                onConfirmSendBookingLink={() =>
                  s.handleConfirmSendBookingLink(candidate)
                }
                onCancelBookingPreview={() =>
                  s.handleCancelBookingPrepared(String(candidate.id))
                }
                bookingSendState={s.bookingSendStates[candidate.id] ?? "idle"}
                resumeState={resumeState}
                resumeInfo={resumeInfo}
                onRequestResume={() => s.handleRequestResume(candidate)}
                onCheckForResume={() => s.handleCheckForResume(candidate)}
                resumeEmailPreview={s.resumeEmailPreviews[candidate.id]}
                onResumePreviewChange={(next) =>
                  s.setResumeEmailPreviews((prev) => ({
                    ...prev,
                    [candidate.id]: next,
                  }))
                }
                onConfirmSendResume={() =>
                  s.handleConfirmSendResumeRequest(candidate)
                }
                onCancelResumePreview={() =>
                  s.handleCancelResumePreview(String(candidate.id))
                }
                resumeSendState={s.resumeSendStates[candidate.id] ?? "idle"}
                offerState={offerState}
                offerInfo={offerInfo}
                offerFormIsOpen={offerFormIsOpen}
                offerDraft={offerDraft}
                onToggleOfferForm={() => s.handleToggleOfferForm(candidate)}
                onOfferDraftChange={(field, value) =>
                  s.handleOfferDraftChange(String(candidate.id), field, value)
                }
                onSendOffer={() => s.handlePrepareOffer(candidate)}
                offerEmailPreview={s.offerEmailPreviews[candidate.id]}
                onOfferPreviewChange={(next) =>
                  s.setOfferEmailPreviews((prev) => ({
                    ...prev,
                    [candidate.id]: next,
                  }))
                }
                onConfirmSendOffer={() => s.handleConfirmSendOffer(candidate)}
                onCancelOfferPreview={() =>
                  s.handleCancelOfferPreview(String(candidate.id))
                }
                offerSendState={s.offerSendStates[candidate.id] ?? "idle"}
                onCheckOffer={() => s.handleCheckOffer(candidate)}
                onMarkOfferStatus={(status) =>
                  s.handleMarkOfferStatus(candidate, status)
                }
                hasEmail={
                  Boolean(candidate.emails?.length) ||
                  Boolean(s.contactEnrichResults[candidate.id]?.email)
                }
                candidateLinkedInUrl={candidate.linkedin_url}
                onPrepareOutreach={() => s.handlePrepareOutreach(candidate)}
                outreachState={s.outreachStates[candidate.id] ?? "idle"}
              />
            )}
            {candidateId && s.outreachPrepared[candidate.id] && (
              <OutreachPreviewPanel
                prepared={s.outreachPrepared[candidate.id]}
                onPreparedChange={(next) =>
                  s.setOutreachPrepared((prev) => ({
                    ...prev,
                    [candidate.id]: next,
                  }))
                }
                onConfirm={() => s.handleConfirmSendOutreach(candidate)}
                onCancel={() =>
                  s.setOutreachPrepared((prev) => {
                    const next = { ...prev };
                    delete next[candidate.id];
                    return next;
                  })
                }
                confirming={s.outreachSendStates[candidate.id] === "loading"}
              />
            )}
          </div>
        );
      })}

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
            Pulls the next batch further down this same search -- not a
            different, looser search.
          </p>
        </div>
      )}
    </div>
  );
}
