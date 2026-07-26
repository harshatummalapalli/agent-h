import { Button } from "@/components/ui/button";
import {
  AH_CALLOUT_WARN,
  EMPTY_OFFER_DRAFT,
  type PdlCandidate,
} from "./sourcingTypes";
import type { useCandidateSourcing } from "./useCandidateSourcing";
import { CalibrationFeedbackWidget } from "./CalibrationFeedbackWidget";
import { CandidateActionsPanel } from "./CandidateActionsPanel";
import { CandidateQuickActionBar } from "./CandidateQuickActionBar";
import { OutreachPreviewPanel } from "./OutreachPreviewPanel";

type SourcingContext = ReturnType<typeof useCandidateSourcing>;

export function FreePortalCandidateList({
  s,
  handleAddToPipeline,
}: {
  s: SourcingContext;
  handleAddToPipeline: (candidate: PdlCandidate) => void;
}) {
  if (s.freePortalCandidates.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {s.freePortalCandidates.map((candidate) => {
        const saveState = s.saveStates[candidate.id] ?? "idle";
        const candidateId = s.candidateDbIds[candidate.id];
        const fitState = s.fitStates[candidate.id] ?? "idle";
        const fitResult = s.fitResults[candidate.id];
        const contactState = s.contactEnrichStates[candidate.id] ?? "idle";
        const contactResult = s.contactEnrichResults[candidate.id];
        const devSignalState = s.devSignalEnrichStates[candidate.id] ?? "idle";
        const devSignalResult = s.devSignalEnrichResults[candidate.id];
        const scoreState = s.scoreStates[candidate.id] ?? "idle";
        const scoreResult = s.scoreResults[candidate.id];
        const interviewState = s.interviewStates[candidate.id] ?? "idle";
        const interviewResult = s.interviewResults[candidate.id];
        const resumeState = s.resumeStates[candidate.id] ?? "idle";
        const resumeInfo = s.resumeInfos[candidate.id];
        const offerState = s.offerStates[candidate.id] ?? "idle";
        const offerInfo = s.offerInfos[candidate.id];
        const offerFormIsOpen = Boolean(s.offerFormOpen[candidate.id]);
        const offerDraft = s.offerDrafts[candidate.id] ?? EMPTY_OFFER_DRAFT;
        const calibEntryState =
          s.calibrationEntryStates[candidate.id] ?? "idle";
        const calibSubmitted = calibEntryState === "submitted";

        return (
          <li
            key={candidate.id}
            className="flex flex-col gap-3 border rounded-md p-3 text-sm"
          >
            <CandidateQuickActionBar
              emails={candidate.emails}
              linkedInUrl={candidate.linkedin_url}
              isLinkedInSource={Boolean(candidate.linkedin_url)}
              outreachState={s.outreachStates[candidate.id] ?? "idle"}
              onLinkedInOutreach={() => s.handleOutreachFromSearch(candidate)}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">
                    {candidate.full_name ?? candidate.id}
                  </span>
                  <span className="text-xs uppercase text-muted-foreground border rounded px-1">
                    {candidate._source_vendor}
                  </span>
                  {candidate._all_portals &&
                    candidate._all_portals.length > 1 &&
                    candidate._all_portals
                      .filter((p) => p.vendor !== candidate._source_vendor)
                      .map((p, i) => (
                        <span
                          key={i}
                          className="text-xs uppercase text-muted-foreground border rounded px-1"
                        >
                          +{p.vendor}
                        </span>
                      ))}
                  {(candidate._source_vendor === "huggingface" ||
                    candidate._source_vendor === "kaggle" ||
                    candidate._source_vendor === "exa") &&
                    s.roleBriefDetail?.location &&
                    !/remote/i.test(s.roleBriefDetail.location) && (
                      <span className="text-xs ah-text-warn border border-current rounded px-1">
                        location unverified
                      </span>
                    )}
                </div>
                {candidate.job_title && (
                  <span className="text-muted-foreground text-xs">
                    {candidate.job_title}
                  </span>
                )}
                {candidate.location_name && (
                  <span className="text-muted-foreground text-xs">
                    {candidate.location_name}
                  </span>
                )}
                {candidate._match_evidence && (
                  <div className={`text-xs mt-1 ${AH_CALLOUT_WARN}`}>
                    Why this surfaced: {candidate._match_evidence}
                  </div>
                )}
                <div className="flex gap-2 flex-wrap">
                  {candidate._portal_url && (
                    <a
                      href={candidate._portal_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs underline text-muted-foreground"
                    >
                      View profile
                    </a>
                  )}
                  {candidate._all_portals
                    ?.filter((p) => p.url && p.url !== candidate._portal_url)
                    .map((p, i) => (
                      <a
                        key={i}
                        href={p.url ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline text-muted-foreground"
                      >
                        View on {p.vendor}
                      </a>
                    ))}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={saveState !== "idle" || candidate._already_saved}
                onClick={() => handleAddToPipeline(candidate)}
              >
                {candidate._already_saved
                  ? "Already saved"
                  : saveState === "saving"
                    ? "Saving..."
                    : saveState === "saved"
                      ? "Saved"
                      : "Add to pipeline"}
              </Button>
            </div>

            {candidateId && (
              <CandidateActionsPanel
                candidate={candidate}
                showFullProfile={false}
                contactState={contactState}
                contactResult={contactResult}
                onEnrichContact={() => s.handleEnrichContact(candidate)}
                devSignalState={devSignalState}
                devSignalResult={devSignalResult}
                onEnrichDevSignals={() => s.handleEnrichDevSignals(candidate)}
                fullProfileState="idle"
                fullProfile={undefined}
                fullProfileIsOpen={false}
                onViewFullProfile={() => {}}
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

            <CalibrationFeedbackWidget
              reason={s.calibrationReasons[candidate.id] ?? ""}
              onReasonChange={(value) =>
                s.setCalibrationReasons((prev) => ({
                  ...prev,
                  [candidate.id]: value,
                }))
              }
              submitted={calibSubmitted}
              entryState={calibEntryState}
              onSubmitJudgment={(fit) =>
                s.handleSubmitCalibrationJudgment(candidate, fit)
              }
              contextualizeState={s.contextualizeStates[candidate.id]}
              contextualizeResult={s.contextualizeResults[candidate.id]}
              applyState={s.applyStates[candidate.id] ?? "idle"}
              onApplyCriterion={() => s.handleApplyCriterion(candidate.id)}
            />
          </li>
        );
      })}
    </ul>
  );
}
