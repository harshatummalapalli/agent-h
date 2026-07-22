// Agent H Stage 3 -- Source Candidates test screen.
//
// Checkpoint 3a: pick a role brief, call source-candidates-discovery, show
// whatever raw PDL matches come back.
//
// Checkpoint 3b added "Add to pipeline" per result. Clicking it calls
// save-sourced-candidate, which checks whether this exact person is already
// saved (by PDL id, then LinkedIn URL) before inserting -- so the same
// person is never duplicated into public.candidates just because they
// turned up in this search before, or turn up again in a different role's
// search. Nothing is saved automatically just for appearing in a search
// result -- that was Harsha's explicit call: an unreviewed PDL hit isn't the
// same thing as a candidate someone decided was worth tracking.
//
// This pass adds the "probe + rank-the-batch + search-wider" design, agreed
// after a longer conversation about PDL's per-record credit cost and how to
// avoid a recruiter either overpaying for a huge pull or getting stuck with
// an artificially narrow top-N with no way to see more:
//   - Preview (the "probe"): before spending credits on real candidate
//     records, run a 1-credit size=1 call just to see the total match
//     count. PDL returns the accurate `total` for any size, including 1, so
//     this shows "315 people match" up front for the minimum possible cost,
//     before the recruiter commits to pulling a real batch.
//   - Fetch candidates: once they've seen the total, the recruiter picks how
//     many to actually pull and reviews the whole batch -- nothing in that
//     batch is hidden or pre-filtered (the "rank the batch" half of the
//     design).
//   - Search wider: pulls the NEXT batch of the same search (not a
//     re-run with loosened criteria -- that distinction was confirmed
//     explicitly, not assumed) using PDL's scroll_token, so clicking it
//     again goes deeper into the same 315 matches rather than re-paying for
//     people already seen or guessing at which filter to relax.
//
// Checkpoint 3c adds real ranking: the backend now scores each candidate
// against the role brief using Voyage AI semantic embeddings and returns a
// "_match_score" alongside every result. This screen sorts by that score
// (highest first) but never hides anyone below any cutoff -- Harsha's
// explicit call: every candidate PDL returned stays visible and reviewable,
// scoring only changes the order, never what's shown. If scoring wasn't
// available for a given search (e.g. Voyage API key not configured), the
// backend says so in a note and candidates just show in PDL's original
// order with no score badge.
//
// Calibration loop (added after query-tightening against PDL hit its
// natural ceiling -- see the header comment in
// source-candidates-discovery/index.ts): PDL's boolean query can only
// narrow a 6000+ match pool so far, and a LinkedIn/PDL profile isn't the
// source of truth to begin with -- it can be stale. Rather than keep
// fighting the query, this adds a cheap gut-check that uses the recruiter's
// own judgment instead: after previewing the total, the recruiter can pull
// just the top 3 Voyage-ranked candidates and mark each one fit / not a
// fit with a required reason, before deciding whether/how many to actually
// fetch. Reuses the same sourceCandidates(id, 3) call the real fetch uses
// (not a separate preview) so it naturally advances the same scroll
// position -- a later "Fetch candidates" continues past these 3 rather than
// re-showing them. v1 scope: this is display/review only, saved for later
// reference -- it does not change ranking or query logic.

import { useEffect, useState } from "react";
import { useDataProvider, useNotify } from "ra-core";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { CrmDataProvider } from "../providers/types";
import { mergeCandidatesAcrossSources } from "./mergeCandidates";

type RoleBriefOption = {
  id: number;
  name: string;
};

// Agent H: "Searching for:" transparency panel. Separate from the `notes`
// array below (which is the backend's own blow-by-blow of how each
// criterion was actually applied in the query -- still shown, still
// useful) -- this is the clean, scannable version of the same underlying
// criteria, shown as soon as a role brief is picked, before any credit is
// spent on a preview. Fetched straight from the deals row rather than
// duplicated/re-derived, so it can never drift from what the backend
// actually searches on.
type RoleBriefDetail = {
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
  // Agent H, 2026-07-22: ranked primary-vs-fallback profile, only
  // populated when the JD genuinely described one (see
  // parse-job-description's header comment). Rendered as distinct tier
  // groups below instead of folding into the flat "Must have" line.
  preference_tiers:
    | Array<{
        rank: number;
        label: string;
        keywords: string[];
        condition: string | null;
      }>
    | null;
  // Task #43 (2026-07-22): ambiguities parse-job-description flagged at
  // intake time. Surfaced here too (not just in JdIntakePage's one-time
  // review screen) so a recruiter who comes back to this role brief later
  // -- rather than dismissing it right at creation -- still sees it until
  // they explicitly acknowledge it.
  clarifying_questions: string[] | null;
  clarifying_questions_dismissed: boolean;
};

type PdlCandidate = {
  id: string;
  full_name?: string;
  job_title?: string;
  job_company_name?: string;
  location_name?: string;
  linkedin_url?: string;
  emails?: { address: string; type?: string }[];
  skills?: string[];
  // Added by source-candidates-discovery in checkpoint 3b: whether this
  // exact PDL profile is already saved as a candidate in this tenant.
  _already_saved?: boolean;
  _candidate_id?: number | null;
  // Added in checkpoint 3c: semantic similarity to the role brief, 0-1
  // (Voyage AI embeddings, plain dot product since Voyage's vectors are
  // already unit-length). Null/absent when scoring wasn't available for
  // this search -- see the "notes" array for why.
  _match_score?: number | null;
  // Free-portal sourcing (2026-07-19): which free portal this candidate
  // came from ("github" | "stackoverflow" | "huggingface" | "kaggle") and
  // that portal's own profile/repo/kernel URL -- these candidates have no
  // LinkedIn URL at all (none of the four free portals expose one), so
  // _portal_url is the only link shown for them. Absent for Coresignal/PDL/
  // Apollo candidates.
  _source_vendor?: string;
  _portal_url?: string | null;
  // X-ray query ladder (2026-07-22, source-candidates-xray only): set when
  // this candidate was surfaced by a broadened rung of the search (a title
  // synonym, a state-name or nearby-metro location expansion, or the
  // broadest skill-only net) rather than an exact title+location match --
  // see that function's buildQueryLadder for the full rung list. Null/absent
  // for an exact ("narrow") match, since that doesn't need explaining.
  _match_evidence?: string | null;
  // Cross-provider merge (2026-07-19, see mergeCandidates.ts): present only
  // when this card represents more than one raw search hit merged by name
  // match across the free portals + Exa. Every source's own portal URL is
  // kept here so the card can still link out to each profile.
  _all_portals?: Array<{ vendor: string; url: string | null }>;
};

// Free-portal sourcing (2026-07-19): result shape returned by
// dataProvider.sourceFreePortalCandidates (source-candidates-free-portals
// edge function) -- GitHub, Stack Overflow, Hugging Face, and Kaggle, via
// their own free official APIs, before any paid-vendor decision is made.
type FreePortalResult = {
  candidates: PdlCandidate[];
  notes: string[];
  total: number;
};

// Exa.ai sourcing (2026-07-19): result shape returned by
// dataProvider.sourceExaCandidates (source-candidates-exa edge function) --
// a paid, general public-web people-search API, run alongside the free
// portals in one combined "Search" action (Harsha's call: its per-search
// cost is negligible enough not to gate behind a separate click) but kept
// as its own provider/edge function since cost is a real, distinct property
// worth staying visible about, unlike the four fully-free portals.
type ExaResult = {
  candidates: PdlCandidate[];
  notes: string[];
  total: number;
};

type SourceResult = {
  role_brief: { id: number; title: string | null; location: string | null };
  query_used: unknown;
  notes: string[];
  total: number;
  candidates: PdlCandidate[];
  scroll_token: string | null;
};

// Display-only formatting: PDL returns text fields (names, titles, company
// names, locations) fully lowercased -- that's how PDL stores/matches them
// internally, not a data quality issue on our end. This capitalizes the
// first letter of each word purely for what's shown on screen; it never
// touches source_raw or anything sent to save-sourced-candidate, so
// search/dedup logic is completely unaffected.
//
// Known limitation: a simple word-capitalization rule can't know about
// proper nouns with non-standard casing -- e.g. "ibm" becomes "Ibm" (not
// "IBM"), "pwc" becomes "Pwc" (not "PwC"), "o'brien" becomes "O'brien" (not
// "O'Brien"). Good enough for readability; not a substitute for a real
// name/brand-casing lookup.
function titleCase(value: unknown): string | undefined {
  // Bugfix: PDL's real-world data doesn't always match our declared types --
  // a field like job_company_name can occasionally come back as something
  // other than a plain string (e.g. missing, or a non-string value for an
  // unusual record). TypeScript's "string" type is a compile-time promise
  // only, not a runtime guarantee, so this checks the actual type before
  // calling .replace on it -- without this check, a non-string value threw
  // "value.replace is not a function" and broke the whole screen for any
  // search that included one of these records.
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.replace(/\w\S*/g, (word) =>
    word.charAt(0).toUpperCase() + word.slice(1),
  );
}

// X-ray Assist (2026-07-19): builds ready-to-click search-engine query
// links from a role brief's own structured fields -- title, location, top
// required skills -- the same manual X-ray technique recruiters have always
// used (site:linkedin.com/in + boolean terms), just generated for them
// instead of hand-written. This is the legitimate version of "scan
// LinkedIn": the recruiter clicks the link and does the actual searching/
// reviewing in their own browser, same as always -- nothing here automates
// LinkedIn itself or touches its bot-detection in any way. Deliberately no
// backend call: everything needed is already loaded on this page.
//
// Google/Bing links only cover manually-typed X-ray search -- see the
// research behind this feature: Google closed its Custom Search JSON API to
// new signups in 2025 and Microsoft fully retired the Bing Search API in
// August 2025, so there is no free way to automate this server-side anymore
// (a paid SERP API is the only automated option left, which defeats the
// point of a free-portal search). DuckDuckGo is included as a third option
// since it has historically been more tolerant of this kind of query and
// needs no account to use.
function buildXrayQueries(
  roleBrief: RoleBriefDetail,
): Array<{ label: string; url: string }> {
  const topSkills = (roleBrief.required_skills ?? roleBrief.must_have_keywords ?? []).slice(0, 3);
  const terms = [roleBrief.name, ...topSkills].filter(
    (t): t is string => typeof t === "string" && t.length > 0,
  );
  const locationTerm =
    roleBrief.location && !/remote/i.test(roleBrief.location)
      ? roleBrief.location.split(",")[0].trim()
      : "";

  const buildQuery = (siteFilter: string) =>
    [siteFilter, ...terms.map((t) => `"${t}"`), locationTerm].filter((s) => s.length > 0).join(" ");

  const linkedinQuery = buildQuery("site:linkedin.com/in");
  const webQuery = buildQuery("");

  return [
    { label: "Google -- LinkedIn X-ray", url: `https://www.google.com/search?q=${encodeURIComponent(linkedinQuery)}` },
    { label: "Bing -- LinkedIn X-ray", url: `https://www.bing.com/search?q=${encodeURIComponent(linkedinQuery)}` },
    { label: "DuckDuckGo -- LinkedIn X-ray", url: `https://duckduckgo.com/?q=${encodeURIComponent(linkedinQuery)}` },
    { label: "Google -- general web", url: `https://www.google.com/search?q=${encodeURIComponent(webQuery)}` },
  ];
}

// Checkpoint 3c: sorts a candidate list best-match-first by _match_score.
// A stable sort (Array.prototype.sort is stable in modern JS engines) so
// candidates with equal or missing scores keep their relative order rather
// than jumping around unpredictably. Missing scores sink to the bottom
// rather than the top -- an unscored result isn't necessarily a bad match,
// but a scored, high-similarity one is a more confident recommendation, so
// it's shown first. This never removes anyone from the list, only reorders.
function sortByScore(candidates: PdlCandidate[]): PdlCandidate[] {
  return [...candidates].sort((a, b) => {
    const scoreA = typeof a._match_score === "number" ? a._match_score : -Infinity;
    const scoreB = typeof b._match_score === "number" ? b._match_score : -Infinity;
    return scoreB - scoreA;
  });
}

// Per-result "Add to pipeline" state, keyed by PDL candidate id. Separate
// from the _already_saved flag the backend sends: this tracks what's
// happening *during this session* (in flight / just saved), so the button
// updates immediately without needing to re-run the search.
type SaveState = "idle" | "saving" | "saved";

// Agent H Stage 3, tasks #27/#28: per-result enrichment state, keyed by PDL
// candidate id. Both enrichments are manual/on-demand only -- a recruiter
// must click the button for one specific already-saved candidate; nothing
// here fires automatically off "Add to pipeline" or off a raw search hit.
type EnrichState = "idle" | "loading" | "done";

type ContactEnrichResult = {
  status: "enriched" | "not_found" | "failed";
  source: "hunter" | "apollo" | null;
  email: string | null;
  notes: string[];
};

type DevSignalEnrichResult = {
  status: "enriched" | "not_found" | "failed";
  github_url: string | null;
  github_corroborated: boolean | null;
  stackoverflow_url: string | null;
  stackoverflow_corroborated: boolean | null;
  notes: string[];
};

// Agent H Stage 3, task #75: full-profile (rich, LinkedIn-style) enrichment.
// enrichCandidateWorkHistory just triggers the vendor call and reports what
// happened; the actual content is read back separately via
// getCandidateFullProfile (a plain, free DB read) so re-opening an
// already-enriched profile never re-spends a vendor credit.
type FullProfileEnrichResult = {
  status: "enriched" | "not_found" | "failed";
  source: "coresignal_collect" | "pdl_enrich" | null;
  experience_count: number;
  education_count: number;
  notes: string[];
};

type WorkHistoryEntry = {
  title: string | null;
  company: string | null;
  date_from: string | null;
  date_to: string | null;
  duration_months: number | null;
  description: string | null;
};

// Deliberately loose -- Coresignal's collect response and PDL's enrich
// response name things slightly differently, and this is a raw passthrough
// blob (see full_profile_raw's column comment). The rendering below reads
// defensively, field by field, rather than assuming one fixed shape.
type FullProfileRaw = Record<string, any>;

type FullProfileData = {
  full_profile_status: string | null;
  full_profile_source: string | null;
  full_profile_raw: FullProfileRaw | null;
  full_profile_updated_at: string | null;
  work_history: WorkHistoryEntry[] | null;
};

// Agent H Stage 4: Screening. This is a port of Kharta's real scoring
// engine (see score-candidate/index.ts for the full "why" and what's
// ported verbatim vs. adapted) -- scores the currently-selected role brief
// against one already-saved candidate. Same "only after Add to pipeline"
// gating as every other enrichment on this screen.
type DimensionScore = { score: number; rationale: string; quote: string | null };
type MustHaveCheck = {
  requirement: string;
  status: "found" | "inferred" | "absent";
  confidence: "high" | "medium" | "low";
};
type RecruiterCard = {
  most_recent_title: string;
  total_years_experience: string;
  career_pattern: string;
  what_stands_out: string[];
  worth_exploring: string[];
  interview_questions: string[];
};
type ScoreResult = {
  overall_score: number;
  verdict: "EXCEPTIONAL MATCH" | "STRONG MATCH" | "POTENTIAL MATCH" | "WEAK MATCH" | "NOT A MATCH";
  confidence_level: "high" | "medium" | "low";
  dimension_scores: Record<"skills" | "trajectory" | "domain" | "seniority" | "tenure", DimensionScore>;
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

const VERDICT_COLORS: Record<ScoreResult["verdict"], string> = {
  "EXCEPTIONAL MATCH": "bg-violet-100 text-violet-800 border-violet-300",
  "STRONG MATCH": "bg-green-100 text-green-800 border-green-300",
  "POTENTIAL MATCH": "bg-amber-100 text-amber-800 border-amber-300",
  "WEAK MATCH": "bg-orange-100 text-orange-800 border-orange-300",
  "NOT A MATCH": "bg-red-100 text-red-800 border-red-300",
};

const ACTION_LABELS: Record<ScoreResult["recommended_action"], string> = {
  interview: "Interview",
  hold: "Hold",
  reject: "Reject",
};

const DIMENSION_LABELS: Record<keyof ScoreResult["dimension_scores"], string> = {
  skills: "Technical Skills",
  trajectory: "Career Growth",
  domain: "Industry Experience",
  seniority: "Seniority Level",
  tenure: "Job Stability",
};

// Agent H Stage 3: Sourcing -- LinkedIn-stage holistic fit assessment.
// Deliberately NOT a number/verdict -- see assess-candidate-fit's own
// header comment for the full "why". Kept side by side with the numeric
// Score candidate button (Harsha's explicit call, 2026-07-15).
type FitBucket = "worth_reaching_out" | "possible_check" | "not_a_fit";
type FitAssessmentResult = {
  fit_bucket: FitBucket;
  summary: string;
  matches: string[];
  worth_verifying: string[];
  clear_gaps: string[];
  scored_text_source: "full_profile" | "plain_fields";
};

const FIT_BUCKET_LABELS: Record<FitBucket, string> = {
  worth_reaching_out: "Worth reaching out",
  possible_check: "Possible, worth a quick check",
  not_a_fit: "Not a fit",
};

const FIT_BUCKET_COLORS: Record<FitBucket, string> = {
  worth_reaching_out: "bg-green-100 text-green-800 border-green-300",
  possible_check: "bg-amber-100 text-amber-800 border-amber-300",
  not_a_fit: "bg-red-100 text-red-800 border-red-300",
};

// Real calibration loop (2026-07-17): after a "Not a fit" judgment is
// saved, this turns the reason into a real, checkable search criterion and
// shows the blast radius before the recruiter commits to it -- see
// dataProvider.contextualizeCalibrationFeedback and the edge function's
// handleCalibrationContextualize for the full design.
type ContextualizeResult = {
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

// Real calibration loop: Control Panel data (Noon-style live per-rule
// reject counts, with Relax/Reapply) -- see
// dataProvider.getRoleBriefCriteriaImpact.
type CriteriaImpact = {
  base_total: number | null;
  criteria: Array<{
    id: number;
    criterion_type: string;
    label: string;
    status: "active" | "relaxed";
    rejected_count: number | null;
  }>;
};

// Agent H Stage 5: Scheduling -- result shape returned by
// dataProvider.createBookingLink (create-booking-link edge function).
// Booking itself happens on a self-hosted Cal.com instance; this app never
// talks calendar OAuth directly (see that function's header comment).
type InterviewResult = {
  already_booked: boolean;
  interview_id?: number | null;
  status: "link_sent" | "booked" | "rescheduled" | "cancelled" | "completed" | "no_show";
  booking_link_url: string;
  scheduled_at?: string | null;
  scheduled_end_at?: string | null;
  candidate_email?: string | null;
  email_sent?: boolean;
};

const INTERVIEW_STATUS_LABELS: Record<InterviewResult["status"], string> = {
  link_sent: "Booking link sent",
  booked: "Interview booked",
  rescheduled: "Interview rescheduled",
  cancelled: "Interview cancelled",
  completed: "Interview completed",
  no_show: "Candidate no-showed",
};

const INTERVIEW_STATUS_COLORS: Record<InterviewResult["status"], string> = {
  link_sent: "bg-blue-100 text-blue-800 border-blue-300",
  booked: "bg-green-100 text-green-800 border-green-300",
  rescheduled: "bg-amber-100 text-amber-800 border-amber-300",
  cancelled: "bg-red-100 text-red-800 border-red-300",
  completed: "bg-slate-100 text-slate-800 border-slate-300",
  no_show: "bg-red-100 text-red-800 border-red-300",
};

// Agent H, task 76: outreach + resume-reply capture. Deliberately NOT a
// messaging/inbox system -- one templated email out, one reply captured back
// onto the candidate record. See request-candidate-resume/index.ts and
// resend-inbound-reply/index.ts for the full design reasoning.
type ResumeInfo = {
  resume_status: "not_requested" | "requested" | "received";
  resume_original_filename: string | null;
  resume_received_at: string | null;
  resume_reply_text: string | null;
};

const RESUME_STATUS_LABELS: Record<ResumeInfo["resume_status"], string> = {
  not_requested: "Resume not requested",
  requested: "Resume requested",
  received: "Resume received",
};

const RESUME_STATUS_COLORS: Record<ResumeInfo["resume_status"], string> = {
  not_requested: "bg-slate-100 text-slate-800 border-slate-300",
  requested: "bg-blue-100 text-blue-800 border-blue-300",
  received: "bg-green-100 text-green-800 border-green-300",
};

// Agent H Stage 6: Offer. Deliberately not a messaging system either (same
// PRD Section 3 deferral as task 76) -- one templated email out via
// send-offer, one reply captured back as free text via resend-inbound-reply.
// status only auto-advances sent -> responded; accepted/declined/negotiating
// are always a recruiter's own manual call after reading response_text --
// see the offers table migration comment for the full reasoning.
type OfferInfo = {
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

const OFFER_STATUS_LABELS: Record<OfferInfo["status"], string> = {
  draft: "Offer drafted",
  sent: "Offer sent",
  responded: "Candidate replied",
  accepted: "Offer accepted",
  declined: "Offer declined",
  negotiating: "Negotiating",
  expired: "Offer expired",
};

const OFFER_STATUS_COLORS: Record<OfferInfo["status"], string> = {
  draft: "bg-slate-100 text-slate-800 border-slate-300",
  sent: "bg-blue-100 text-blue-800 border-blue-300",
  responded: "bg-amber-100 text-amber-800 border-amber-300",
  accepted: "bg-green-100 text-green-800 border-green-300",
  declined: "bg-red-100 text-red-800 border-red-300",
  negotiating: "bg-amber-100 text-amber-800 border-amber-300",
  expired: "bg-slate-100 text-slate-800 border-slate-300",
};

// Draft state for the inline "compose an offer" form -- amounts kept as
// strings while editing (native number input value), parsed to a number
// only at submit time.
type OfferDraft = {
  position_title: string;
  compensation_amount: string;
  compensation_currency: string;
  compensation_frequency: "annual" | "monthly";
  start_date: string;
  expiry_date: string;
  benefits_summary: string;
};

const EMPTY_OFFER_DRAFT: OfferDraft = {
  position_title: "",
  compensation_amount: "",
  compensation_currency: "INR",
  compensation_frequency: "annual",
  start_date: "",
  expiry_date: "",
  benefits_summary: "",
};

// Per-calibration-card state, keyed by PDL candidate id.
type CalibrationEntryState = "idle" | "submitting" | "submitted";

// The screen moves through three stages per role brief:
//   idle      -- nothing previewed yet for the currently selected role
//   previewed -- total match count is known, no candidate records fetched
//   fetched   -- at least one batch of real candidate records is showing
type Stage = "idle" | "previewed" | "fetched";

// Formats a Coresignal-style {date_from_year, date_from_month} / PDL-style
// plain date string into something readable, without assuming either shape
// is present -- both vendors are inconsistent about which fields they fill
// in for any given entry (see the "position_title came back null for one
// real candidate's most recent role" finding from testing this feature).
function formatDateRange(dateFrom: unknown, dateTo: unknown): string {
  const from = typeof dateFrom === "string" && dateFrom ? dateFrom : null;
  const to = typeof dateTo === "string" && dateTo ? dateTo : null;
  if (!from && !to) return "";
  return `${from ?? "?"} -- ${to ?? "Present"}`;
}

// Agent H Stage 3, task #75: renders the full, on-demand-enriched profile
// for one candidate. Deliberately reads from the SIMPLE work_history column
// (title/company/dates/description -- populated by
// enrich-candidate-workhistory at enrichment time) for the experience
// timeline, since that's already normalized across both vendors; education/
// certifications/languages/skills are read straight from full_profile_raw
// since those are Coresignal-specific field names for now (PDL fallback
// support for those sections can be added if/when a real candidate actually
// falls through to the PDL branch).
function FullProfilePanel({ profile }: { profile: FullProfileData }) {
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
                  {job.duration_months
                    ? ` (${job.duration_months} mo)`
                    : ""}
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
              lang.proficiency ? `${lang.language} (${lang.proficiency})` : lang.language,
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
            Profile was enriched, but no experience, education, or skills
            fields came back for this candidate.
          </p>
        )}
    </div>
  );
}

// Agent H Stage 4: renders one candidate's score against the currently
// selected role brief. Ported from Kharta's real scoring engine -- see
// score-candidate/index.ts for the full "why" and what's ported verbatim
// (weighted dimension formula, verdict thresholds, deal-breaker penalty,
// recommended-action derivation) vs. adapted (Claude instead of GPT-4o-mini,
// plain-string flags instead of Kharta's multi-model AttributedFlag shape).
function ScorePanel({ result }: { result: ScoreResult }) {
  const dims = Object.entries(result.dimension_scores) as Array<
    [keyof ScoreResult["dimension_scores"], DimensionScore]
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
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {result.deal_breaker_warning}
        </p>
      )}

      {result.scored_text_source === "plain_fields" && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
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
                <span className="text-xs font-medium">{DIMENSION_LABELS[key]}</span>
                <span className="text-xs text-muted-foreground">{dim.score}/100</span>
              </div>
              <div className="text-xs text-muted-foreground">{dim.rationale}</div>
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
                      ? "text-green-700"
                      : m.status === "inferred"
                        ? "text-amber-700"
                        : "text-red-700"
                  }
                >
                  {m.status === "found" ? "✓" : m.status === "inferred" ? "~" : "✗"}
                </span>
                <span>{m.requirement}</span>
                <span className="text-muted-foreground">({m.confidence} confidence)</span>
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
              <div className="font-medium text-xs mb-1">Risks / worth exploring</div>
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
          <div className="font-medium text-xs mb-1">Suggested interview questions</div>
          <ul className="text-xs text-muted-foreground list-disc pl-4">
            {result.recruiter_card.interview_questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      {(result.green_flags.length > 0 || result.watch_signals.length > 0 || result.review_flags.length > 0) && (
        <div className="text-xs flex flex-col gap-1">
          {result.green_flags.length > 0 && (
            <div>
              <span className="font-medium text-green-700">Green flags: </span>
              {result.green_flags.join("; ")}
            </div>
          )}
          {result.watch_signals.length > 0 && (
            <div>
              <span className="font-medium text-amber-700">Watch: </span>
              {result.watch_signals.join("; ")}
            </div>
          )}
          {result.review_flags.length > 0 && (
            <div>
              <span className="font-medium text-red-700">Review: </span>
              {result.review_flags.join("; ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Agent H Stage 3: renders the holistic, non-numeric fit read for one
// candidate against the currently selected role brief -- see
// assess-candidate-fit/index.ts for the full design reasoning.
function FitAssessmentPanel({ result }: { result: FitAssessmentResult }) {
  return (
    <div className="border rounded-md p-3 bg-muted/30 flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span
          className={`text-xs font-medium border rounded px-2 py-0.5 ${FIT_BUCKET_COLORS[result.fit_bucket]}`}
        >
          {FIT_BUCKET_LABELS[result.fit_bucket]}
        </span>
        {result.scored_text_source === "plain_fields" && (
          <span className="text-xs text-amber-700">
            Limited discovery fields only -- run "View full profile" first
            for a better read.
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
          <div className="font-medium text-xs mb-1">Worth verifying in a screen</div>
          <ul className="text-xs text-muted-foreground list-disc pl-4">
            {result.worth_verifying.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {result.clear_gaps.length > 0 && (
        <div>
          <div className="font-medium text-xs mb-1 text-red-700">Clear gaps</div>
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

// Real calibration loop: the "give feedback, see the blast radius before
// committing" widget -- originally built for the dedicated 3-candidate
// Coresignal calibration ritual only. Extracted (2026-07-19) so the exact
// same reason -> contextualize -> blast-radius-preview -> Apply flow can
// also run on free-portal/Exa candidate cards, not just Coresignal's --
// Harsha's original ask ("blast radius preview before committing a
// tightened rule") never said Coresignal-only, and the underlying handlers
// (submitCalibrationFeedback/contextualizeCalibrationFeedback/
// applyLearnedCriterion) already only need a source id + a plain-field
// snapshot, nothing Coresignal-specific -- same reuse pattern as
// FitAssessmentPanel above. No new state: both call sites share the same
// calibrationReasons/calibrationEntryStates/contextualizeStates/
// contextualizeResults/applyStates maps, keyed by candidate.id either way.
function CalibrationFeedbackWidget({
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
        Not a fit? Give a reason -- it becomes a real search criterion for
        this role, and you'll see how many candidates it would exclude
        before it's ever applied.
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

// Pipeline action cluster (2026-07-19): originally written inline only for
// Coresignal-search-result cards -- Harsha's direct follow-up after seeing
// that free-portal/Exa candidates only got Assess-fit/calibration feedback:
// "close the pending things you flagged" (Score/Enrich contact/Enrich dev
// signals/Schedule interview/Request resume/Send offer were flagged as
// Coresignal-card-only even though every one of those edge functions is
// already vendor-neutral -- keyed by the saved candidates.id + deal id, not
// by _source_vendor). Extracted into one shared component so both card
// lists render the identical action cluster instead of duplicating ~280
// lines of JSX a second time. `showFullProfile` defaults true for the
// Coresignal list; the free-portal/Exa list passes false, since "View full
// profile" is the one action that's genuinely Coresignal/PDL-specific (it
// calls Coresignal's own Collect API / PDL's Enrich API -- there is no
// equivalent full-profile fetch for a GitHub/Stack Exchange/Hugging
// Face/Kaggle/Exa candidate to enrich from).
function CandidateActionsPanel({
  candidate,
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
  resumeState,
  resumeInfo,
  onRequestResume,
  onCheckForResume,
  offerState,
  offerInfo,
  offerFormIsOpen,
  offerDraft,
  onToggleOfferForm,
  onOfferDraftChange,
  onSendOffer,
  onCheckOffer,
  onMarkOfferStatus,
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
  resumeState: EnrichState;
  resumeInfo: ResumeInfo | undefined;
  onRequestResume: () => void;
  onCheckForResume: () => void;
  offerState: EnrichState;
  offerInfo: OfferInfo | undefined;
  offerFormIsOpen: boolean;
  offerDraft: OfferDraft;
  onToggleOfferForm: () => void;
  onOfferDraftChange: (field: keyof OfferDraft, value: string) => void;
  onSendOffer: () => void;
  onCheckOffer: () => void;
  onMarkOfferStatus: (status: "accepted" | "declined" | "negotiating") => void;
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
            ? "Generating link..."
            : interviewResult
              ? "Refresh booking status"
              : "Schedule interview"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={resumeState === "loading"}
          onClick={onRequestResume}
        >
          {resumeState === "loading"
            ? "Sending..."
            : resumeInfo
              ? "Re-request resume"
              : "Request resume"}
        </Button>
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
                className="text-blue-600 underline"
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
                className="text-blue-600 underline"
              >
                {devSignalResult.stackoverflow_url}
              </a>
              {devSignalResult.stackoverflow_corroborated
                ? " (corroborated)"
                : " (name match only -- verify)"}
            </div>
          )}
          {!devSignalResult.github_url && !devSignalResult.stackoverflow_url && (
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

      {resumeInfo && <ResumePanel info={resumeInfo} />}

      {offerFormIsOpen && (
        <OfferForm
          draft={offerDraft}
          onChange={onOfferDraftChange}
          onSubmit={onSendOffer}
          onCancel={onToggleOfferForm}
          submitting={offerState === "loading"}
        />
      )}
      {!offerFormIsOpen && offerInfo && <OfferPanel info={offerInfo} />}
    </div>
  );
}

// Agent H Stage 5: Scheduling -- shows the current booking-link/booking
// state for one candidate against the currently selected role brief. Cal.com
// itself (not this app) owns the actual slot-picking UI; this panel just
// reflects whatever create-booking-link generated, or whatever a later
// Cal.com webhook has since updated it to (booked/rescheduled/cancelled).
function InterviewPanel({ result }: { result: InterviewResult }) {
  return (
    <div className="border rounded-md p-3 bg-muted/30 flex flex-col gap-2 text-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span
          className={`text-xs font-medium border rounded px-2 py-0.5 ${INTERVIEW_STATUS_COLORS[result.status]}`}
        >
          {INTERVIEW_STATUS_LABELS[result.status]}
        </span>
        {result.email_sent === false && !result.already_booked && (
          <span className="text-xs text-amber-700">
            {result.candidate_email
              ? "Link saved, but the email didn't send -- share it manually."
              : "No email on file -- share this link with the candidate manually."}
          </span>
        )}
      </div>

      {result.scheduled_at && (
        <p className="text-xs">
          Scheduled for {new Date(result.scheduled_at).toLocaleString()}
        </p>
      )}

      <a
        href={result.booking_link_url}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-blue-700 underline break-all"
      >
        {result.booking_link_url}
      </a>
    </div>
  );
}

// Agent H, task 76: shows the current resume-request state for one
// candidate. "Check for resume" re-reads this from public.candidates --
// there's no live push, since a reply only exists once the candidate
// actually checks their email and responds (could be minutes or days later).
function ResumePanel({ info }: { info: ResumeInfo }) {
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

// Agent H Stage 6: shows the current offer state for one candidate. The
// accepted/declined/negotiating buttons live outside this component (in the
// main render, alongside "Check for resume") since this panel is
// display-only, same convention as InterviewPanel/ResumePanel/FitAssessmentPanel.
function OfferPanel({ info }: { info: OfferInfo }) {
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
      {detailLine && <p className="text-xs text-muted-foreground">{detailLine}</p>}
      {info.response_text && (
        <p className="text-xs text-muted-foreground italic">
          "{info.response_text.slice(0, 200)}
          {info.response_text.length > 200 ? "..." : ""}"
        </p>
      )}
    </div>
  );
}

// Agent H Stage 6: inline "compose an offer" form. Plain HTML inputs styled
// to match the rest of this screen -- no shadcn Input/Select/Textarea is
// imported elsewhere in this file, so introducing one here just for this
// form would be inconsistent, not simpler.
function OfferForm({
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
          {submitting ? "Sending..." : "Send offer"}
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

// Role Workspace (2026-07-19): when embedded inside RoleWorkspacePage,
// `initialRoleBriefId` is passed so this component behaves as a "sourcing
// panel" for one already-chosen role brief -- no dropdown, no NL-search
// toggle, no page-level heading (the workspace page owns that). This is
// deliberately NOT a rewrite of the internal state/handlers below (they
// still key everything off the same `selectedId` state they always did) --
// only the entry point changes: instead of a recruiter picking a role brief
// from a dropdown, the workspace page's URL (`/roles/:id`) picks it for
// them once, on mount. Standalone use at `/source-candidates` (no prop)
// keeps working exactly as before, dropdown and all.
export const SourceCandidatesPage = ({
  initialRoleBriefId,
}: {
  initialRoleBriefId?: string;
} = {}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const embedded = Boolean(initialRoleBriefId);

  const [roleBriefs, setRoleBriefs] = useState<RoleBriefOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [size, setSize] = useState(10);

  const [stage, setStage] = useState<Stage>("idle");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [wideningLoading, setWideningLoading] = useState(false);

  const [roleBriefTitle, setRoleBriefTitle] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [notes, setNotes] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<PdlCandidate[]>([]);
  const [scrollToken, setScrollToken] = useState<string | null>(null);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  // Real public.candidates row id for each PDL/vendor candidate id shown on
  // screen -- populated either from the backend's _candidate_id (when a
  // result comes back already-saved) or from save-sourced-candidate's own
  // response right after "Add to pipeline" succeeds. Enrichment always
  // targets this real row id, never the vendor's own candidate id.
  const [candidateDbIds, setCandidateDbIds] = useState<
    Record<string, number>
  >({});
  const [contactEnrichStates, setContactEnrichStates] = useState<
    Record<string, EnrichState>
  >({});
  const [contactEnrichResults, setContactEnrichResults] = useState<
    Record<string, ContactEnrichResult>
  >({});
  const [devSignalEnrichStates, setDevSignalEnrichStates] = useState<
    Record<string, EnrichState>
  >({});
  const [devSignalEnrichResults, setDevSignalEnrichResults] = useState<
    Record<string, DevSignalEnrichResult>
  >({});
  const [fullProfileStates, setFullProfileStates] = useState<
    Record<string, EnrichState>
  >({});
  const [fullProfileData, setFullProfileData] = useState<
    Record<string, FullProfileData>
  >({});
  const [fullProfileExpanded, setFullProfileExpanded] = useState<
    Record<string, boolean>
  >({});
  const [scoreStates, setScoreStates] = useState<Record<string, EnrichState>>(
    {},
  );
  const [scoreResults, setScoreResults] = useState<
    Record<string, ScoreResult>
  >({});
  const [fitStates, setFitStates] = useState<Record<string, EnrichState>>({});
  const [fitResults, setFitResults] = useState<
    Record<string, FitAssessmentResult>
  >({});

  // Agent H Stage 5: Scheduling -- per-candidate booking-link state, same
  // idle/loading/done pattern as scoring/fit assessment above.
  const [interviewStates, setInterviewStates] = useState<
    Record<string, EnrichState>
  >({});
  const [interviewResults, setInterviewResults] = useState<
    Record<string, InterviewResult>
  >({});

  // Agent H, task 76: per-candidate resume-request state. "loading" covers
  // both sending the request and re-checking for a reply.
  const [resumeStates, setResumeStates] = useState<
    Record<string, EnrichState>
  >({});
  const [resumeInfos, setResumeInfos] = useState<Record<string, ResumeInfo>>(
    {},
  );

  // Agent H Stage 6: per-candidate offer state. offerFormOpen/offerDrafts
  // back the inline compose form; offerStates/offerInfos mirror the
  // idle/loading/done + current-state pattern every other panel here uses.
  const [offerStates, setOfferStates] = useState<Record<string, EnrichState>>(
    {},
  );
  const [offerInfos, setOfferInfos] = useState<Record<string, OfferInfo>>({});
  const [offerFormOpen, setOfferFormOpen] = useState<Record<string, boolean>>(
    {},
  );
  const [offerDrafts, setOfferDrafts] = useState<Record<string, OfferDraft>>(
    {},
  );

  // Calibration loop state.
  const [calibrationLoading, setCalibrationLoading] = useState(false);
  const [calibrationStarted, setCalibrationStarted] = useState(false);
  const [calibrationCandidates, setCalibrationCandidates] = useState<
    PdlCandidate[]
  >([]);
  const [calibrationReasons, setCalibrationReasons] = useState<
    Record<string, string>
  >({});
  const [calibrationEntryStates, setCalibrationEntryStates] = useState<
    Record<string, CalibrationEntryState>
  >({});
  // Judgments already saved for this role brief from a previous visit --
  // shown as a heads-up, not used to block re-calibrating.
  const [existingCalibrationFeedback, setExistingCalibrationFeedback] =
    useState<Array<{ source_id: string; fit: boolean }>>([]);

  // Real calibration loop: keyed by the same calibration-candidate id as
  // calibrationReasons/calibrationEntryStates.
  const [contextualizeStates, setContextualizeStates] = useState<
    Record<string, "idle" | "loading" | "done">
  >({});
  const [contextualizeResults, setContextualizeResults] = useState<
    Record<string, ContextualizeResult>
  >({});
  const [applyStates, setApplyStates] = useState<
    Record<string, "idle" | "applying" | "applied">
  >({});

  // Real calibration loop: Control Panel data (Noon-style live per-rule
  // reject counts, with Relax/Reapply) -- loaded on demand, not
  // automatically, since computing it spends a handful of cheap Coresignal
  // preview calls (see getRoleBriefCriteriaImpact). Refreshed after Apply/
  // Relax/Reapply so the counts never go stale without the recruiter
  // noticing.
  const [criteriaImpact, setCriteriaImpact] = useState<CriteriaImpact | null>(
    null,
  );
  const [criteriaImpactLoading, setCriteriaImpactLoading] = useState(false);
  const [criteriaActionStates, setCriteriaActionStates] = useState<
    Record<number, "idle" | "working">
  >({});

  const [roleBriefDetail, setRoleBriefDetail] =
    useState<RoleBriefDetail | null>(null);

  // Task #43: dismiss the clarifying-questions advisory from wherever the
  // recruiter is looking at this role brief (not just at intake) -- persists
  // via a plain update, same "no dedicated edge function needed" pattern as
  // the calibration-criterion writes above.
  const handleDismissClarifyingQuestions = async () => {
    if (!selectedId) return;
    setRoleBriefDetail((current) =>
      current ? { ...current, clarifying_questions_dismissed: true } : current,
    );
    try {
      await dataProvider.update("deals", {
        id: Number(selectedId),
        data: { clarifying_questions_dismissed: true },
        previousData: { id: Number(selectedId) },
      });
    } catch (error: any) {
      notify(error?.message || "Failed to dismiss", { type: "error" });
    }
  };

  // Free-portal sourcing (2026-07-19): GitHub/Stack Overflow/Hugging Face/
  // Kaggle, via source-candidates-free-portals -- a separate, free path from
  // the Coresignal/PDL/Apollo "Preview matches" flow above, before any paid-
  // vendor decision is made. Its own loading/results/notes state, kept
  // independent of `stage`/`candidates`/`notes` so it can be searched
  // whether or not a Coresignal preview has been run at all.
  const [freePortalLoading, setFreePortalLoading] = useState(false);
  const [freePortalCandidates, setFreePortalCandidates] = useState<
    PdlCandidate[]
  >([]);
  const [freePortalNotes, setFreePortalNotes] = useState<string[]>([]);
  const [freePortalSearched, setFreePortalSearched] = useState(false);

  // X-ray search (2026-07-22): a separate, explicitly-triggered action --
  // kept out of handleSearchFreePortals/continueSourcingForDeal so it stays
  // a deliberate recruiter choice rather than something a casual "source
  // candidates" command fires automatically. Originally built against
  // BrightData's SERP API (v1), then a direct DuckDuckGo fetch (v2, blocked
  // by bot detection from this function's datacenter egress IPs), then a
  // BrightData proxy relay (v3, worked but needs a paid BrightData zone +
  // payment method Harsha hadn't set up) -- now runs on Exa's
  // `includeDomains` parameter (v4), which is already a live, working,
  // ~$0.015/search vendor on this project (same one behind "Free & low-cost
  // search"), so no new zone/payment/vendor is needed. Its own loading
  // state so the button can't be double-clicked into two runs.
  const [xrayLoading, setXrayLoading] = useState(false);

  // Agent H: Mode 2, natural-language search independent of a JD. Reuses
  // the exact same parseJobDescription call JD Intake uses -- the LLM
  // prompt already turns loose text into structured criteria, so a short
  // one-line query works the same way a full JD does, just less detailed.
  // Still creates a real deals row (a role brief) rather than a parallel
  // ad-hoc search path: the discovery edge function only ever reads from
  // deals, and a quick exploratory search is easy to archive afterward if
  // it wasn't meant to become a tracked open role.
  const [nlText, setNlText] = useState("");
  const [nlParsing, setNlParsing] = useState(false);

  useEffect(() => {
    dataProvider
      .getList("deals", {
        pagination: { page: 1, perPage: 100 },
        sort: { field: "id", order: "DESC" },
        filter: {},
      })
      .then(({ data }) => {
        setRoleBriefs(
          (data as any[]).map((d) => ({ id: d.id, name: d.name })),
        );
      })
      .catch(() => {
        notify("Failed to load role briefs", { type: "error" });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching role briefs invalidates any preview/results from the last
  // one -- otherwise a stale total or candidate list from role A could sit
  // on screen while role B is selected, which would be actively misleading.
  const handleRoleBriefChange = (value: string) => {
    setSelectedId(value);
    setStage("idle");
    setTotal(0);
    setNotes([]);
    setCandidates([]);
    setScrollToken(null);
    setSaveStates({});
    setCandidateDbIds({});
    setContactEnrichStates({});
    setContactEnrichResults({});
    setDevSignalEnrichStates({});
    setDevSignalEnrichResults({});
    setFullProfileStates({});
    setFullProfileData({});
    setFullProfileExpanded({});
    setScoreStates({});
    setScoreResults({});
    setFitStates({});
    setFitResults({});
    setCalibrationLoading(false);
    setCalibrationStarted(false);
    setCalibrationCandidates([]);
    setCalibrationReasons({});
    setCalibrationEntryStates({});
    setExistingCalibrationFeedback([]);
    setContextualizeStates({});
    setContextualizeResults({});
    setApplyStates({});
    setCriteriaImpact(null);
    setCriteriaActionStates({});
    setRoleBriefDetail(null);

    if (value) {
      dataProvider
        .getCalibrationFeedback(Number(value))
        .then((rows) =>
          setExistingCalibrationFeedback(
            (rows as any[]).map((r) => ({ source_id: r.source_id, fit: r.fit })),
          ),
        )
        .catch(() => {
          // Non-fatal -- just means the "already calibrated" heads-up won't
          // show. Doesn't block anything else on the page.
        });

      dataProvider
        .getOne("deals", { id: Number(value) })
        .then(({ data }) => setRoleBriefDetail(data as unknown as RoleBriefDetail))
        .catch(() => {
          // Non-fatal -- just means the "Searching for:" panel won't show;
          // Preview/Fetch still work off the backend's own read of the row.
        });
    }
  };

  // Role Workspace embedding (2026-07-19): when a role brief id arrives via
  // props instead of the dropdown, select it exactly once on mount by
  // reusing the same handleRoleBriefChange path a manual dropdown pick would
  // take -- same reset-then-load behavior, same calibration-feedback and
  // role-brief-detail fetches, no separate code path to keep in sync.
  useEffect(() => {
    if (initialRoleBriefId) {
      handleRoleBriefChange(initialRoleBriefId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoleBriefId]);

  // Mode 2: parse a plain-English query into a role brief, create it, then
  // drop the recruiter into the exact same previewed-and-ready state
  // handleRoleBriefChange leaves a normal JD-based pick in -- deliberately
  // NOT auto-running Preview (a real, if tiny, credit spend) without an
  // explicit click, same cost-consciousness as every other action here.
  const handleNlSearch = async () => {
    if (!nlText.trim()) {
      notify("Describe who you're looking for first", { type: "warning" });
      return;
    }
    setNlParsing(true);
    try {
      const parsed = await dataProvider.parseJobDescription(nlText);
      const { data: created } = await dataProvider.create("deals", {
        data: {
          name: parsed.title || nlText.slice(0, 60),
          stage: "sourcing",
          jd_text: nlText,
          seniority: parsed.seniority,
          location: parsed.location,
          industry: parsed.industry,
          employment_type: parsed.employment_type,
          years_experience_min: parsed.years_experience_min,
          years_experience_max: parsed.years_experience_max,
          required_skills: parsed.required_skills ?? [],
          must_have_keywords: parsed.must_have_keywords ?? [],
          nice_to_have_keywords: parsed.nice_to_have_keywords ?? [],
          preference_tiers:
            parsed.preference_tiers && parsed.preference_tiers.length > 0
              ? parsed.preference_tiers
              : null,
          clarifying_questions:
            parsed.clarifying_questions && parsed.clarifying_questions.length > 0
              ? parsed.clarifying_questions
              : null,
          role_status: "new",
          contact_ids: [],
        },
      });
      notify("Search criteria extracted -- review below before previewing", {
        type: "success",
      });
      setRoleBriefs((current) => [
        { id: created.id, name: created.name },
        ...current,
      ]);
      setNlText("");
      handleRoleBriefChange(String(created.id));
    } catch (error: any) {
      notify(error?.message || "Failed to parse that search", {
        type: "error",
      });
    } finally {
      setNlParsing(false);
    }
  };

  // The "probe": a 1-credit size=1 call, purely to learn how many people
  // match before spending anything on real candidate records. Nothing here
  // is saved or shown as reviewable candidates yet -- just the count.
  const handlePreview = async () => {
    if (!selectedId) {
      notify("Pick a role brief first", { type: "warning" });
      return;
    }
    setPreviewLoading(true);
    setCandidates([]);
    setScrollToken(null);
    setSaveStates({});
    try {
      const data = (await dataProvider.sourceCandidates(
        Number(selectedId),
        1,
        null,
        true,
      )) as SourceResult;
      setRoleBriefTitle(data.role_brief.title);
      setTotal(data.total);
      setNotes(data.notes);
      setStage("previewed");
    } catch (error: any) {
      notify(error?.message || "Failed to preview matches", {
        type: "error",
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  // The real, paid fetch -- pulls `size` records from the top of the same
  // matched set the preview just counted.
  const handleFetch = async () => {
    if (!selectedId) return;
    setFetchLoading(true);
    try {
      const data = (await dataProvider.sourceCandidates(
        Number(selectedId),
        size,
      )) as SourceResult;
      setCandidates(sortByScore(data.candidates));
      setScrollToken(data.scroll_token);
      setTotal(data.total);
      setNotes(data.notes);
      const seeded: Record<string, SaveState> = {};
      const seededDbIds: Record<string, number> = {};
      for (const candidate of data.candidates) {
        if (candidate._already_saved) {
          seeded[candidate.id] = "saved";
        }
        if (candidate._candidate_id) {
          seededDbIds[candidate.id] = candidate._candidate_id;
        }
      }
      setSaveStates(seeded);
      setCandidateDbIds((prev) => ({ ...prev, ...seededDbIds }));
      setStage("fetched");
    } catch (error: any) {
      notify(error?.message || "Failed to fetch candidates", {
        type: "error",
      });
    } finally {
      setFetchLoading(false);
    }
  };

  // "Search wider": fetches the NEXT `size` records further down the SAME
  // search using PDL's scroll_token, and appends them to what's already on
  // screen -- never replaces or re-charges for candidates already fetched.
  const handleSearchWider = async () => {
    if (!selectedId || !scrollToken) return;
    setWideningLoading(true);
    try {
      const data = (await dataProvider.sourceCandidates(
        Number(selectedId),
        size,
        scrollToken,
      )) as SourceResult;
      setCandidates((prev) => sortByScore([...prev, ...data.candidates]));
      setScrollToken(data.scroll_token);
      setNotes(data.notes);
      const seeded: Record<string, SaveState> = {};
      const seededDbIds: Record<string, number> = {};
      for (const candidate of data.candidates) {
        if (candidate._already_saved) {
          seeded[candidate.id] = "saved";
        }
        if (candidate._candidate_id) {
          seededDbIds[candidate.id] = candidate._candidate_id;
        }
      }
      setSaveStates((prev) => ({ ...prev, ...seeded }));
      setCandidateDbIds((prev) => ({ ...prev, ...seededDbIds }));
    } catch (error: any) {
      notify(error?.message || "Failed to fetch more candidates", {
        type: "error",
      });
    } finally {
      setWideningLoading(false);
    }
  };

  const handleAddToPipeline = async (candidate: PdlCandidate) => {
    if (!selectedId) return;
    setSaveStates((prev) => ({ ...prev, [candidate.id]: "saving" }));
    try {
      const outcome = await dataProvider.saveSourcedCandidate(
        Number(selectedId),
        candidate,
      );
      setSaveStates((prev) => ({ ...prev, [candidate.id]: "saved" }));
      if (outcome.candidate_id) {
        setCandidateDbIds((prev) => ({
          ...prev,
          [candidate.id]: outcome.candidate_id,
        }));
      }
      notify(
        outcome.status === "created"
          ? "Added to pipeline"
          : "Already in your candidates -- linked to this role",
        { type: "success" },
      );
    } catch (error: any) {
      setSaveStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to add candidate", { type: "error" });
    }
  };

  // Unified free + low-cost search (2026-07-19): runs GitHub/Stack Exchange/
  // Hugging Face/Kaggle (source-candidates-free-portals, zero cost) and
  // Exa.ai (source-candidates-exa, paid but ~$0.015/search) TOGETHER in one
  // action -- Harsha's explicit call: Exa's per-search cost is negligible
  // enough not to gate behind a separate click, and the recruiter shouldn't
  // have to know or care which of these five sources a given candidate came
  // from. The two edge functions are still separate/independent (each can
  // fail without taking the other down, via Promise.allSettled), and their
  // results are merged/deduped HERE, client-side, via
  // mergeCandidatesAcrossSources -- see that file's header comment for why
  // this can't happen server-side (each edge function is an isolated Deno
  // module with no shared merge state). Independent of the Coresignal
  // "Preview matches" flow above -- can be run with or without it, and
  // Coresignal is NOT part of this merge: it stays a fully separate, higher-
  // cost, explicitly-triggered action further down, per Harsha's still-
  // undecided stance on that vendor. Reuses handleAddToPipeline/saveStates
  // below (save-sourced-candidate is already vendor-neutral, keyed off
  // _source_vendor).
  const handleSearchFreePortals = async () => {
    if (!selectedId) return;
    setFreePortalLoading(true);
    try {
      const [freePortalOutcome, exaOutcome] = await Promise.allSettled([
        dataProvider.sourceFreePortalCandidates(Number(selectedId), 10) as Promise<FreePortalResult>,
        dataProvider.sourceExaCandidates(Number(selectedId), 10) as Promise<ExaResult>,
      ]);

      const freePortalCandidatesRaw =
        freePortalOutcome.status === "fulfilled" ? freePortalOutcome.value.candidates ?? [] : [];
      const exaCandidatesRaw =
        exaOutcome.status === "fulfilled" ? exaOutcome.value.candidates ?? [] : [];

      const combinedNotes: string[] = [];
      if (freePortalOutcome.status === "fulfilled") {
        combinedNotes.push(...(freePortalOutcome.value.notes ?? []));
      } else {
        combinedNotes.push(
          `Free portals: search failed this time (non-fatal -- Exa results still shown if available). ${freePortalOutcome.reason?.message ?? ""}`,
        );
      }
      if (exaOutcome.status === "fulfilled") {
        combinedNotes.push(...(exaOutcome.value.notes ?? []));
      } else {
        combinedNotes.push(
          `Exa: search failed this time (non-fatal -- free portal results still shown if available). ${exaOutcome.reason?.message ?? ""}`,
        );
      }

      const { merged, mergedAwayCount } = mergeCandidatesAcrossSources<PdlCandidate>([
        freePortalCandidatesRaw,
        exaCandidatesRaw,
      ]);
      if (mergedAwayCount > 0) {
        combinedNotes.push(
          `${mergedAwayCount} candidate(s) appeared in more than one source and were merged into a single card -- matched by name only, so a shared common name could occasionally merge two different people.`,
        );
      }

      setFreePortalCandidates(merged);
      setFreePortalNotes(combinedNotes);
      setFreePortalSearched(true);
      const seededDbIds: Record<string, number> = {};
      merged.forEach((c) => {
        if (c._already_saved && c._candidate_id) {
          seededDbIds[c.id] = c._candidate_id;
        }
      });
      setCandidateDbIds((prev) => ({ ...prev, ...seededDbIds }));
    } catch (error: any) {
      notify(error?.message || "Failed to search free & low-cost portals", {
        type: "error",
      });
    } finally {
      setFreePortalLoading(false);
    }
  };

  // X-ray search (2026-07-22, Harsha's explicit call after seeing free-
  // portal noise on the Epiq role): "a cheap way to gut check before we hit
  // any paid vendors like CoreSignal/PDL/CrustData" -- runs Exa-backed
  // X-ray search (includeDomains scoped to linkedin.com, codechef.com,
  // hackerrank.com per portal) with multiple query variants per portal so a
  // real chunk of candidates surfaces, not just 1-2 hits; CodeChef/
  // HackerRank hits are cross-referenced against GitHub for free. Merges
  // the resulting sample into the SAME unified list as the free-portal
  // search above (same card rendering, same save-to-pipeline flow) via
  // mergeCandidatesAcrossSources, rather than a second, separate list.
  // Kept as a distinct button from "Search free & low-cost portals" mainly
  // so the recruiter can choose to run it independently and see its own
  // notes, even though its per-run cost (a handful of Exa calls, ~$0.015
  // each) is now small enough that this is more about clarity than gating
  // spend.
  const handleSearchXray = async () => {
    if (!selectedId) return;
    setXrayLoading(true);
    try {
      const result = (await dataProvider.sourceXrayCandidates(
        Number(selectedId),
      )) as FreePortalResult;
      const combinedNotes = [...freePortalNotes, ...(result.notes ?? [])];
      const { merged, mergedAwayCount } = mergeCandidatesAcrossSources<PdlCandidate>([
        freePortalCandidates,
        result.candidates ?? [],
      ]);
      if (mergedAwayCount > 0) {
        combinedNotes.push(
          `${mergedAwayCount} candidate(s) from X-ray matched someone already in this list and were merged -- matched by name only.`,
        );
      }
      setFreePortalCandidates(merged);
      setFreePortalNotes(combinedNotes);
      setFreePortalSearched(true);
      const seededDbIds: Record<string, number> = {};
      merged.forEach((c) => {
        if (c._already_saved && c._candidate_id) {
          seededDbIds[c.id] = c._candidate_id;
        }
      });
      setCandidateDbIds((prev) => ({ ...prev, ...seededDbIds }));
    } catch (error: any) {
      notify(error?.message || "Failed to run X-ray search", {
        type: "error",
      });
    } finally {
      setXrayLoading(false);
    }
  };

  // Agent H Stage 3, task #27: manual "Enrich contact" trigger -- only
  // reachable once a candidate has a real candidates.id (i.e. after "Add to
  // pipeline"). Calls the Hunter.io -> Apollo.io waterfall for that one
  // candidate and shows whatever it found inline; never runs for anyone who
  // hasn't been explicitly saved first.
  const handleEnrichContact = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId) return;
    setContactEnrichStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = (await dataProvider.enrichCandidateContact(
        candidateId,
      )) as ContactEnrichResult;
      setContactEnrichResults((prev) => ({ ...prev, [candidate.id]: result }));
      setContactEnrichStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      notify(
        result.status === "enriched"
          ? `Contact found via ${result.source}`
          : result.status === "not_found"
            ? "No contact info found"
            : "Contact enrichment failed -- see notes",
        { type: result.status === "enriched" ? "success" : "warning" },
      );
    } catch (error: any) {
      setContactEnrichStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to enrich contact", { type: "error" });
    }
  };

  // Agent H Stage 3, task #28 (checkpoint 3d): manual "Enrich dev signals"
  // trigger -- same "only after saved" gating as contact enrichment. Calls
  // the GitHub + Stack Overflow best-effort lookup for that one candidate.
  const handleEnrichDevSignals = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId) return;
    setDevSignalEnrichStates((prev) => ({
      ...prev,
      [candidate.id]: "loading",
    }));
    try {
      const result = (await dataProvider.enrichCandidateDevSignals(
        candidateId,
      )) as DevSignalEnrichResult;
      setDevSignalEnrichResults((prev) => ({
        ...prev,
        [candidate.id]: result,
      }));
      setDevSignalEnrichStates((prev) => ({
        ...prev,
        [candidate.id]: "done",
      }));
      notify(
        result.status === "enriched"
          ? "Dev signal(s) found"
          : result.status === "not_found"
            ? "No confident dev-signal match found"
            : "Dev-signal enrichment failed -- see notes",
        { type: result.status === "enriched" ? "success" : "warning" },
      );
    } catch (error: any) {
      setDevSignalEnrichStates((prev) => ({
        ...prev,
        [candidate.id]: "idle",
      }));
      notify(error?.message || "Failed to enrich dev signals", {
        type: "error",
      });
    }
  };

  // Agent H Stage 3, task #75: manual "View full profile" trigger -- same
  // "only reachable after Add to pipeline" gating as the other two
  // enrichments. First click actually calls the vendor (Coresignal Collect,
  // PDL Enrich fallback) and reads the result straight back from the DB;
  // every click after that just re-reads what's already stored (free,
  // no re-spend) and toggles the panel open/closed -- re-fetching only
  // happens if the recruiter explicitly asks by re-running the enrichment
  // (not built as a separate button here, same as contact/dev-signal
  // enrichment's "re-run" pattern).
  const handleViewFullProfile = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId) return;

    const alreadyHaveData = fullProfileData[candidate.id];
    if (alreadyHaveData) {
      setFullProfileExpanded((prev) => ({
        ...prev,
        [candidate.id]: !prev[candidate.id],
      }));
      return;
    }

    setFullProfileStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const enrichResult = (await dataProvider.enrichCandidateWorkHistory(
        candidateId,
      )) as FullProfileEnrichResult;
      const profile = (await dataProvider.getCandidateFullProfile(
        candidateId,
      )) as FullProfileData;
      setFullProfileData((prev) => ({ ...prev, [candidate.id]: profile }));
      setFullProfileStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      setFullProfileExpanded((prev) => ({ ...prev, [candidate.id]: true }));
      notify(
        enrichResult.status === "enriched"
          ? `Full profile loaded via ${enrichResult.source} (${enrichResult.experience_count} jobs, ${enrichResult.education_count} education)`
          : enrichResult.status === "not_found"
            ? "No full profile found for this candidate"
            : "Full profile lookup failed -- see notes",
        { type: enrichResult.status === "enriched" ? "success" : "warning" },
      );
    } catch (error: any) {
      setFullProfileStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to load full profile", {
        type: "error",
      });
    }
  };

  // Agent H Stage 4: manual "Score candidate" trigger -- scores this
  // candidate against the CURRENTLY SELECTED role brief (deal). Same
  // "only reachable after Add to pipeline" gating as every other
  // enrichment button on this screen.
  const handleScoreCandidate = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId || !selectedId) return;
    setScoreStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = (await dataProvider.scoreCandidate(
        candidateId,
        Number(selectedId),
      )) as ScoreResult;
      setScoreResults((prev) => ({ ...prev, [candidate.id]: result }));
      setScoreStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      notify(
        `${result.verdict} (${result.overall_score}/100) -- recommended: ${ACTION_LABELS[result.recommended_action]}`,
        {
          type:
            result.recommended_action === "reject" ? "warning" : "success",
        },
      );
    } catch (error: any) {
      setScoreStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to score candidate", {
        type: "error",
      });
    }
  };

  // Agent H Stage 3: manual "Assess fit" trigger -- the holistic,
  // non-numeric read against the CURRENTLY SELECTED role brief. Same
  // "only reachable after Add to pipeline" gating as every other button
  // here, and side by side with handleScoreCandidate rather than
  // replacing it (Harsha's explicit call).
  const handleAssessFit = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId || !selectedId) return;
    setFitStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = (await dataProvider.assessCandidateFit(
        candidateId,
        Number(selectedId),
      )) as FitAssessmentResult;
      setFitResults((prev) => ({ ...prev, [candidate.id]: result }));
      setFitStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      notify(FIT_BUCKET_LABELS[result.fit_bucket], {
        type: result.fit_bucket === "not_a_fit" ? "warning" : "success",
      });
    } catch (error: any) {
      setFitStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to assess candidate fit", {
        type: "error",
      });
    }
  };

  // Agent H Stage 5: Scheduling -- generates (or fetches, if the candidate
  // already has a live booking) a self-service Cal.com booking link for
  // this candidate against the selected role brief.
  const handleCreateBookingLink = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId || !selectedId) return;
    setInterviewStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = (await dataProvider.createBookingLink(
        candidateId,
        Number(selectedId),
      )) as InterviewResult;
      setInterviewResults((prev) => ({ ...prev, [candidate.id]: result }));
      setInterviewStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      notify(
        result.already_booked
          ? INTERVIEW_STATUS_LABELS[result.status]
          : result.email_sent
            ? "Booking link created and emailed to the candidate"
            : "Booking link created -- share it with the candidate manually",
        { type: "success" },
      );
    } catch (error: any) {
      setInterviewStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to create booking link", {
        type: "error",
      });
    }
  };

  // Agent H, task 76: sends the one-off "please send your resume" email.
  const handleRequestResume = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId || !selectedId) return;
    setResumeStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = await dataProvider.requestCandidateResume(
        candidateId,
        Number(selectedId),
      );
      setResumeStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      notify(
        result.resume_status === "received"
          ? "Already have a resume on file -- sent another request anyway"
          : "Resume request sent",
        { type: "success" },
      );
      // Reflect the send immediately without waiting for a "Check for
      // resume" click -- the reply itself may take a while, but the
      // "requested" state should show right away.
      const current = resumeInfos[candidate.id];
      setResumeInfos((prev) => ({
        ...prev,
        [candidate.id]: {
          resume_status: result.resume_status,
          resume_original_filename: current?.resume_original_filename ?? null,
          resume_received_at: current?.resume_received_at ?? null,
          resume_reply_text: current?.resume_reply_text ?? null,
        },
      }));
    } catch (error: any) {
      setResumeStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to request resume", { type: "error" });
    }
  };

  // Agent H, task 76: re-reads resume_status from public.candidates -- a
  // reply only exists once the candidate actually checks their email.
  const handleCheckForResume = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId) return;
    setResumeStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const info = (await dataProvider.getCandidateResumeInfo(
        candidateId,
      )) as ResumeInfo;
      setResumeInfos((prev) => ({ ...prev, [candidate.id]: info }));
      setResumeStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      notify(RESUME_STATUS_LABELS[info.resume_status], {
        type: info.resume_status === "received" ? "success" : "info",
      });
    } catch (error: any) {
      setResumeStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to check resume status", {
        type: "error",
      });
    }
  };

  // Agent H Stage 6: opens (or closes) the inline offer-compose form for one
  // candidate, seeding a blank draft the first time it's opened.
  const handleToggleOfferForm = (candidate: PdlCandidate) => {
    setOfferFormOpen((prev) => ({ ...prev, [candidate.id]: !prev[candidate.id] }));
    setOfferDrafts((prev) => ({
      ...prev,
      [candidate.id]: prev[candidate.id] ?? { ...EMPTY_OFFER_DRAFT },
    }));
  };

  const handleOfferDraftChange = (
    candidateKey: string,
    field: keyof OfferDraft,
    value: string,
  ) => {
    setOfferDrafts((prev) => ({
      ...prev,
      [candidateKey]: { ...(prev[candidateKey] ?? EMPTY_OFFER_DRAFT), [field]: value },
    }));
  };

  // Agent H Stage 6: composes + sends the offer email in one step (no
  // separate "save draft" in v1 -- see send-offer/index.ts header comment).
  const handleSendOffer = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    const draft = offerDrafts[candidate.id];
    if (!candidateId || !selectedId || !draft) return;
    setOfferStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = await dataProvider.sendOffer(candidateId, Number(selectedId), {
        position_title: draft.position_title,
        compensation_amount: draft.compensation_amount
          ? Number(draft.compensation_amount)
          : null,
        compensation_currency: draft.compensation_currency,
        compensation_frequency: draft.compensation_frequency,
        start_date: draft.start_date || null,
        expiry_date: draft.expiry_date || null,
        benefits_summary: draft.benefits_summary || null,
      });
      setOfferInfos((prev) => ({ ...prev, [candidate.id]: result.offer as OfferInfo }));
      setOfferStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      setOfferFormOpen((prev) => ({ ...prev, [candidate.id]: false }));
      notify("Offer sent", { type: "success" });
    } catch (error: any) {
      setOfferStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to send offer", { type: "error" });
    }
  };

  // Re-reads offers straight from the table -- a reply only exists once the
  // candidate actually checks their email and responds, same rhythm as
  // handleCheckForResume.
  const handleCheckOffer = async (candidate: PdlCandidate) => {
    const candidateId = candidateDbIds[candidate.id];
    if (!candidateId || !selectedId) return;
    setOfferStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const info = (await dataProvider.getCandidateOffer(
        candidateId,
        Number(selectedId),
      )) as OfferInfo | null;
      if (info) {
        setOfferInfos((prev) => ({ ...prev, [candidate.id]: info }));
        notify(OFFER_STATUS_LABELS[info.status], {
          type: info.status === "accepted" ? "success" : "info",
        });
      }
      setOfferStates((prev) => ({ ...prev, [candidate.id]: "done" }));
    } catch (error: any) {
      setOfferStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      notify(error?.message || "Failed to check offer status", {
        type: "error",
      });
    }
  };

  // Agent H Stage 6: a recruiter's manual call after reading response_text --
  // this is the only path that ever sets accepted/declined/negotiating (see
  // the offers table migration comment). Never inferred automatically.
  const handleMarkOfferStatus = async (
    candidate: PdlCandidate,
    status: "accepted" | "declined" | "negotiating",
  ) => {
    const info = offerInfos[candidate.id];
    if (!info) return;
    try {
      await dataProvider.updateOfferStatus(info.id, status);
      setOfferInfos((prev) => ({
        ...prev,
        [candidate.id]: { ...info, status },
      }));
      notify(OFFER_STATUS_LABELS[status], { type: "success" });
    } catch (error: any) {
      notify(error?.message || "Failed to update offer status", {
        type: "error",
      });
    }
  };

  // Calibration: pulls just the top 3 Voyage-ranked candidates via the same
  // sourceCandidates call the real fetch uses (size=3, not a preview) --
  // this naturally advances the shared scroll position, so a later "Fetch
  // candidates" continues past these 3 instead of re-showing them.
  // Taxonomy/boolean-logic test addition: an optional forced vendor name
  // ("apollo" | "coresignal"), passed straight through to sourceCandidates.
  // Lets the exact same role brief be calibrated against ONE specific
  // vendor on demand -- see the "Test with Apollo" / "Test with Coresignal"
  // buttons below -- for a real side-by-side comparison now that PDL is
  // disabled, rather than only ever seeing whichever vendor the normal
  // priority-fallback order happens to pick.
  const handleStartCalibration = async (provider?: string) => {
    if (!selectedId) return;
    setCalibrationLoading(true);
    try {
      const data = (await dataProvider.sourceCandidates(
        Number(selectedId),
        3,
        null,
        false,
        provider,
      )) as SourceResult;
      setCalibrationCandidates(sortByScore(data.candidates));
      setCalibrationStarted(true);
      setNotes(data.notes);
      setTotal(data.total);
    } catch (error: any) {
      notify(error?.message || "Failed to pull candidates to calibrate on", {
        type: "error",
      });
    } finally {
      setCalibrationLoading(false);
    }
  };

  const handleSubmitCalibrationJudgment = async (
    candidate: PdlCandidate,
    fit: boolean,
  ) => {
    const reason = (calibrationReasons[candidate.id] ?? "").trim();
    if (!reason) {
      notify("A reason is required before submitting", { type: "warning" });
      return;
    }
    setCalibrationEntryStates((prev) => ({
      ...prev,
      [candidate.id]: "submitting",
    }));
    try {
      await dataProvider.submitCalibrationFeedback(
        Number(selectedId),
        candidate.id,
        fit,
        reason,
        {
          full_name: candidate.full_name,
          job_title: candidate.job_title,
          job_company_name: candidate.job_company_name,
          location_name: candidate.location_name,
          linkedin_url: candidate.linkedin_url,
          skills: candidate.skills,
          _match_score: candidate._match_score,
        },
      );
      setCalibrationEntryStates((prev) => ({
        ...prev,
        [candidate.id]: "submitted",
      }));
      notify(fit ? "Marked as a fit" : "Marked as not a fit", {
        type: "success",
      });

      // Real calibration loop: a "not a fit" reason is the signal worth
      // turning into a real search criterion (Noon's "Contextualizing..."
      // step) -- a "fit" judgment is just positive confirmation, nothing to
      // tighten. Fired automatically, not gated on another click, so the
      // recruiter sees the blast-radius preview right away while the
      // reasoning is fresh.
      if (!fit) {
        void handleContextualize(candidate, reason);
      }
    } catch (error: any) {
      setCalibrationEntryStates((prev) => ({
        ...prev,
        [candidate.id]: "idle",
      }));
      notify(error?.message || "Failed to save judgment", { type: "error" });
    }
  };

  // Real calibration loop: turns a "not a fit" reason into a structured
  // criterion suggestion + blast-radius preview (edge function's
  // calibration_contextualize mode). Never persists anything by itself --
  // see handleApplyCriterion for the recruiter-confirmed commit step.
  const handleContextualize = async (candidate: PdlCandidate, reason: string) => {
    setContextualizeStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = await dataProvider.contextualizeCalibrationFeedback(
        Number(selectedId),
        reason,
        candidate._match_evidence,
      );
      setContextualizeResults((prev) => ({ ...prev, [candidate.id]: result }));
    } catch (error: any) {
      notify(
        error?.message || "Failed to check whether this reason implies a search criterion",
        { type: "error" },
      );
    } finally {
      setContextualizeStates((prev) => ({ ...prev, [candidate.id]: "done" }));
    }
  };

  // Real calibration loop: the recruiter has reviewed the blast-radius
  // preview and decided to commit the suggested criterion. Persists it
  // (role_brief_learned_criteria), then refreshes the Control Panel so its
  // live reject counts reflect the newly-applied rule right away.
  const handleApplyCriterion = async (candidateId: string) => {
    const result = contextualizeResults[candidateId];
    if (!result?.criterion) return;
    setApplyStates((prev) => ({ ...prev, [candidateId]: "applying" }));
    try {
      await dataProvider.applyLearnedCriterion(
        Number(selectedId),
        result.criterion,
      );
      setApplyStates((prev) => ({ ...prev, [candidateId]: "applied" }));
      notify("Criterion applied to future searches for this role", {
        type: "success",
      });
      void handleRefreshCriteriaImpact();
    } catch (error: any) {
      setApplyStates((prev) => ({ ...prev, [candidateId]: "idle" }));
      notify(error?.message || "Failed to apply criterion", { type: "error" });
    }
  };

  // Real calibration loop: Control Panel refresh -- current total plus a
  // live "N rejected" count per learned criterion.
  //
  // Credit-burn fix (2026-07-22): this call was NOT "a handful of cheap
  // Coresignal preview calls" as originally believed -- the edge function's
  // criteria_impact mode fanned out ONE live Coresignal search per learned
  // criterion (active or relaxed) via Promise.all, with no cap and no
  // caching. A role brief with 15-20 accumulated criteria burned 15-21
  // credits on a SINGLE click of this button, and it auto-fired again after
  // every Apply/Relax/Reapply -- this is what burned through the account's
  // Coresignal credit balance (a second time), and was hard-disabled
  // client-side to stop further spend while the real fix landed. That fix
  // is now deployed server-side in source-candidates-discovery (version 52,
  // verified 2026-07-22): the criteria_impact mode now prices at most
  // CRITERIA_IMPACT_PRICING_CAP (6) criteria live per request and reuses
  // last_reject_count when it was computed within CRITERIA_IMPACT_CACHE_TTL_MS
  // (1 hour) instead of always recomputing -- so this button is safe to
  // re-enable. Also note: this is now the ONLY place criteria impact is
  // fetched at all (auto-fetch was permanently removed from useInboxDecisions
  // and CanvasPage per a separate product decision to keep this strictly
  // on-demand, recruiter-triggered data, never a page-load side effect).
  const CRITERIA_IMPACT_DISABLED = false;
  const handleRefreshCriteriaImpact = async () => {
    if (!selectedId) return;
    if (CRITERIA_IMPACT_DISABLED) {
      notify(
        "Control panel refresh is temporarily disabled -- it was burning Coresignal credits (one live search per learned criterion, uncapped). Re-enabling once the cost cap is deployed.",
        { type: "warning" },
      );
      return;
    }
    setCriteriaImpactLoading(true);
    try {
      const result = await dataProvider.getRoleBriefCriteriaImpact(
        Number(selectedId),
      );
      setCriteriaImpact(result);
    } catch (error: any) {
      notify(error?.message || "Failed to load the control panel", {
        type: "error",
      });
    } finally {
      setCriteriaImpactLoading(false);
    }
  };

  // Real calibration loop: Noon's "Relax" -- turns a criterion off without
  // deleting it, then refreshes the Control Panel so the pool-size change
  // is visible immediately.
  const handleRelaxCriterion = async (criterionId: number) => {
    setCriteriaActionStates((prev) => ({ ...prev, [criterionId]: "working" }));
    try {
      await dataProvider.relaxLearnedCriterion(criterionId);
      await handleRefreshCriteriaImpact();
    } catch (error: any) {
      notify(error?.message || "Failed to relax criterion", { type: "error" });
    } finally {
      setCriteriaActionStates((prev) => ({ ...prev, [criterionId]: "idle" }));
    }
  };

  // Real calibration loop: the reverse of Relax -- turns a previously-
  // relaxed criterion back on.
  const handleReapplyCriterion = async (criterionId: number) => {
    setCriteriaActionStates((prev) => ({ ...prev, [criterionId]: "working" }));
    try {
      await dataProvider.reapplyLearnedCriterion(criterionId);
      await handleRefreshCriteriaImpact();
    } catch (error: any) {
      notify(error?.message || "Failed to reapply criterion", { type: "error" });
    } finally {
      setCriteriaActionStates((prev) => ({ ...prev, [criterionId]: "idle" }));
    }
  };

  const canSearchWider = Boolean(scrollToken) && candidates.length < total;

  return (
    <div
      className={
        embedded
          ? "flex flex-col gap-6"
          : "flex flex-col gap-6 max-w-3xl mx-auto p-6"
      }
    >
      {!embedded && (
        <div>
          <h1 className="text-2xl font-semibold">Source Candidates</h1>
          <p className="text-muted-foreground text-sm">
            Pick a role brief and preview how many people match before
            pulling any real candidate records -- previewing costs almost
            nothing. Results are sorted by match score (best first), but
            nothing is ever hidden -- every candidate returned stays visible
            and reviewable. Click "Add to pipeline" on anyone worth
            tracking; nothing is saved just for showing up in a search
            result.
          </p>
        </div>
      )}

      {/* Task #29 (2026-07-22): this used to be a small "or search without a
          JD" fallback link, with the real JD-paste-and-review flow living on
          a separate /jd-intake route+nav tab. Same textarea and same
          dataProvider.parseJobDescription call handles a one-line
          description OR a full pasted JD equally well -- the only thing
          actually separating the two pages was framing and navigation, not
          capability. This promotes that entry point to a first-class,
          equally-weighted way to start (alongside picking an existing role
          brief below), so creating a role brief and searching for it live on
          the same canvas instead of two routes a recruiter had to bounce
          between. JdIntakePage/its nav tab are retired in favor of this. */}
      {!embedded && (
        <div className="flex flex-col gap-2 border rounded-lg p-4">
          <Label htmlFor="nl-search">
            Paste a job description, or describe the role in your own words
          </Label>
          <textarea
            id="nl-search"
            className="border rounded-md p-2 text-sm min-h-24"
            value={nlText}
            onChange={(e) => setNlText(e.target.value)}
            placeholder="Paste the full JD here, or just: Python developer in Bengaluru with 5-8 years, currently at a startup or product company, strong in FastAPI, AWS and Docker"
          />
          <div>
            <Button onClick={handleNlSearch} disabled={nlParsing}>
              {nlParsing ? "Parsing..." : "Create role brief & search"}
            </Button>
          </div>
        </div>
      )}

      {!embedded && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="role-brief">Or pick an existing role brief</Label>
          <select
            id="role-brief"
            className="border border-input bg-background text-foreground rounded-md h-9 px-2"
            value={selectedId}
            onChange={(e) => handleRoleBriefChange(e.target.value)}
          >
            <option value="">Select a role brief...</option>
            {roleBriefs.map((rb) => (
              <option key={rb.id} value={rb.id}>
                {rb.name} (#{rb.id})
              </option>
            ))}
          </select>
        </div>
      )}

      {roleBriefDetail && (
        <div className="flex flex-col gap-1.5 border rounded-lg p-4 bg-muted/30">
          <h3 className="text-sm font-medium">Searching for:</h3>
          <ul className="text-sm list-disc pl-4 flex flex-col gap-0.5">
            <li>
              {roleBriefDetail.name ?? "(untitled role)"}
              {roleBriefDetail.seniority ? ` · ${roleBriefDetail.seniority}` : ""}
            </li>
            {roleBriefDetail.location && <li>{roleBriefDetail.location}</li>}
            {(roleBriefDetail.years_experience_min ||
              roleBriefDetail.years_experience_max) && (
              <li>
                {roleBriefDetail.years_experience_min ?? "0"}
                {roleBriefDetail.years_experience_max
                  ? `–${roleBriefDetail.years_experience_max}`
                  : "+"}{" "}
                years experience
              </li>
            )}
            {roleBriefDetail.industry && (
              <li>Industry (preferred): {roleBriefDetail.industry}</li>
            )}
            {roleBriefDetail.must_have_keywords &&
              roleBriefDetail.must_have_keywords.length > 0 && (
                <li>
                  Must have: {roleBriefDetail.must_have_keywords.join(", ")}
                </li>
              )}
            {roleBriefDetail.required_skills &&
              roleBriefDetail.required_skills.length > 0 && (
                <li>Skills: {roleBriefDetail.required_skills.join(", ")}</li>
              )}
            {roleBriefDetail.nice_to_have_keywords &&
              roleBriefDetail.nice_to_have_keywords.length > 0 && (
                <li>
                  Nice to have:{" "}
                  {roleBriefDetail.nice_to_have_keywords.join(", ")}
                </li>
              )}
            {(roleBriefDetail.company_type ||
              roleBriefDetail.company_size_min ||
              roleBriefDetail.company_size_max) && (
              <li>
                Companies (preferred):{" "}
                {[
                  roleBriefDetail.company_type,
                  roleBriefDetail.company_size_min || roleBriefDetail.company_size_max
                    ? `${roleBriefDetail.company_size_min ?? "any"}-${roleBriefDetail.company_size_max ?? "any"} employees`
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </li>
            )}
            {roleBriefDetail.excluded_companies &&
              roleBriefDetail.excluded_companies.length > 0 && (
                <li>
                  Excluding companies:{" "}
                  {roleBriefDetail.excluded_companies.join(", ")}
                </li>
              )}
            {roleBriefDetail.exclusion_keywords &&
              roleBriefDetail.exclusion_keywords.length > 0 && (
                <li>
                  Excluding: {roleBriefDetail.exclusion_keywords.join(", ")}
                </li>
              )}
          </ul>

          {/* Task #43: proactive clarifying-questions advisory, surfaced
              wherever this role brief is viewed for sourcing -- not just at
              intake -- until explicitly dismissed. */}
          {roleBriefDetail.clarifying_questions &&
            roleBriefDetail.clarifying_questions.length > 0 &&
            !roleBriefDetail.clarifying_questions_dismissed && (
              <div className="flex flex-col gap-2 mt-1 rounded-md border border-amber-200 bg-amber-50 p-3">
                <h4 className="text-xs font-medium text-amber-900">
                  Worth confirming before sourcing further
                </h4>
                <ul className="list-disc pl-5 text-xs text-amber-900">
                  {roleBriefDetail.clarifying_questions.map((question, i) => (
                    <li key={i}>{question}</li>
                  ))}
                </ul>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleDismissClarifyingQuestions}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            )}

          {/* Ranked preferences (2026-07-22): rendered as distinct tier
              groups, not folded into the flat "Must have" line above --
              this is the actual fix for the JD that previously collapsed
              a whole primary-vs-fallback paragraph into one run-on
              sentence. Only present when the JD genuinely described a
              tiered profile (see parse-job-description's header comment). */}
          {roleBriefDetail.preference_tiers &&
            roleBriefDetail.preference_tiers.length > 0 && (
              <div className="flex flex-col gap-1.5 mt-1 border-t pt-1.5">
                {[...roleBriefDetail.preference_tiers]
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

      {/* Real calibration loop: Control Panel -- every criterion learned
          from calibration feedback for this role, with a live "N rejected"
          count and a Relax/Reapply toggle (Noon's Control Panel pattern).
          Loaded on demand since computing it spends a few cheap Coresignal
          preview calls -- not shown until the recruiter asks for it. */}
      {selectedId && (
        <div className="flex flex-col gap-2 border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Control panel</h3>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRefreshCriteriaImpact}
              disabled={criteriaImpactLoading || CRITERIA_IMPACT_DISABLED}
            >
              {CRITERIA_IMPACT_DISABLED
                ? "Temporarily disabled"
                : criteriaImpactLoading
                ? "Computing..."
                : criteriaImpact
                ? "Refresh"
                : "Load"}
            </Button>
          </div>
          {CRITERIA_IMPACT_DISABLED && (
            <p className="text-xs text-amber-700">
              Temporarily disabled to stop unbounded Coresignal spend (one
              live search per learned criterion, every refresh). Being
              fixed server-side.
            </p>
          )}
          {!CRITERIA_IMPACT_DISABLED && !criteriaImpact && !criteriaImpactLoading && (
            <p className="text-xs text-muted-foreground">
              Shows every criterion learned from calibration feedback for
              this role, with how many candidates each one is currently
              excluding -- and lets you undo any single one.
            </p>
          )}
          {criteriaImpact && (
            <>
              <p className="text-xs text-muted-foreground">
                {criteriaImpact.base_total ?? "?"} candidates currently match
                this role brief's full search (JD fields + active learned
                criteria).
              </p>
              {criteriaImpact.criteria.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No criteria learned from calibration feedback yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {criteriaImpact.criteria.map((c) => {
                    const actionState = criteriaActionStates[c.id] ?? "idle";
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
                              ? handleRelaxCriterion(c.id)
                              : handleReapplyCriterion(c.id)
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
              )}
            </>
          )}
        </div>
      )}

      <div>
        <Button onClick={handlePreview} disabled={previewLoading || !selectedId}>
          {previewLoading ? "Searching..." : "Preview matches"}
        </Button>
      </div>

      {/* Free-portal sourcing (2026-07-19): GitHub/Stack Overflow via their
          own free official APIs -- a separate path from Coresignal, tried
          before any paid-vendor payment plan decision. Calibration feedback
          narrows this too (require/exclude keyword only -- see the edge
          function's notes for what couldn't be applied and why).
          Hugging Face/Kaggle DROPPED from this default search (2026-07-22,
          Harsha's explicit call after the Epiq run): both portals have no
          real user-search endpoint, so they're proxied via kernel/model
          AUTHORS matching a keyword -- a strong signal for a Data
          Scientist/ML Engineer role, pure noise for most others (the Epiq
          run matched Kaggle notebook titles containing the substring "C#"
          against unrelated numeric-computing kernels). Kept in the edge
          function, unused by default -- worth turning back on per-role for
          ML-heavy searches, or as an on-demand lookup when a candidate's
          own resume already links to a Kaggle/HF profile (not built yet). */}
      {selectedId && (
        <div className="flex flex-col gap-3 border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">
                Free & low-cost search (GitHub, Stack Exchange, Exa)
              </h3>
              <p className="text-xs text-muted-foreground">
                GitHub/Stack Exchange are official free APIs -- no
                scraping, no vendor bill. Exa is a paid, general public-web
                people-search API (roughly $0.015 per search) run alongside
                them since its cost is negligible -- results from all three
                are merged into one list below, with duplicates combined.
                Hugging Face/Kaggle are excluded here by design (noisy for
                non-ML roles -- see notes below after a search). Try this
                before Coresignal, which costs real money per candidate
                record. Learned criteria from calibration feedback narrow
                these results too, where they can honestly apply.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSearchFreePortals}
              disabled={freePortalLoading}
            >
              {freePortalLoading
                ? "Searching..."
                : freePortalSearched
                ? "Search again"
                : "Search free & low-cost portals"}
            </Button>
          </div>

          {/* X-ray search (2026-07-22, ladder rewrite same day per Harsha's
              correction -- "I didn't mean multiple platforms, I meant
              multiple boolean strings... narrow to broad"): runs a small
              narrow-to-broad query ladder against LinkedIn, CodeChef, and
              HackerRank via Exa's includeDomains parameter -- exact title
              first, then a title synonym, then the candidate's state name,
              then nearby relocation-candidate metros, then a skill-only
              wide net (see source-candidates-xray's buildQueryLadder for
              the full rung list). Anything surfaced by a broadened rung
              shows an evidence note on its card explaining exactly what was
              relaxed to find it. CodeChef/HackerRank hits are cross-
              referenced against GitHub for free. Meant as a cheap gut-check
              on what's in the market before deciding whether to pay for
              Coresignal/PDL/CrustData. */}
          <div className="flex items-center justify-between border-t pt-3">
            <div>
              <h4 className="text-xs font-medium">
                X-ray search (LinkedIn, CodeChef, HackerRank)
              </h4>
              <p className="text-xs text-muted-foreground">
                Runs a narrow-to-broad query ladder per site via Exa
                (restricted to linkedin.com / codechef.com /
                hackerrank.com): exact title/location first, then a title
                synonym, then the candidate's state name, then nearby
                relocation-candidate metros, then a skill-only wide net --
                roughly $0.015 per query, a few cents per run. Cards from a
                broadened rung show why they surfaced. CodeChef/HackerRank
                hits are cross-referenced with GitHub for free. Results
                merge into the list below.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSearchXray}
              disabled={xrayLoading}
            >
              {xrayLoading ? "Searching..." : "Run X-ray search"}
            </Button>
          </div>

          {freePortalNotes.length > 0 && (
            <ul className="text-muted-foreground text-xs list-disc pl-4">
              {freePortalNotes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          )}

          {freePortalSearched && freePortalCandidates.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No candidates found across these portals for this role brief.
            </p>
          )}

          {freePortalCandidates.length > 0 && (
            <ul className="flex flex-col gap-2">
              {freePortalCandidates.map((candidate) => {
                const saveState = saveStates[candidate.id] ?? "idle";
                // Evidence-based fit assessment (2026-07-19): assess-
                // candidate-fit is already fully vendor-neutral -- it reads
                // straight from the saved `candidates` row (name,
                // current_title, and full_profile_raw/work_history IF a
                // Coresignal-style full-profile enrichment ran) plus the
                // role brief, never anything Coresignal-specific. Free-
                // portal/Exa candidates simply fall into its existing
                // "plain_fields" path (current_title only, no full-profile
                // enrichment available for these sources) -- the same
                // amber "Limited discovery fields only" disclosure
                // FitAssessmentPanel already shows for thin Coresignal
                // profiles applies here too, honestly, rather than
                // pretending these reads are as deep as an enriched one.
                const candidateId = candidateDbIds[candidate.id];
                const fitState = fitStates[candidate.id] ?? "idle";
                const fitResult = fitResults[candidate.id];
                // Pipeline action cluster (2026-07-19): closing the gap
                // where Score/Enrich contact/Enrich dev signals/Schedule/
                // Request resume/Send offer only ever rendered on
                // Coresignal-sourced cards -- an accidental UI omission,
                // not a real vendor limitation, since every one of these
                // edge functions already keys off candidateId + dealId and
                // never touches anything Coresignal-specific (unlike "View
                // full profile", which genuinely is PDL/Coresignal-only and
                // stays hidden here via showFullProfile={false}). Same
                // shared per-candidate state maps as the Coresignal list.
                const contactState = contactEnrichStates[candidate.id] ?? "idle";
                const contactResult = contactEnrichResults[candidate.id];
                const devSignalState = devSignalEnrichStates[candidate.id] ?? "idle";
                const devSignalResult = devSignalEnrichResults[candidate.id];
                const scoreState = scoreStates[candidate.id] ?? "idle";
                const scoreResult = scoreResults[candidate.id];
                const interviewState = interviewStates[candidate.id] ?? "idle";
                const interviewResult = interviewResults[candidate.id];
                const resumeState = resumeStates[candidate.id] ?? "idle";
                const resumeInfo = resumeInfos[candidate.id];
                const offerState = offerStates[candidate.id] ?? "idle";
                const offerInfo = offerInfos[candidate.id];
                const offerFormIsOpen = Boolean(offerFormOpen[candidate.id]);
                const offerDraft = offerDrafts[candidate.id] ?? EMPTY_OFFER_DRAFT;
                // Blast-radius calibration feedback (2026-07-19): the same
                // reason -> contextualize -> blast-radius-preview -> Apply
                // flow the dedicated Coresignal calibration ritual already
                // has, extended here so "not a fit" feedback on a free-
                // portal/Exa result also tightens future searches -- not
                // gated on candidateId (unlike Assess fit above), since
                // submitCalibrationFeedback only needs a source id + plain-
                // field snapshot, not a saved candidates row. A recruiter
                // can give this feedback on any browsed result, saved or
                // not, matching Noon's "reject right from the feed" pattern.
                const calibEntryState =
                  calibrationEntryStates[candidate.id] ?? "idle";
                const calibSubmitted = calibEntryState === "submitted";
                return (
                  <li
                    key={candidate.id}
                    className="flex flex-col gap-3 border rounded-md p-3 text-sm"
                  >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">
                          {candidate.full_name ?? candidate.id}
                        </span>
                        <span className="text-xs uppercase text-muted-foreground border rounded px-1">
                          {candidate._source_vendor}
                        </span>
                        {/* Merge disclosure (2026-07-19): this card
                            represents more than one raw search hit, merged
                            by name match -- see mergeCandidates.ts. Shown as
                            extra source tags, not hidden, since the merge is
                            a heuristic (name-only) that could occasionally
                            be wrong. */}
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
                        {/* Location disclosure (2026-07-19): flagged directly
                            after a saved Kaggle candidate turned out not to
                            be India-based -- Hugging Face and Kaggle expose
                            no location field at all, and Exa's location is
                            only a heuristic regex parse of bio text, so
                            unlike GitHub/Stack Exchange these three are never
                            reliably location-filtered. A per-card badge, not
                            just a note in the list above, since that's
                            exactly what got missed the first time. */}
                        {(candidate._source_vendor === "huggingface" ||
                          candidate._source_vendor === "kaggle" ||
                          candidate._source_vendor === "exa") &&
                          roleBriefDetail?.location &&
                          !/remote/i.test(roleBriefDetail.location) && (
                            <span className="text-xs text-amber-600 dark:text-amber-400 border border-amber-600 dark:border-amber-400 rounded px-1">
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
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
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

                  {/* Full action cluster only becomes reachable once this
                      candidate has a real candidates.id -- same "an
                      unreviewed hit isn't a candidate someone decided to
                      track" gating "Add to pipeline" itself already follows
                      everywhere else on this page. showFullProfile={false}
                      because "View full profile" calls Coresignal's Collect
                      API / PDL's Enrich API, which has no equivalent for
                      free-portal/Exa candidates. */}
                  {candidateId && (
                    <CandidateActionsPanel
                      candidate={candidate}
                      showFullProfile={false}
                      contactState={contactState}
                      contactResult={contactResult}
                      onEnrichContact={() => handleEnrichContact(candidate)}
                      devSignalState={devSignalState}
                      devSignalResult={devSignalResult}
                      onEnrichDevSignals={() => handleEnrichDevSignals(candidate)}
                      fullProfileState="idle"
                      fullProfile={undefined}
                      fullProfileIsOpen={false}
                      onViewFullProfile={() => {}}
                      scoreState={scoreState}
                      scoreResult={scoreResult}
                      onScoreCandidate={() => handleScoreCandidate(candidate)}
                      fitState={fitState}
                      fitResult={fitResult}
                      onAssessFit={() => handleAssessFit(candidate)}
                      interviewState={interviewState}
                      interviewResult={interviewResult}
                      onCreateBookingLink={() => handleCreateBookingLink(candidate)}
                      resumeState={resumeState}
                      resumeInfo={resumeInfo}
                      onRequestResume={() => handleRequestResume(candidate)}
                      onCheckForResume={() => handleCheckForResume(candidate)}
                      offerState={offerState}
                      offerInfo={offerInfo}
                      offerFormIsOpen={offerFormIsOpen}
                      offerDraft={offerDraft}
                      onToggleOfferForm={() => handleToggleOfferForm(candidate)}
                      onOfferDraftChange={(field, value) =>
                        handleOfferDraftChange(String(candidate.id), field, value)
                      }
                      onSendOffer={() => handleSendOffer(candidate)}
                      onCheckOffer={() => handleCheckOffer(candidate)}
                      onMarkOfferStatus={(status) =>
                        handleMarkOfferStatus(candidate, status)
                      }
                    />
                  )}

                  <CalibrationFeedbackWidget
                    reason={calibrationReasons[candidate.id] ?? ""}
                    onReasonChange={(value) =>
                      setCalibrationReasons((prev) => ({
                        ...prev,
                        [candidate.id]: value,
                      }))
                    }
                    submitted={calibSubmitted}
                    entryState={calibEntryState}
                    onSubmitJudgment={(fit) =>
                      handleSubmitCalibrationJudgment(candidate, fit)
                    }
                    contextualizeState={contextualizeStates[candidate.id]}
                    contextualizeResult={contextualizeResults[candidate.id]}
                    applyState={applyStates[candidate.id] ?? "idle"}
                    onApplyCriterion={() => handleApplyCriterion(candidate.id)}
                  />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* X-ray Assist (2026-07-19): the legitimate version of "scan
          LinkedIn" -- generates ready-to-click search-engine query links
          (site:linkedin.com/in + role brief terms) for a recruiter to open
          and review themselves, same as manual X-ray search always worked.
          Built entirely client-side from data already loaded -- no server
          call, no automation of LinkedIn itself, no bot-detection anywhere
          near this. */}
      {selectedId && roleBriefDetail && (
        <div className="flex flex-col gap-2 border rounded-lg p-4">
          <h3 className="text-sm font-medium">X-ray Assist</h3>
          <p className="text-xs text-muted-foreground">
            Opens a search engine with a ready-made query for this role --
            you do the actual searching and reviewing, same as manual X-ray
            search always worked. Nothing here touches LinkedIn directly.
          </p>
          <div className="flex flex-wrap gap-2">
            {buildXrayQueries(roleBriefDetail).map(({ label, url }) => (
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
      )}

      {stage !== "idle" && (
        <div className="flex flex-col gap-4 border rounded-lg p-4">
          <div>
            <h2 className="text-lg font-medium">
              {total} match{total === 1 ? "" : "es"} for {roleBriefTitle}
            </h2>
            {notes.length > 0 && (
              <ul className="text-muted-foreground text-xs list-disc pl-4 mt-1">
                {notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            )}
          </div>

          {stage === "previewed" && !calibrationStarted && (
            <div className="flex flex-col gap-3">
              {existingCalibrationFeedback.length > 0 && (
                <p className="text-muted-foreground text-xs">
                  You've already calibrated {existingCalibrationFeedback.length}{" "}
                  candidate(s) for this role brief.
                </p>
              )}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleStartCalibration()}
                  disabled={calibrationLoading || total === 0}
                >
                  {calibrationLoading
                    ? "Pulling top matches..."
                    : "Calibrate first (review top 3)"}
                </Button>
                <span className="text-muted-foreground text-xs">
                  Cheap gut-check before pulling more -- mark the top 3
                  matches fit / not a fit with a reason.
                </span>
              </div>
              <div className="flex items-end gap-3">
                <div className="flex flex-col gap-2 max-w-[200px]">
                  <Label htmlFor="size">How many to pull first (max 25)</Label>
                  <input
                    id="size"
                    type="number"
                    min={1}
                    max={25}
                    className="border border-input bg-background text-foreground rounded-md h-9 px-2"
                    value={size}
                    onChange={(e) => setSize(Number(e.target.value))}
                  />
                </div>
                <Button onClick={handleFetch} disabled={fetchLoading || total === 0}>
                  {fetchLoading ? "Fetching..." : "Fetch candidates"}
                </Button>
              </div>
            </div>
          )}

          {stage === "previewed" && calibrationStarted && (
            <div className="flex flex-col gap-4">
              <h3 className="text-sm font-medium">
                Calibration: top {calibrationCandidates.length} match
                {calibrationCandidates.length === 1 ? "" : "es"}
              </h3>
              {calibrationCandidates.map((candidate) => {
                const entryState =
                  calibrationEntryStates[candidate.id] ?? "idle";
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
                            className="text-blue-600 underline"
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
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
                          Why this surfaced: {candidate._match_evidence}
                        </div>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Check the LinkedIn profile before judging -- it may be
                      stale, so use your own read on whether it's actually a
                      fit, not just what's listed here.
                    </p>

                    <CalibrationFeedbackWidget
                      reason={calibrationReasons[candidate.id] ?? ""}
                      onReasonChange={(value) =>
                        setCalibrationReasons((prev) => ({
                          ...prev,
                          [candidate.id]: value,
                        }))
                      }
                      submitted={submitted}
                      entryState={entryState}
                      onSubmitJudgment={(fit) =>
                        handleSubmitCalibrationJudgment(candidate, fit)
                      }
                      contextualizeState={contextualizeStates[candidate.id]}
                      contextualizeResult={contextualizeResults[candidate.id]}
                      applyState={applyStates[candidate.id] ?? "idle"}
                      onApplyCriterion={() => handleApplyCriterion(candidate.id)}
                    />
                  </div>
                );
              })}

              <div className="flex items-end gap-3 pt-2 border-t">
                <div className="flex flex-col gap-2 max-w-[200px]">
                  <Label htmlFor="size">How many to pull next (max 25)</Label>
                  <input
                    id="size"
                    type="number"
                    min={1}
                    max={25}
                    className="border border-input bg-background text-foreground rounded-md h-9 px-2"
                    value={size}
                    onChange={(e) => setSize(Number(e.target.value))}
                  />
                </div>
                <Button onClick={handleFetch} disabled={fetchLoading || total === 0}>
                  {fetchLoading ? "Fetching..." : "Fetch candidates"}
                </Button>
              </div>
            </div>
          )}

          {stage === "fetched" && candidates.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No PDL profiles matched this query.
            </p>
          )}

          {candidates.map((candidate) => {
            const saveState = saveStates[candidate.id] ?? "idle";
            const candidateId = candidateDbIds[candidate.id];
            const contactState = contactEnrichStates[candidate.id] ?? "idle";
            const contactResult = contactEnrichResults[candidate.id];
            const devSignalState =
              devSignalEnrichStates[candidate.id] ?? "idle";
            const devSignalResult = devSignalEnrichResults[candidate.id];
            const fullProfileState = fullProfileStates[candidate.id] ?? "idle";
            const fullProfile = fullProfileData[candidate.id];
            const fullProfileIsOpen = Boolean(
              fullProfileExpanded[candidate.id],
            );
            const scoreState = scoreStates[candidate.id] ?? "idle";
            const scoreResult = scoreResults[candidate.id];
            const fitState = fitStates[candidate.id] ?? "idle";
            const fitResult = fitResults[candidate.id];
            const interviewState = interviewStates[candidate.id] ?? "idle";
            const interviewResult = interviewResults[candidate.id];
            const resumeState = resumeStates[candidate.id] ?? "idle";
            const resumeInfo = resumeInfos[candidate.id];
            const offerState = offerStates[candidate.id] ?? "idle";
            const offerInfo = offerInfos[candidate.id];
            const offerFormIsOpen = Boolean(offerFormOpen[candidate.id]);
            const offerDraft = offerDrafts[candidate.id] ?? EMPTY_OFFER_DRAFT;
            return (
              <div
                key={candidate.id}
                className="border rounded-md p-3 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-3">
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
                          className="text-blue-600 underline"
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

                {/* Pipeline action cluster -- see CandidateActionsPanel's
                    header comment. Only reachable once this candidate has a
                    real candidates.id (i.e. after "Add to pipeline" has
                    actually run) -- an unsaved search hit can't be enriched,
                    scored, scheduled, or offered. */}
                {candidateId && (
                  <CandidateActionsPanel
                    candidate={candidate}
                    showFullProfile
                    contactState={contactState}
                    contactResult={contactResult}
                    onEnrichContact={() => handleEnrichContact(candidate)}
                    devSignalState={devSignalState}
                    devSignalResult={devSignalResult}
                    onEnrichDevSignals={() => handleEnrichDevSignals(candidate)}
                    fullProfileState={fullProfileState}
                    fullProfile={fullProfile}
                    fullProfileIsOpen={fullProfileIsOpen}
                    onViewFullProfile={() => handleViewFullProfile(candidate)}
                    scoreState={scoreState}
                    scoreResult={scoreResult}
                    onScoreCandidate={() => handleScoreCandidate(candidate)}
                    fitState={fitState}
                    fitResult={fitResult}
                    onAssessFit={() => handleAssessFit(candidate)}
                    interviewState={interviewState}
                    interviewResult={interviewResult}
                    onCreateBookingLink={() => handleCreateBookingLink(candidate)}
                    resumeState={resumeState}
                    resumeInfo={resumeInfo}
                    onRequestResume={() => handleRequestResume(candidate)}
                    onCheckForResume={() => handleCheckForResume(candidate)}
                    offerState={offerState}
                    offerInfo={offerInfo}
                    offerFormIsOpen={offerFormIsOpen}
                    offerDraft={offerDraft}
                    onToggleOfferForm={() => handleToggleOfferForm(candidate)}
                    onOfferDraftChange={(field, value) =>
                      handleOfferDraftChange(String(candidate.id), field, value)
                    }
                    onSendOffer={() => handleSendOffer(candidate)}
                    onCheckOffer={() => handleCheckOffer(candidate)}
                    onMarkOfferStatus={(status) =>
                      handleMarkOfferStatus(candidate, status)
                    }
                  />
                )}
              </div>
            );
          })}

          {stage === "fetched" && (
            <div className="flex flex-col gap-1">
              <Button
                variant="outline"
                onClick={handleSearchWider}
                disabled={!canSearchWider || wideningLoading}
              >
                {wideningLoading
                  ? "Fetching more..."
                  : canSearchWider
                    ? `Search wider (${candidates.length} of ${total} reviewed)`
                    : `All ${total} match(es) reviewed`}
              </Button>
              <p className="text-muted-foreground text-xs">
                Pulls the next batch further down this same search -- not a
                different, looser search.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

SourceCandidatesPage.path = "/source-candidates";
