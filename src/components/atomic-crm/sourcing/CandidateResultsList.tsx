// CandidateResultsList: all display sub-components + the two candidate card
// lists extracted from SourceCandidatesPage. Pure display — no side-effects
// live here; all state and handlers flow in via props.

import { Button } from "@/components/ui/button";
import {
  AH_CALLOUT_DANGER,
  AH_CALLOUT_WARN,
  ACTION_LABELS,
  DIMENSION_LABELS,
  EMPTY_OFFER_DRAFT,
  FIT_BUCKET_COLORS,
  FIT_BUCKET_LABELS,
  INTERVIEW_STATUS_COLORS,
  INTERVIEW_STATUS_LABELS,
  OFFER_STATUS_COLORS,
  OFFER_STATUS_LABELS,
  RESUME_STATUS_COLORS,
  RESUME_STATUS_LABELS,
  VERDICT_COLORS,
  formatDateRange,
  getInitials,
  sourcingPanelClass,
  titleCase,
  type CalibrationEntryState,
  type ContactEnrichResult,
  type ContextualizeResult,
  type DevSignalEnrichResult,
  type EmailPreview,
  type EnrichState,
  type FitAssessmentResult,
  type FullProfileData,
  type InterviewResult,
  type MustHaveCheck,
  type OfferDraft,
  type OfferInfo,
  type OutreachPrepared,
  type PdlCandidate,
  type ResumeInfo,
  type ScoreResult,
} from "./sourcingTypes";
import type { useCandidateSourcing } from "./useCandidateSourcing";

// ---------------------------------------------------------------------------
// Pure display sub-components
// ---------------------------------------------------------------------------

export function FullProfilePanel({ profile }: { profile: FullProfileData }) {
  const raw = profile.full_profile_raw ?? {};
  const workHistory = profile.work_history ?? [];
  const education = Array.isArray(raw.education) ? raw.education : [];
  const certifications = Array.isArray(raw.certifications)
    ? raw.certifications
    : [];
  const languages = Array.isArray(raw.languages) ? raw.languages : [];
  const skills = Array.isArray(raw.inferred_skills) ? raw.inferred_skills : [];

  return (
    <div className="border rounded-md p-3 bg-muted/30 flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-xs uppercase text-muted-foreground">
          Full profile
        </span>
        <span className="text-xs text-muted-foreground">
          via {profile.full_profile_source ?? "unknown"}
        </span>
      </div>
      {typeof raw.headline === "string" && raw.headline && (
        <p className="text-muted-foreground italic">{raw.headline}</p>
      )}
      {workHistory.length > 0 && (
        <div>
          <div className="font-medium text-xs mb-1">Experience</div>
          <div className="flex flex-col gap-2">
            {workHistory.map((job, i) => (
              <div key={i} className="border-l-2 pl-2">
                <div className="font-medium">
                  {job.title || "(title not on file)"}
                  {job.company ? ` at ${job.company}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDateRange(job.date_from, job.date_to)}
                  {job.duration_months ? ` (${job.duration_months} mo)` : ""}
                </div>
                {job.description && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {job.description}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {education.length > 0 && (
        <div>
          <div className="font-medium text-xs mb-1">Education</div>
          <div className="flex flex-col gap-1">
            {education.map((edu: any, i: number) => (
              <div key={i} className="text-xs">
                <span className="font-medium">
                  {edu.institution_name || "(institution not on file)"}
                </span>
                {edu.degree ? ` -- ${edu.degree}` : ""}
                {edu.date_from_year || edu.date_to_year
                  ? ` (${edu.date_from_year ?? "?"}-${edu.date_to_year ?? "?"})`
                  : ""}
              </div>
            ))}
          </div>
        </div>
      )}
      {certifications.length > 0 && (
        <div>
          <div className="font-medium text-xs mb-1">Certifications</div>
          <div className="flex flex-col gap-1">
            {certifications.map((cert: any, i: number) => (
              <div key={i} className="text-xs">
                {cert.title || "(untitled)"}
                {cert.issuer ? ` -- ${cert.issuer}` : ""}
              </div>
            ))}
          </div>
        </div>
      )}
      {languages.length > 0 && (
        <div className="text-xs">
          <span className="font-medium">Languages: </span>
          {languages
            .map((lang: any) =>
              lang.proficiency
                ? `${lang.language} (${lang.proficiency})`
                : lang.language,
            )
            .join(", ")}
        </div>
      )}
      {skills.length > 0 && (
        <div className="text-xs">
          <span className="font-medium">Skills: </span>
          {skills.slice(0, 25).join(", ")}
          {skills.length > 25 ? ` (+${skills.length - 25} more)` : ""}
        </div>
      )}
      {workHistory.length === 0 &&
        education.length === 0 &&
        certifications.length === 0 &&
        skills.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Profile was enriched, but no experience, education, or skills fields
            came back for this candidate.
          </p>
        )}
    </div>
  );
}

export function ScorePanel({ result }: { result: ScoreResult }) {
  const dims = Object.entries(result.dimension_scores) as Array<
    [
      keyof ScoreResult["dimension_scores"],
      { score: number; rationale: string; quote: string | null },
    ]
  >;
  return (
    <div className="border rounded-md p-3 bg-muted/30 flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold">{result.overall_score}</span>
          <span className="text-muted-foreground text-xs">/ 100</span>
          <span
            className={`text-xs font-medium border rounded px-2 py-0.5 ${VERDICT_COLORS[result.verdict]}`}
          >
            {result.verdict}
          </span>
        </div>
        <span className="text-xs font-medium border rounded px-2 py-0.5">
          Recommended: {ACTION_LABELS[result.recommended_action]}
        </span>
      </div>
      {result.deal_breaker_warning && (
        <p className={`text-xs ${AH_CALLOUT_DANGER}`}>
          {result.deal_breaker_warning}
        </p>
      )}
      {result.scored_text_source === "plain_fields" && (
        <p className={`text-xs ${AH_CALLOUT_WARN}`}>
          Scored against limited discovery fields only -- run "View full
          profile" first for a more reliable score.
        </p>
      )}
      <div>
        <div className="font-medium text-xs mb-1">Dimension breakdown</div>
        <div className="flex flex-col gap-1.5">
          {dims.map(([key, dim]) => (
            <div key={key} className="flex flex-col">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">
                  {DIMENSION_LABELS[key]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {dim.score}/100
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {dim.rationale}
              </div>
              {dim.quote && (
                <div className="text-xs italic text-muted-foreground">
                  "{dim.quote}"
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {result.must_haves_check.length > 0 && (
        <div>
          <div className="font-medium text-xs mb-1">Must-haves</div>
          <div className="flex flex-col gap-0.5">
            {result.must_haves_check.map((m, i) => (
              <div key={i} className="text-xs flex items-center gap-1.5">
                <span
                  className={
                    m.status === "found"
                      ? "ah-text-good"
                      : m.status === "inferred"
                        ? "ah-text-warn"
                        : "ah-text-danger"
                  }
                >
                  {m.status === "found"
                    ? "✓"
                    : m.status === "inferred"
                      ? "~"
                      : "✗"}
                </span>
                <span>{m.requirement}</span>
                <span className="text-muted-foreground">
                  ({m.confidence} confidence)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {(result.recommended_action_reasons.length > 0 ||
        result.recommended_action_risks.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {result.recommended_action_reasons.length > 0 && (
            <div>
              <div className="font-medium text-xs mb-1">Why</div>
              <ul className="text-xs text-muted-foreground list-disc pl-4">
                {result.recommended_action_reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {result.recommended_action_risks.length > 0 && (
            <div>
              <div className="font-medium text-xs mb-1">
                Risks / worth exploring
              </div>
              <ul className="text-xs text-muted-foreground list-disc pl-4">
                {result.recommended_action_risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {result.recruiter_card?.interview_questions?.length > 0 && (
        <div>
          <div className="font-medium text-xs mb-1">
            Suggested interview questions
          </div>
          <ul className="text-xs text-muted-foreground list-disc pl-4">
            {result.recruiter_card.interview_questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      {(result.green_flags.length > 0 ||
        result.watch_signals.length > 0 ||
        result.review_flags.length > 0) && (
        <div className="text-xs flex flex-col gap-1">
          {result.green_flags.length > 0 && (
            <div>
              <span className="font-medium ah-text-good">Green flags: </span>
              {result.green_flags.join(" · ")}
            </div>
          )}
          {result.watch_signals.length > 0 && (
            <div>
              <span className="font-medium ah-text-warn">Watch: </span>
              {result.watch_signals.join(" · ")}
            </div>
          )}
          {result.review_flags.length > 0 && (
            <div>
              <span className="font-medium ah-text-danger">Review: </span>
              {result.review_flags.join(" · ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CandidateQuickActionBar({
  emails,
  linkedInUrl,
  isLinkedInSource,
  outreachState,
  onLinkedInOutreach,
}: {
  emails?: { address: string; type?: string }[];
  linkedInUrl?: string | null;
  isLinkedInSource: boolean;
  outreachState: EnrichState;
  onLinkedInOutreach: () => void;
}) {
  const primaryEmail = emails?.[0]?.address;
  if (!primaryEmail && !isLinkedInSource) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap pb-2 border-b mb-1">
      {primaryEmail && (
        <a
          href={`mailto:${primaryEmail}`}
          className="inline-flex items-center gap-1 text-xs border rounded px-2 py-1 hover:bg-accent/40 transition-colors text-foreground no-underline"
          title={primaryEmail}
        >
          ✉ Email
        </a>
      )}
      {isLinkedInSource && (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs border rounded px-2 py-1 hover:bg-accent/40 transition-colors disabled:opacity-50"
          disabled={outreachState === "loading"}
          onClick={onLinkedInOutreach}
          title={linkedInUrl ? `LinkedIn: ${linkedInUrl}` : "LinkedIn outreach"}
        >
          {outreachState === "loading" ? "Preparing..." : "LinkedIn Outreach"}
        </button>
      )}
    </div>
  );
}

export function FitAssessmentPanel({
  result,
}: {
  result: FitAssessmentResult;
}) {
  return (
    <div className="border rounded-md p-3 bg-muted/30 flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span
          className={`text-xs font-medium border rounded px-2 py-0.5 ${FIT_BUCKET_COLORS[result.fit_bucket]}`}
        >
          {FIT_BUCKET_LABELS[result.fit_bucket]}
        </span>
        {result.scored_text_source === "plain_fields" && (
          <span className="text-xs ah-text-warn">
            Limited discovery fields only -- run "View full profile" first for a
            better read.
          </span>
        )}
      </div>
      <p className="text-sm">{result.summary}</p>
      {result.matches.length > 0 && (
        <div>
          <div className="font-medium text-xs mb-1">Matches</div>
          <ul className="text-xs text-muted-foreground list-disc pl-4">
            {result.matches.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {result.worth_verifying.length > 0 && (
        <div>
          <div className="font-medium text-xs mb-1">
            Worth verifying in a screen
          </div>
          <ul className="text-xs text-muted-foreground list-disc pl-4">
            {result.worth_verifying.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {result.clear_gaps.length > 0 && (
        <div>
          <div className="font-medium text-xs mb-1 ah-text-danger">
            Clear gaps
          </div>
          <ul className="text-xs text-muted-foreground list-disc pl-4">
            {result.clear_gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function CalibrationFeedbackWidget({
  reason,
  onReasonChange,
  submitted,
  entryState,
  onSubmitJudgment,
  contextualizeState,
  contextualizeResult,
  applyState,
  onApplyCriterion,
}: {
  reason: string;
  onReasonChange: (value: string) => void;
  submitted: boolean;
  entryState: CalibrationEntryState;
  onSubmitJudgment: (fit: boolean) => void;
  contextualizeState: "idle" | "loading" | "done" | undefined;
  contextualizeResult: ContextualizeResult | undefined;
  applyState: "idle" | "applying" | "applied";
  onApplyCriterion: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 pt-2 border-t">
      <p className="text-xs text-muted-foreground">
        Not a fit? Give a reason -- it becomes a real search criterion for this
        role, and you'll see how many candidates it would exclude before it's
        ever applied.
      </p>
      <textarea
        className="border rounded-md p-2 text-sm"
        placeholder="Why is this (or isn't this) a fit? Required."
        rows={2}
        disabled={submitted}
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
      />
      {submitted ? (
        <p className="text-xs text-muted-foreground">Judgment saved.</p>
      ) : (
        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            disabled={entryState === "submitting"}
            onClick={() => onSubmitJudgment(true)}
          >
            Fit
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={entryState === "submitting"}
            onClick={() => onSubmitJudgment(false)}
          >
            Not a fit
          </Button>
        </div>
      )}
      {contextualizeState === "loading" && (
        <p className="text-xs text-muted-foreground italic">
          Contextualizing...
        </p>
      )}
      {contextualizeState === "done" &&
        contextualizeResult &&
        (contextualizeResult.applicable ? (
          <div className="border rounded-md p-2 flex flex-col gap-1 bg-muted/40">
            <p className="text-xs font-medium">
              Suggested criterion: "{contextualizeResult.criterion?.label}"
            </p>
            <p className="text-xs text-muted-foreground">
              {contextualizeResult.rejected_count !== null &&
              contextualizeResult.rejected_count !== undefined
                ? `Would exclude ~${contextualizeResult.rejected_count} of the ${contextualizeResult.current_total ?? "?"} candidates currently matching this role.`
                : "Couldn't compute how many candidates this would exclude right now."}
            </p>
            {applyState === "applied" ? (
              <p className="text-xs text-muted-foreground">
                Applied -- this now applies to every future search for this
                role.
              </p>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={applyState === "applying"}
                onClick={onApplyCriterion}
              >
                {applyState === "applying"
                  ? "Applying..."
                  : contextualizeResult.rejected_count !== null &&
                      contextualizeResult.rejected_count !== undefined
                    ? `Apply (${contextualizeResult.rejected_count} excluded)`
                    : "Apply"}
              </Button>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            This reason didn't map onto a specific search criterion -- it's
            still saved above for reference, but it won't change future
            searches.
          </p>
        ))}
    </div>
  );
}

export function InterviewPanel({ result }: { result: InterviewResult }) {
  return (
    <div className="border rounded-md p-3 bg-muted/30 flex flex-col gap-2 text-sm">
      {result.status ? (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span
            className={`text-xs font-medium border rounded px-2 py-0.5 ${INTERVIEW_STATUS_COLORS[result.status]}`}
          >
            {INTERVIEW_STATUS_LABELS[result.status]}
          </span>
          {result.email_sent === false && !result.already_booked && (
            <span className="text-xs ah-text-warn">
              {result.candidate_email
                ? "Link saved, but the email didn't send -- share it manually."
                : "No email on file -- share this link with the candidate manually."}
            </span>
          )}
        </div>
      ) : result.prepared ? (
        <p className="text-xs text-muted-foreground">
          Booking link prepared — review the email below and confirm before
          sending.
        </p>
      ) : null}
      {result.scheduled_at && (
        <p className="text-xs">
          Scheduled for {new Date(result.scheduled_at).toLocaleString()}
        </p>
      )}
      {result.booking_link_url && (
        <a
          href={result.booking_link_url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-700 underline break-all"
        >
          {result.booking_link_url}
        </a>
      )}
    </div>
  );
}

export function ResumePanel({ info }: { info: ResumeInfo }) {
  return (
    <div className="border rounded-md p-3 bg-muted/30 flex flex-col gap-2 text-sm">
      <span
        className={`text-xs font-medium border rounded px-2 py-0.5 w-fit ${RESUME_STATUS_COLORS[info.resume_status]}`}
      >
        {RESUME_STATUS_LABELS[info.resume_status]}
      </span>
      {info.resume_status === "received" && info.resume_original_filename && (
        <p className="text-xs">
          {info.resume_original_filename}
          {info.resume_received_at &&
            ` -- received ${new Date(info.resume_received_at).toLocaleString()}`}
        </p>
      )}
      {info.resume_reply_text && (
        <p className="text-xs text-muted-foreground italic">
          "{info.resume_reply_text.slice(0, 200)}
          {info.resume_reply_text.length > 200 ? "..." : ""}"
        </p>
      )}
    </div>
  );
}

export function OfferPanel({ info }: { info: OfferInfo }) {
  const compensationLine =
    info.compensation_amount !== null && info.compensation_amount !== undefined
      ? `${info.compensation_currency ?? "INR"} ${info.compensation_amount.toLocaleString()} / ${info.compensation_frequency ?? "annual"}`
      : null;
  const detailLine = [
    compensationLine,
    info.start_date ? `Start: ${info.start_date}` : null,
    info.expiry_date ? `Valid until: ${info.expiry_date}` : null,
  ]
    .filter(Boolean)
    .join(" -- ");

  return (
    <div className="border rounded-md p-3 bg-muted/30 flex flex-col gap-2 text-sm">
      <span
        className={`text-xs font-medium border rounded px-2 py-0.5 w-fit ${OFFER_STATUS_COLORS[info.status]}`}
      >
        {OFFER_STATUS_LABELS[info.status]}
      </span>
      {info.position_title && (
        <p className="text-xs font-medium">{info.position_title}</p>
      )}
      {detailLine && (
        <p className="text-xs text-muted-foreground">{detailLine}</p>
      )}
      {info.response_text && (
        <p className="text-xs text-muted-foreground italic">
          "{info.response_text.slice(0, 200)}
          {info.response_text.length > 200 ? "..." : ""}"
        </p>
      )}
    </div>
  );
}

export function OfferForm({
  draft,
  onChange,
  onSubmit,
  onCancel,
  submitting,
}: {
  draft: OfferDraft;
  onChange: (field: keyof OfferDraft, value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const inputClass =
    "border border-input bg-background text-foreground rounded px-2 py-1 text-xs w-full";
  return (
    <div className="border rounded-md p-3 bg-muted/30 flex flex-col gap-2 text-sm">
      <input
        className={inputClass}
        placeholder="Position title"
        value={draft.position_title}
        onChange={(e) => onChange("position_title", e.target.value)}
      />
      <div className="grid grid-cols-3 gap-2">
        <input
          className={inputClass}
          type="number"
          placeholder="Compensation"
          value={draft.compensation_amount}
          onChange={(e) => onChange("compensation_amount", e.target.value)}
        />
        <select
          className={inputClass}
          value={draft.compensation_currency}
          onChange={(e) => onChange("compensation_currency", e.target.value)}
        >
          <option value="INR">INR</option>
          <option value="USD">USD</option>
        </select>
        <select
          className={inputClass}
          value={draft.compensation_frequency}
          onChange={(e) => onChange("compensation_frequency", e.target.value)}
        >
          <option value="annual">per year</option>
          <option value="monthly">per month</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Start date
          <input
            className={inputClass}
            type="date"
            value={draft.start_date}
            onChange={(e) => onChange("start_date", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Offer valid until
          <input
            className={inputClass}
            type="date"
            value={draft.expiry_date}
            onChange={(e) => onChange("expiry_date", e.target.value)}
          />
        </label>
      </div>
      <textarea
        className={inputClass}
        placeholder="Benefits summary (optional)"
        rows={2}
        value={draft.benefits_summary}
        onChange={(e) => onChange("benefits_summary", e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={
            submitting || !draft.position_title || !draft.compensation_amount
          }
          onClick={onSubmit}
        >
          {submitting ? "Preparing..." : "Prepare offer email"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={submitting}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function EmailPreviewApprovalPanel({
  preview,
  onPreviewChange,
  onConfirm,
  onCancel,
  confirming,
  confirmLabel,
}: {
  preview: EmailPreview;
  onPreviewChange: (next: EmailPreview) => void;
  onConfirm: () => void;
  onCancel: () => void;
  confirming: boolean;
  confirmLabel: string;
}) {
  const inputClass =
    "border border-input bg-background text-foreground rounded px-2 py-1 text-xs w-full";
  return (
    <div className={AH_CALLOUT_WARN}>
      <p className="text-xs font-medium">
        Review before sending to {preview.to}
      </p>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Subject
        <input
          className={inputClass}
          value={preview.subject}
          onChange={(e) =>
            onPreviewChange({ ...preview, subject: e.target.value })
          }
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Email body (HTML)
        <textarea
          className={inputClass}
          rows={6}
          value={preview.html}
          onChange={(e) =>
            onPreviewChange({ ...preview, html: e.target.value })
          }
        />
      </label>
      <div className="flex gap-2">
        <Button size="sm" disabled={confirming} onClick={onConfirm}>
          {confirming ? "Sending..." : confirmLabel}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={confirming}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

const CONNECTION_CHAR_LIMIT_OUTREACH = 300;

export function OutreachPreviewPanel({
  prepared,
  onPreparedChange,
  onConfirm,
  onCancel,
  confirming,
}: {
  prepared: OutreachPrepared;
  onPreparedChange: (next: OutreachPrepared) => void;
  onConfirm: () => void;
  onCancel: () => void;
  confirming: boolean;
}) {
  const inputClass =
    "border border-input bg-background text-foreground rounded px-2 py-1 text-xs w-full";
  const isLinkedIn =
    prepared.channel === "linkedin_connection" ||
    prepared.channel === "linkedin_inmail";
  const charCount = prepared.message_body?.length ?? 0;
  const overLimit =
    prepared.channel === "linkedin_connection" &&
    charCount > CONNECTION_CHAR_LIMIT_OUTREACH;

  return (
    <div className={AH_CALLOUT_WARN}>
      {isLinkedIn ? (
        <>
          <p className="text-xs font-medium">
            Review before sending —{" "}
            {prepared.channel === "linkedin_inmail"
              ? "LinkedIn InMail (open profile)"
              : "LinkedIn connection note"}
          </p>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Message
            <textarea
              className={`${inputClass} ${overLimit ? "border-destructive" : ""}`}
              rows={prepared.channel === "linkedin_connection" ? 4 : 6}
              value={prepared.message_body ?? ""}
              onChange={(e) =>
                onPreparedChange({ ...prepared, message_body: e.target.value })
              }
            />
          </label>
          <p
            className={`text-xs ${overLimit ? "text-destructive font-medium" : "text-muted-foreground"}`}
          >
            {prepared.channel === "linkedin_connection" &&
              `${charCount}/${CONNECTION_CHAR_LIMIT_OUTREACH} chars${overLimit ? " — trim before sending" : ""}`}
          </p>
          {prepared.cap_remaining !== null && (
            <p className="text-xs text-muted-foreground">
              {prepared.cap_remaining} sends remaining today
            </p>
          )}
          {prepared.dual_channel && prepared.email_preview && (
            <div className="border-t pt-2 flex flex-col gap-2">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(prepared.send_email_too)}
                  onChange={(e) =>
                    onPreparedChange({
                      ...prepared,
                      send_email_too: e.target.checked,
                    })
                  }
                />
                Also send email to {prepared.email_preview.to}
              </label>
              {prepared.send_email_too && (
                <>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Subject
                    <input
                      className={inputClass}
                      value={prepared.email_preview.subject}
                      onChange={(e) =>
                        onPreparedChange({
                          ...prepared,
                          email_preview: {
                            ...prepared.email_preview!,
                            subject: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Email body
                    <textarea
                      className={inputClass}
                      rows={4}
                      value={prepared.email_preview.html}
                      onChange={(e) =>
                        onPreparedChange({
                          ...prepared,
                          email_preview: {
                            ...prepared.email_preview!,
                            html: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                </>
              )}
            </div>
          )}
        </>
      ) : prepared.email_preview ? (
        <>
          <p className="text-xs font-medium">
            Review before sending to {prepared.email_preview.to}
          </p>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Subject
            <input
              className={inputClass}
              value={prepared.email_preview.subject}
              onChange={(e) =>
                onPreparedChange({
                  ...prepared,
                  email_preview: {
                    ...prepared.email_preview!,
                    subject: e.target.value,
                  },
                })
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Email body (HTML)
            <textarea
              className={inputClass}
              rows={5}
              value={prepared.email_preview.html}
              onChange={(e) =>
                onPreparedChange({
                  ...prepared,
                  email_preview: {
                    ...prepared.email_preview!,
                    html: e.target.value,
                  },
                })
              }
            />
          </label>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Outreach ready to send.</p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={confirming || overLimit}
          onClick={onConfirm}
        >
          {confirming ? "Sending..." : "Approve & send"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={confirming}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CandidateActionsPanel — shared action cluster for both card lists
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Type alias for the full sourcing context passed to card lists
// ---------------------------------------------------------------------------
type SourcingContext = ReturnType<typeof useCandidateSourcing>;

// ---------------------------------------------------------------------------
// FreePortalCandidateList
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// MainCandidateList — the fetched PDL/Coresignal candidates grid
// ---------------------------------------------------------------------------

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
