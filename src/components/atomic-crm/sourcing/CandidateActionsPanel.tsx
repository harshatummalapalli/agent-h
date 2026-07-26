import { Button } from "@/components/ui/button";
import {
  EmailPreviewApprovalPanel,
  FitAssessmentPanel,
  FullProfilePanel,
  InterviewPanel,
  OfferForm,
  OfferPanel,
  ResumePanel,
  ScorePanel,
} from "./candidatePanels";
import {
  AH_CALLOUT_WARN,
  type ContactEnrichResult,
  type DevSignalEnrichResult,
  type EmailPreview,
  type EnrichState,
  type FitAssessmentResult,
  type FullProfileData,
  type InterviewResult,
  type OfferDraft,
  type OfferInfo,
  type PdlCandidate,
  type ResumeInfo,
  type ScoreResult,
} from "./sourcingTypes";

export function CandidateActionsPanel({
  candidate: _candidate,
  showFullProfile = true,
  contactState,
  contactResult,
  onEnrichContact,
  devSignalState,
  devSignalResult,
  onEnrichDevSignals,
  fullProfileState,
  fullProfile,
  fullProfileIsOpen,
  onViewFullProfile,
  scoreState,
  scoreResult,
  onScoreCandidate,
  fitState,
  fitResult,
  onAssessFit,
  interviewState,
  interviewResult,
  onCreateBookingLink,
  bookingAwaitingConfirm,
  bookingEmailPreview,
  onBookingPreviewChange,
  onConfirmSendBookingLink,
  onCancelBookingPreview,
  bookingSendState,
  resumeState,
  resumeInfo,
  onRequestResume,
  onCheckForResume,
  resumeEmailPreview,
  onResumePreviewChange,
  onConfirmSendResume,
  onCancelResumePreview,
  resumeSendState,
  offerState,
  offerInfo,
  offerFormIsOpen,
  offerDraft,
  onToggleOfferForm,
  onOfferDraftChange,
  onSendOffer,
  offerEmailPreview,
  onOfferPreviewChange,
  onConfirmSendOffer,
  onCancelOfferPreview,
  offerSendState,
  onCheckOffer,
  onMarkOfferStatus,
  hasEmail = true,
  candidateLinkedInUrl,
  onPrepareOutreach,
  outreachState = "idle",
}: {
  candidate: PdlCandidate;
  showFullProfile?: boolean;
  contactState: EnrichState;
  contactResult: ContactEnrichResult | undefined;
  onEnrichContact: () => void;
  devSignalState: EnrichState;
  devSignalResult: DevSignalEnrichResult | undefined;
  onEnrichDevSignals: () => void;
  fullProfileState: EnrichState;
  fullProfile: FullProfileData | undefined;
  fullProfileIsOpen: boolean;
  onViewFullProfile: () => void;
  scoreState: EnrichState;
  scoreResult: ScoreResult | undefined;
  onScoreCandidate: () => void;
  fitState: EnrichState;
  fitResult: FitAssessmentResult | undefined;
  onAssessFit: () => void;
  interviewState: EnrichState;
  interviewResult: InterviewResult | undefined;
  onCreateBookingLink: () => void;
  bookingAwaitingConfirm?: boolean;
  bookingEmailPreview?: EmailPreview | null;
  onBookingPreviewChange?: (next: EmailPreview) => void;
  onConfirmSendBookingLink?: () => void;
  onCancelBookingPreview?: () => void;
  bookingSendState?: EnrichState;
  resumeState: EnrichState;
  resumeInfo: ResumeInfo | undefined;
  onRequestResume: () => void;
  onCheckForResume: () => void;
  resumeEmailPreview?: EmailPreview;
  onResumePreviewChange?: (next: EmailPreview) => void;
  onConfirmSendResume?: () => void;
  onCancelResumePreview?: () => void;
  resumeSendState?: EnrichState;
  offerState: EnrichState;
  offerInfo: OfferInfo | undefined;
  offerFormIsOpen: boolean;
  offerDraft: OfferDraft;
  onToggleOfferForm: () => void;
  onOfferDraftChange: (field: keyof OfferDraft, value: string) => void;
  onSendOffer: () => void;
  offerEmailPreview?: EmailPreview;
  onOfferPreviewChange?: (next: EmailPreview) => void;
  onConfirmSendOffer?: () => void;
  onCancelOfferPreview?: () => void;
  offerSendState?: EnrichState;
  onCheckOffer: () => void;
  onMarkOfferStatus: (status: "accepted" | "declined" | "negotiating") => void;
  hasEmail?: boolean;
  candidateLinkedInUrl?: string | null;
  onPrepareOutreach?: () => void;
  outreachState?: EnrichState;
}) {
  return (
    <div className="flex flex-col gap-2 pt-2 border-t">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          disabled={contactState === "loading"}
          onClick={onEnrichContact}
        >
          {contactState === "loading"
            ? "Enriching contact..."
            : contactState === "done"
              ? "Re-run contact enrichment"
              : "Enrich contact"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={devSignalState === "loading"}
          onClick={onEnrichDevSignals}
        >
          {devSignalState === "loading"
            ? "Enriching dev signals..."
            : devSignalState === "done"
              ? "Re-run dev-signal enrichment"
              : "Enrich dev signals"}
        </Button>
        {showFullProfile && (
          <Button
            variant="outline"
            size="sm"
            disabled={fullProfileState === "loading"}
            onClick={onViewFullProfile}
          >
            {fullProfileState === "loading"
              ? "Loading full profile..."
              : fullProfile
                ? fullProfileIsOpen
                  ? "Hide full profile"
                  : "Show full profile"
                : "View full profile"}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={scoreState === "loading"}
          onClick={onScoreCandidate}
        >
          {scoreState === "loading"
            ? "Scoring..."
            : scoreResult
              ? "Re-score"
              : "Score candidate"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={fitState === "loading"}
          onClick={onAssessFit}
        >
          {fitState === "loading"
            ? "Assessing..."
            : fitResult
              ? "Re-assess"
              : "Assess fit"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={interviewState === "loading"}
          onClick={onCreateBookingLink}
        >
          {interviewState === "loading"
            ? "Preparing link..."
            : interviewResult?.status
              ? "Refresh booking status"
              : "Schedule interview"}
        </Button>
        {hasEmail ? (
          <Button
            variant="outline"
            size="sm"
            disabled={resumeState === "loading"}
            onClick={onRequestResume}
          >
            {resumeState === "loading"
              ? "Preparing..."
              : resumeInfo
                ? "Re-request resume"
                : "Request resume"}
          </Button>
        ) : (
          <span
            title="No email on file — use LinkedIn outreach instead"
            className="inline-flex"
          >
            <Button
              variant="outline"
              size="sm"
              disabled
              style={{ pointerEvents: "none" }}
            >
              Request resume
            </Button>
          </span>
        )}
        {resumeInfo && resumeInfo.resume_status !== "received" && (
          <Button
            variant="outline"
            size="sm"
            disabled={resumeState === "loading"}
            onClick={onCheckForResume}
          >
            Check for resume
          </Button>
        )}
        {candidateLinkedInUrl && onPrepareOutreach && (
          <Button
            variant="outline"
            size="sm"
            disabled={outreachState === "loading"}
            onClick={onPrepareOutreach}
          >
            {outreachState === "loading"
              ? "Preparing..."
              : "Reach out on LinkedIn"}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={offerState === "loading"}
          onClick={onToggleOfferForm}
        >
          {offerInfo ? "Re-send offer" : "Send offer"}
        </Button>
        {offerInfo &&
          (offerInfo.status === "sent" || offerInfo.status === "responded") && (
            <Button
              variant="outline"
              size="sm"
              disabled={offerState === "loading"}
              onClick={onCheckOffer}
            >
              Check for reply
            </Button>
          )}
        {offerInfo &&
          (offerInfo.status === "sent" ||
            offerInfo.status === "responded" ||
            offerInfo.status === "negotiating") && (
            <>
              <Button size="sm" onClick={() => onMarkOfferStatus("accepted")}>
                Mark accepted
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onMarkOfferStatus("declined")}
              >
                Mark declined
              </Button>
              {offerInfo.status !== "negotiating" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onMarkOfferStatus("negotiating")}
                >
                  Mark negotiating
                </Button>
              )}
            </>
          )}
      </div>

      {contactResult && (
        <div className="text-xs text-muted-foreground">
          {contactResult.status === "enriched" ? (
            <span>
              Contact: {contactResult.email} (via {contactResult.source})
            </span>
          ) : contactResult.status === "not_found" ? (
            <span>Contact: no email found.</span>
          ) : (
            <span>Contact enrichment failed.</span>
          )}
          {contactResult.notes.length > 0 && (
            <ul className="list-disc pl-4 mt-1">
              {contactResult.notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {devSignalResult && (
        <div className="text-xs text-muted-foreground">
          {devSignalResult.github_url && (
            <div>
              GitHub:{" "}
              <a
                href={devSignalResult.github_url}
                target="_blank"
                rel="noreferrer"
                className="ah-link"
              >
                {devSignalResult.github_url}
              </a>
              {devSignalResult.github_corroborated
                ? " (corroborated by company match)"
                : " (name match only -- verify)"}
            </div>
          )}
          {devSignalResult.stackoverflow_url && (
            <div>
              Stack Overflow:{" "}
              <a
                href={devSignalResult.stackoverflow_url}
                target="_blank"
                rel="noreferrer"
                className="ah-link"
              >
                {devSignalResult.stackoverflow_url}
              </a>
              {devSignalResult.stackoverflow_corroborated
                ? " (corroborated)"
                : " (name match only -- verify)"}
            </div>
          )}
          {!devSignalResult.github_url &&
            !devSignalResult.stackoverflow_url && (
              <span>No confident dev-signal match found.</span>
            )}
          {devSignalResult.notes.length > 0 && (
            <ul className="list-disc pl-4 mt-1">
              {devSignalResult.notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showFullProfile && fullProfileIsOpen && fullProfile && (
        <FullProfilePanel profile={fullProfile} />
      )}
      {scoreResult && <ScorePanel result={scoreResult} />}
      {fitResult && <FitAssessmentPanel result={fitResult} />}
      {interviewResult && <InterviewPanel result={interviewResult} />}

      {bookingAwaitingConfirm &&
        bookingEmailPreview &&
        onBookingPreviewChange &&
        onConfirmSendBookingLink &&
        onCancelBookingPreview && (
          <EmailPreviewApprovalPanel
            preview={bookingEmailPreview}
            onPreviewChange={onBookingPreviewChange}
            onConfirm={onConfirmSendBookingLink}
            onCancel={onCancelBookingPreview}
            confirming={bookingSendState === "loading"}
            confirmLabel="Send booking link"
          />
        )}

      {bookingAwaitingConfirm &&
        bookingEmailPreview === null &&
        onConfirmSendBookingLink &&
        onCancelBookingPreview && (
          <div className={AH_CALLOUT_WARN}>
            <p className="text-xs font-medium">
              No email on file — confirm to save this booking link for manual
              sharing.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={bookingSendState === "loading"}
                onClick={onConfirmSendBookingLink}
              >
                {bookingSendState === "loading"
                  ? "Saving..."
                  : "Save booking link"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={bookingSendState === "loading"}
                onClick={onCancelBookingPreview}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

      {resumeInfo && <ResumePanel info={resumeInfo} />}

      {resumeEmailPreview &&
        onResumePreviewChange &&
        onConfirmSendResume &&
        onCancelResumePreview && (
          <EmailPreviewApprovalPanel
            preview={resumeEmailPreview}
            onPreviewChange={onResumePreviewChange}
            onConfirm={onConfirmSendResume}
            onCancel={onCancelResumePreview}
            confirming={resumeSendState === "loading"}
            confirmLabel="Send resume request"
          />
        )}

      {offerFormIsOpen && (
        <OfferForm
          draft={offerDraft}
          onChange={onOfferDraftChange}
          onSubmit={onSendOffer}
          onCancel={onToggleOfferForm}
          submitting={offerState === "loading"}
        />
      )}
      {offerEmailPreview &&
        onOfferPreviewChange &&
        onConfirmSendOffer &&
        onCancelOfferPreview && (
          <EmailPreviewApprovalPanel
            preview={offerEmailPreview}
            onPreviewChange={onOfferPreviewChange}
            onConfirm={onConfirmSendOffer}
            onCancel={onCancelOfferPreview}
            confirming={offerSendState === "loading"}
            confirmLabel="Send offer"
          />
        )}
      {!offerFormIsOpen && offerInfo && <OfferPanel info={offerInfo} />}
    </div>
  );
}
