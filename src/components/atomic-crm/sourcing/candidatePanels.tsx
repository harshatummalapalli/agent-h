// Panel display components — FullProfilePanel, ScorePanel, FitAssessmentPanel,
// InterviewPanel, ResumePanel, OfferPanel, OfferForm, EmailPreviewApprovalPanel.
// Pure display, no side-effects.

import { Button } from "@/components/ui/button";
import {
  AH_CALLOUT_DANGER,
  AH_CALLOUT_WARN,
  ACTION_LABELS,
  DIMENSION_LABELS,
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
  type EmailPreview,
  type FitAssessmentResult,
  type FullProfileData,
  type InterviewResult,
  type OfferDraft,
  type OfferInfo,
  type ResumeInfo,
  type ScoreResult,
} from "./sourcingTypes";

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
