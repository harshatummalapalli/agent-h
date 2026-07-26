// Shared types, constants, and pure utilities for SourceCandidatesPage and
// its extracted hooks/components. Extracted from SourceCandidatesPage.tsx to
// keep individual files under 800 lines.

/** Semantic status badge classes (agent-h-theme.css) — Phase 2 theming pass. */
export const AH_STATUS = {
  good: "ah-status-badge ah-status-good",
  warn: "ah-status-badge ah-status-warn",
  danger: "ah-status-badge ah-status-danger",
  info: "ah-status-badge ah-status-info",
  accent: "ah-status-badge ah-status-accent",
  neutral: "ah-status-badge ah-status-neutral",
} as const;

export const AH_CALLOUT_WARN =
  "border rounded-md p-3 ah-callout-warn flex flex-col gap-2 text-sm";
export const AH_CALLOUT_DANGER = "text-xs ah-callout-danger rounded px-2 py-1";

export type RoleBriefOption = {
  id: number;
  name: string;
};

export type RoleBriefDetail = {
  name: string | null;
  seniority: string | null;
  location: string | null;
  industry: string | null;
  years_experience_min: number | null;
  years_experience_max: number | null;
  required_skills: string[] | null;
  must_have_keywords: string[] | null;
  nice_to_have_keywords: string[] | null;
  company_type: string | null;
  company_size_min: number | null;
  company_size_max: number | null;
  excluded_companies: string[] | null;
  exclusion_keywords: string[] | null;
  past_titles: string[] | null;
  past_companies: string[] | null;
  preference_tiers: Array<{
    rank: number;
    label: string;
    keywords: string[];
    condition: string | null;
  }> | null;
  clarifying_questions: string[] | null;
  clarifying_questions_dismissed: boolean;
};

export type PdlCandidate = {
  id: string;
  full_name?: string;
  job_title?: string;
  job_company_name?: string;
  location_name?: string;
  linkedin_url?: string;
  emails?: { address: string; type?: string }[];
  skills?: string[];
  _already_saved?: boolean;
  _candidate_id?: number | null;
  _match_score?: number | null;
  _source_vendor?: string;
  _portal_url?: string | null;
  _match_evidence?: string | null;
  years_experience?: number | null;
  company_size?: number | null;
  _all_portals?: Array<{ vendor: string; url: string | null }>;
  /** LLM pre-rank: 1 = best fit. Only set for candidates the LLM ranked (top 25). */
  _llm_rank?: number | null;
  /** Short LLM explanation of why this candidate fits the role. */
  _llm_why_fit?: string | null;
};

export type FreePortalResult = {
  candidates: PdlCandidate[];
  notes: string[];
  total: number;
};

export type ExaResult = {
  candidates: PdlCandidate[];
  notes: string[];
  total: number;
};

export type SourceResult = {
  role_brief: { id: number; title: string | null; location: string | null };
  query_used: unknown;
  notes: string[];
  total: number;
  total_matches_all: number | null;
  candidates: PdlCandidate[];
  scroll_token: string | null;
};

export type SaveState = "idle" | "saving" | "saved";

export type EnrichState = "idle" | "loading" | "done";

export type ContactEnrichResult = {
  status: "enriched" | "not_found" | "failed";
  source: "hunter" | "apollo" | null;
  email: string | null;
  notes: string[];
};

export type DevSignalEnrichResult = {
  status: "enriched" | "not_found" | "failed";
  github_url: string | null;
  github_corroborated: boolean | null;
  stackoverflow_url: string | null;
  stackoverflow_corroborated: boolean | null;
  notes: string[];
};

export type FullProfileEnrichResult = {
  status: "enriched" | "not_found" | "failed";
  source: "coresignal_collect" | "pdl_enrich" | null;
  experience_count: number;
  education_count: number;
  notes: string[];
};

export type WorkHistoryEntry = {
  title: string | null;
  company: string | null;
  date_from: string | null;
  date_to: string | null;
  duration_months: number | null;
  description: string | null;
};

export type FullProfileRaw = Record<string, any>;

export type FullProfileData = {
  full_profile_status: string | null;
  full_profile_source: string | null;
  full_profile_raw: FullProfileRaw | null;
  full_profile_updated_at: string | null;
  work_history: WorkHistoryEntry[] | null;
};

export type DimensionScore = {
  score: number;
  rationale: string;
  quote: string | null;
};

export type MustHaveCheck = {
  requirement: string;
  status: "found" | "inferred" | "absent";
  confidence: "high" | "medium" | "low";
};

export type RecruiterCard = {
  most_recent_title: string;
  total_years_experience: string;
  career_pattern: string;
  what_stands_out: string[];
  worth_exploring: string[];
  interview_questions: string[];
};

export type ScoreResult = {
  overall_score: number;
  verdict:
    | "EXCEPTIONAL MATCH"
    | "STRONG MATCH"
    | "POTENTIAL MATCH"
    | "WEAK MATCH"
    | "NOT A MATCH";
  confidence_level: "high" | "medium" | "low";
  dimension_scores: Record<
    "skills" | "trajectory" | "domain" | "seniority" | "tenure",
    DimensionScore
  >;
  deal_breaker_warning: string | null;
  must_haves_check: MustHaveCheck[];
  green_flags: string[];
  watch_signals: string[];
  review_flags: string[];
  recruiter_card: RecruiterCard;
  profile_classification: { primary_type: string; lean_summary: string };
  recommended_action: "interview" | "hold" | "reject";
  recommended_action_reasons: string[];
  recommended_action_risks: string[];
  scored_text_source: "full_profile" | "plain_fields";
};

export const VERDICT_COLORS: Record<ScoreResult["verdict"], string> = {
  "EXCEPTIONAL MATCH": AH_STATUS.accent,
  "STRONG MATCH": AH_STATUS.good,
  "POTENTIAL MATCH": AH_STATUS.warn,
  "WEAK MATCH": AH_STATUS.warn,
  "NOT A MATCH": AH_STATUS.danger,
};

export const ACTION_LABELS: Record<ScoreResult["recommended_action"], string> =
  {
    interview: "Interview",
    hold: "Hold",
    reject: "Reject",
  };

export const DIMENSION_LABELS: Record<
  keyof ScoreResult["dimension_scores"],
  string
> = {
  skills: "Technical Skills",
  trajectory: "Career Growth",
  domain: "Industry Experience",
  seniority: "Seniority Level",
  tenure: "Job Stability",
};

export type FitBucket = "worth_reaching_out" | "possible_check" | "not_a_fit";

export type FitAssessmentResult = {
  fit_bucket: FitBucket;
  summary: string;
  matches: string[];
  worth_verifying: string[];
  clear_gaps: string[];
  scored_text_source: "full_profile" | "plain_fields";
};

export const FIT_BUCKET_LABELS: Record<FitBucket, string> = {
  worth_reaching_out: "Worth reaching out",
  possible_check: "Possible, worth a quick check",
  not_a_fit: "Not a fit",
};

export const FIT_BUCKET_COLORS: Record<FitBucket, string> = {
  worth_reaching_out: AH_STATUS.good,
  possible_check: AH_STATUS.warn,
  not_a_fit: AH_STATUS.danger,
};

export type ContextualizeResult = {
  applicable: boolean;
  criterion?: {
    criterion_type:
      | "require_keyword"
      | "exclude_keyword"
      | "years_experience_min"
      | "years_experience_max";
    value: { keyword?: string; years?: number };
    label: string;
  };
  current_total?: number | null;
  projected_total?: number | null;
  rejected_count?: number | null;
};

export type CriteriaImpact = {
  base_total: number | null;
  criteria: Array<{
    id: number;
    criterion_type: string;
    label: string;
    status: "active" | "relaxed";
    rejected_count: number | null;
  }>;
};

export type EmailPreview = {
  to: string;
  reply_to?: string;
  subject: string;
  html: string;
};

export type InterviewResult = {
  already_booked: boolean;
  prepared?: boolean;
  interview_id?: number | null;
  status?:
    | "link_sent"
    | "booked"
    | "rescheduled"
    | "cancelled"
    | "completed"
    | "no_show";
  booking_link_url?: string;
  scheduled_at?: string | null;
  scheduled_end_at?: string | null;
  candidate_email?: string | null;
  email_preview?: EmailPreview | null;
  email_sent?: boolean;
};

export const INTERVIEW_STATUS_LABELS: Record<
  NonNullable<InterviewResult["status"]>,
  string
> = {
  link_sent: "Booking link sent",
  booked: "Interview booked",
  rescheduled: "Interview rescheduled",
  cancelled: "Interview cancelled",
  completed: "Interview completed",
  no_show: "Candidate no-showed",
};

export const INTERVIEW_STATUS_COLORS: Record<
  NonNullable<InterviewResult["status"]>,
  string
> = {
  link_sent: AH_STATUS.info,
  booked: AH_STATUS.good,
  rescheduled: AH_STATUS.warn,
  cancelled: AH_STATUS.danger,
  completed: AH_STATUS.neutral,
  no_show: AH_STATUS.danger,
};

export type ResumeInfo = {
  resume_status: "not_requested" | "requested" | "received";
  resume_original_filename: string | null;
  resume_received_at: string | null;
  resume_reply_text: string | null;
};

export const RESUME_STATUS_LABELS: Record<ResumeInfo["resume_status"], string> =
  {
    not_requested: "Resume not requested",
    requested: "Resume requested",
    received: "Resume received",
  };

export const RESUME_STATUS_COLORS: Record<ResumeInfo["resume_status"], string> =
  {
    not_requested: AH_STATUS.neutral,
    requested: AH_STATUS.info,
    received: AH_STATUS.good,
  };

export type OfferInfo = {
  id: number;
  status:
    | "draft"
    | "sent"
    | "responded"
    | "accepted"
    | "declined"
    | "negotiating"
    | "expired";
  position_title: string | null;
  compensation_amount: number | null;
  compensation_currency: string | null;
  compensation_frequency: "annual" | "monthly" | null;
  start_date: string | null;
  expiry_date: string | null;
  benefits_summary: string | null;
  response_text: string | null;
};

export const OFFER_STATUS_LABELS: Record<OfferInfo["status"], string> = {
  draft: "Offer drafted",
  sent: "Offer sent",
  responded: "Candidate replied",
  accepted: "Offer accepted",
  declined: "Offer declined",
  negotiating: "Negotiating",
  expired: "Offer expired",
};

export const OFFER_STATUS_COLORS: Record<OfferInfo["status"], string> = {
  draft: AH_STATUS.neutral,
  sent: AH_STATUS.info,
  responded: AH_STATUS.warn,
  accepted: AH_STATUS.good,
  declined: AH_STATUS.danger,
  negotiating: AH_STATUS.warn,
  expired: AH_STATUS.neutral,
};

export type OutreachPrepared = {
  channel: "email" | "linkedin_connection" | "linkedin_inmail";
  message_body: string | null;
  email_preview: {
    to: string;
    reply_to?: string;
    subject: string;
    html: string;
  } | null;
  linkedin_provider_id: string | null;
  cap_remaining: number | null;
  dual_channel?: boolean;
  send_email_too?: boolean;
};

export type OfferDraft = {
  position_title: string;
  compensation_amount: string;
  compensation_currency: string;
  compensation_frequency: "annual" | "monthly";
  start_date: string;
  expiry_date: string;
  benefits_summary: string;
};

export const EMPTY_OFFER_DRAFT: OfferDraft = {
  position_title: "",
  compensation_amount: "",
  compensation_currency: "INR",
  compensation_frequency: "annual",
  start_date: "",
  expiry_date: "",
  benefits_summary: "",
};

export type CalibrationEntryState = "idle" | "submitting" | "submitted";

export type Stage = "idle" | "previewed" | "fetched";

export type CandidateSortField = "default" | "name" | "location";

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

/** Title-case a display string. PDL returns text fully lowercased. */
export function titleCase(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.replace(
    /\w\S*/g,
    (word) => word.charAt(0).toUpperCase() + word.slice(1),
  );
}

/** Build Google / Bing / DuckDuckGo X-ray query links from a role brief. */
export function buildXrayQueries(
  roleBrief: RoleBriefDetail,
): Array<{ label: string; url: string }> {
  const topSkills = (
    roleBrief.required_skills ??
    roleBrief.must_have_keywords ??
    []
  ).slice(0, 3);
  const terms = [roleBrief.name, ...topSkills].filter(
    (t): t is string => typeof t === "string" && t.length > 0,
  );
  const locationTerm =
    roleBrief.location && !/remote/i.test(roleBrief.location)
      ? roleBrief.location.split(",")[0].trim()
      : "";

  const buildQuery = (siteFilter: string) =>
    [siteFilter, ...terms.map((t) => `"${t}"`), locationTerm]
      .filter((s) => s.length > 0)
      .join(" ");

  const linkedinQuery = buildQuery("site:linkedin.com/in");
  const webQuery = buildQuery("");

  return [
    {
      label: "Google -- LinkedIn X-ray",
      url: `https://www.google.com/search?q=${encodeURIComponent(linkedinQuery)}`,
    },
    {
      label: "Bing -- LinkedIn X-ray",
      url: `https://www.bing.com/search?q=${encodeURIComponent(linkedinQuery)}`,
    },
    {
      label: "DuckDuckGo -- LinkedIn X-ray",
      url: `https://duckduckgo.com/?q=${encodeURIComponent(linkedinQuery)}`,
    },
    {
      label: "Google -- general web",
      url: `https://www.google.com/search?q=${encodeURIComponent(webQuery)}`,
    },
  ];
}

/** Two-character avatar initials from a full name. */
export function getInitials(fullName: string | undefined): string {
  if (!fullName) return "?";
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Sort a candidate list according to the recruiter's chosen sort controls. */
export function sortCandidatesForDisplay(
  candidates: PdlCandidate[],
  sortField: CandidateSortField,
  sortByMatchEvidence: boolean,
  sortByYearsExperience: boolean,
  sortByCompanySize: boolean,
): PdlCandidate[] {
  if (sortByMatchEvidence || sortByYearsExperience || sortByCompanySize) {
    return [...candidates].sort((a, b) => {
      if (sortByMatchEvidence) {
        const scoreA =
          typeof a._match_score === "number" ? a._match_score : -Infinity;
        const scoreB =
          typeof b._match_score === "number" ? b._match_score : -Infinity;
        const scoreDelta = scoreB - scoreA;
        if (scoreDelta !== 0) return scoreDelta;
      }
      if (sortByYearsExperience) {
        const yearsDelta =
          (b.years_experience ?? -Infinity) - (a.years_experience ?? -Infinity);
        if (yearsDelta !== 0) return yearsDelta;
      }
      if (sortByCompanySize) {
        const sizeDelta =
          (b.company_size ?? -Infinity) - (a.company_size ?? -Infinity);
        if (sizeDelta !== 0) return sizeDelta;
      }
      return 0;
    });
  }
  switch (sortField) {
    case "name":
      return [...candidates].sort((a, b) =>
        (a.full_name ?? "").localeCompare(b.full_name ?? ""),
      );
    case "location":
      return [...candidates].sort((a, b) =>
        (a.location_name ?? "").localeCompare(b.location_name ?? ""),
      );
    case "default":
    default:
      return candidates;
  }
}

/** Format a work-history date range from vendor-specific date fields. */
export function formatDateRange(dateFrom: unknown, dateTo: unknown): string {
  const from = typeof dateFrom === "string" && dateFrom ? dateFrom : null;
  const to = typeof dateTo === "string" && dateTo ? dateTo : null;
  if (!from && !to) return "";
  return `${from ?? "?"} -- ${to ?? "Present"}`;
}

/** CSS class for a sourcing panel — bordered card when standalone, themed panel when embedded. */
export const sourcingPanelClass = (
  embedded: boolean,
  layout: string,
  shape: "lg" | "md" = "lg",
) => {
  if (embedded) return `ah-panel ${layout}`;
  const radius = shape === "md" ? "rounded-md" : "rounded-lg";
  return `border ${radius} bg-muted/30 ${layout}`;
};
