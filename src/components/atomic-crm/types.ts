import type { Identifier, RaRecord } from "ra-core";
import type { ComponentType } from "react";

import type {
  COMPANY_CREATED,
  CONTACT_CREATED,
  CONTACT_NOTE_CREATED,
  DEAL_CREATED,
  DEAL_NOTE_CREATED,
} from "./consts";

export type SignUpData = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
};

export type SalesFormData = {
  avatar?: string;
  email: string;
  password?: string;
  first_name: string;
  last_name: string;
  administrator: boolean;
  disabled: boolean;
};

export type Sale = {
  first_name: string;
  last_name: string;
  administrator: boolean;
  avatar?: RAFile;
  disabled?: boolean;
  user_id: string;

  /**
   * This is a copy of the user's email, to make it easier to handle by react admin
   * DO NOT UPDATE this field directly, it should be updated by the backend
   */
  email: string;

  /** Unipile Phase 3 — synced from edge functions, not edited in forms. */
  unipile_account_id?: string | null;
  unipile_linkedin_seat_type?: string | null;
  unipile_account_status?: string | null;
  unipile_checkpoint_type?: string | null;
  unipile_connected_at?: string | null;
  unipile_last_sync_at?: string | null;

  /**
   * This is used by the fake rest provider to store the password
   * DO NOT USE this field in your code besides the fake rest provider
   * @deprecated
   */
  password?: string;
} & Pick<RaRecord, "id">;

export type Company = {
  name: string;
  logo: RAFile;
  sector: string;
  size: 1 | 10 | 50 | 250 | 500;
  linkedin_url: string;
  website: string;
  phone_number: string;
  address: string;
  zipcode: string;
  city: string;
  state_abbr: string;
  sales_id?: Identifier;
  created_at: string;
  description: string;
  revenue: string;
  tax_identifier: string;
  country: string;
  context_links?: string[];
  nb_contacts?: number;
  nb_deals?: number;
} & Pick<RaRecord, "id">;

export type EmailAndType = {
  email: string;
  type: "Work" | "Home" | "Other";
};

export type PhoneNumberAndType = {
  number: string;
  type: "Work" | "Home" | "Other";
};

export type Contact = {
  first_name: string;
  last_name: string;
  title: string;
  company_id?: Identifier | null;
  email_jsonb: EmailAndType[];
  avatar?: Partial<RAFile>;
  linkedin_url?: string | null;
  first_seen: string;
  last_seen: string;
  has_newsletter: boolean;
  tags: number[];
  gender: string;
  sales_id?: Identifier;
  status: string;
  background: string;
  phone_jsonb: PhoneNumberAndType[];
  nb_tasks?: number;
  company_name?: string;
} & Pick<RaRecord, "id">;

export type ContactNote = {
  contact_id: Identifier;
  text: string;
  date: string;
  sales_id: Identifier;
  status: string;
  attachments?: AttachmentNote[];
} & Pick<RaRecord, "id">;

export type Deal = {
  name: string;
  company_id: Identifier;
  contact_ids: Identifier[];
  category: string;
  stage: string;
  description: string;
  amount: number;
  created_at: string;
  updated_at: string;
  archived_at?: string;
  expected_closing_date: string;
  sales_id: Identifier;
  index: number;
  // Agent H, schema 30 (2026-07-19): unguessable token backing the public,
  // unauthenticated candidate-application link (/apply/:token). Every deal
  // gets one for free via the column's DB default -- never null in
  // practice, but optional here defensively since older client-side record
  // shapes (fakerest fixtures, cached queries from before this column
  // existed) may not include it.
  public_application_token?: string;
  // Agent H, 2026-07-22 migration (agent_h_role_brief_tiers_and_clarifications):
  // ranked primary-vs-fallback candidate profile, only populated when the
  // JD genuinely described one -- see parse-job-description's header
  // comment. Null/empty for the common flat-requirement case.
  preference_tiers?: Array<{
    rank: number;
    label: string;
    keywords: string[];
    condition: string | null;
  }> | null;
  // Ambiguities parse-job-description flagged at intake time (task #30),
  // shown once as a dismissible advisory in JdIntakePage.
  clarifying_questions?: string[] | null;
  clarifying_questions_dismissed?: boolean;
  // Agent H, schema 18: discovery scroll-position cache on the role brief.
  role_brief_last_scroll_token?: string | null;
  role_brief_last_scroll_query?: string | null;
  role_brief_last_scroll_updated_at?: string | null;
  // Phase 2: Coordinator tab settings persisted to the deal row.
  coordinator_settings?: {
    knowledge_base?: string;
    calendar_link?: string;
    reply_mode?: "draft" | "auto";
  } | null;
  // Pause sourcing toggle — blocks start_sourcing / calibration_next_batch.
  // Autopilot (when added) will also check this before auto-triggering runs.
  sourcing_paused?: boolean;
  // T1/T2: taxonomy-aware sourcing intent, versioned. Stored as
  // { current: VersionedSearchIntent, history: VersionedSearchIntent[] }.
  role_brief_search_intent?: SearchIntentRecord | null;
} & Pick<RaRecord, "id">;

// ─── SearchIntent frontend types (mirrors supabase/functions/_shared/searchIntent.ts) ───

export type SearchIntentCategory =
  | "seniority"
  | "company"
  | "title"
  | "skill"
  | "experience_range"
  | "location"
  | "other";

export type SearchIntentDisposition = "require" | "exclude" | "prefer";

export type SearchIntentCondition = {
  category: SearchIntentCategory;
  disposition: SearchIntentDisposition;
  value: string;
  note?: string;
};

export type UnenforcedConstraint = {
  description: string;
  reason: string;
};

export type VersionedSearchIntent = {
  version: number;
  updated_at: string;
  conditions: SearchIntentCondition[];
  unenforceable_constraints: UnenforcedConstraint[];
};

export type SearchIntentRecord = {
  current: VersionedSearchIntent;
  history: VersionedSearchIntent[];
};

// See docs/adr/ADR-617f-phase-b-role-conversation-turns.md
export type RoleConversationTurn = {
  deal_id: Identifier;
  speaker: "recruiter" | "agent";
  actor_sales_id?: Identifier | null;
  content: string;
  in_reply_to?: Identifier | null;
  idempotency_key?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
} & Pick<RaRecord, "id">;

export type DealNote = {
  deal_id: Identifier;
  text: string;
  date: string;
  sales_id: Identifier;
  attachments?: AttachmentNote[];

  // This is defined for compatibility with `ContactNote`
  status?: undefined;
} & Pick<RaRecord, "id">;

export type Tag = {
  id: number;
  name: string;
  color: string;
};

// Agent H Stage 3: a sourced/saved job candidate (public.candidates).
// Deliberately separate from Contact -- see 09_agent_h_candidates.sql's
// table comment for why. Enrichment fields are all nullable: null means
// "never attempted", not "attempted and empty" -- see the column comments in
// 21_agent_h_contact_and_devsignal_enrichment.sql for the full status
// vocabulary (enriched / not_found / failed).
export type Candidate = {
  first_name: string | null;
  last_name: string | null;
  current_title: string | null;
  current_company_id?: Identifier | null;
  linkedin_url: string | null;
  email_jsonb?: EmailAndType[] | null;
  phone_jsonb?: PhoneNumberAndType[] | null;
  source: string | null;
  source_id: string | null;
  status: string | null;
  contact_enrichment_status?: "enriched" | "not_found" | "failed" | null;
  contact_enrichment_source?: "hunter" | "apollo" | null;
  devsignal_enrichment_status?: "enriched" | "not_found" | "failed" | null;
  github_username?: string | null;
  github_url?: string | null;
  stackoverflow_url?: string | null;
  engaged_by_sales_id?: Identifier | null;
  engaged_since?: string | null;
  // The full search-result payload save-sourced-candidate captured at save
  // time (2026-07-22 follow-up: this was already being written on every
  // insert, just never read back anywhere -- see DealCandidatesSection's
  // "Quick view" for the fix). Vendor-shaped, not a fixed schema -- read
  // defensively (see readSourceSnapshot in DealCandidatesSection.tsx) since
  // its exact keys depend on which sourcing edge function produced this
  // candidate (free-portal/Exa/X-ray all normalize slightly differently).
  source_raw?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
} & Pick<RaRecord, "id">;

// Agent H Stage 3: links a Candidate to a role brief (Deal) they were
// sourced for (public.deal_candidates). match_score is the Voyage rank
// score captured at save time -- see
// 23_agent_h_deal_candidates_match_score.sql -- null for candidates saved
// before that column existed, or any search that didn't score.
export type DealCandidate = {
  deal_id: Identifier;
  candidate_id: Identifier;
  sourced_via: string;
  match_score?: number | null;
  created_at: string;
  // Stage 1: Outreach (2026-07-22 migration
  // agent_h_deal_candidates_outreach_stage) -- bridges "just sourced" to
  // "actively being contacted". not_contacted (default) -> sent
  // (send-first-outreach fired) -> responded (a reply was captured via
  // resend-inbound-reply). Never auto-downgraded once set to responded.
  response_status?: "not_contacted" | "sent" | "responded";
  contacted_at?: string | null;
  responded_at?: string | null;
  reply_text?: string | null;
  // Phase 4 Unipile outreach tracking (schema 34).
  outreach_channel?: "email" | "linkedin_connection" | "linkedin_inmail" | null;
  outreach_message_body?: string | null;
  outreach_approved_at?: string | null;
  outreach_sent_at?: string | null;
  linkedin_provider_id?: string | null;
} & Pick<RaRecord, "id">;

export type Task = {
  contact_id: Identifier;
  type: string;
  text: string;
  due_date: string;
  done_date?: string | null;
  sales_id?: Identifier;
} & Pick<RaRecord, "id">;

export type ActivityCompanyCreated = {
  type: typeof COMPANY_CREATED;
  company_id: Identifier;
  company: Company;
  sales_id: Identifier;
  date: string;
} & Pick<RaRecord, "id">;

export type ActivityContactCreated = {
  type: typeof CONTACT_CREATED;
  company_id: Identifier;
  sales_id?: Identifier;
  contact: Contact;
  date: string;
} & Pick<RaRecord, "id">;

export type ActivityContactNoteCreated = {
  type: typeof CONTACT_NOTE_CREATED;
  sales_id?: Identifier;
  contactNote: ContactNote;
  date: string;
} & Pick<RaRecord, "id">;

export type ActivityDealCreated = {
  type: typeof DEAL_CREATED;
  company_id: Identifier;
  sales_id?: Identifier;
  deal: Deal;
  date: string;
};

export type ActivityDealNoteCreated = {
  type: typeof DEAL_NOTE_CREATED;
  sales_id?: Identifier;
  dealNote: DealNote;
  date: string;
};

export type Activity = RaRecord &
  (
    | ActivityCompanyCreated
    | ActivityContactCreated
    | ActivityContactNoteCreated
    | ActivityDealCreated
    | ActivityDealNoteCreated
  );

export interface RAFile {
  src: string;
  title: string;
  path?: string;
  rawFile: File;
  type?: string;
}

export type AttachmentNote = RAFile;

export interface LabeledValue {
  value: string;
  label: string;
}

export type DealStage = LabeledValue;

export interface NoteStatus extends LabeledValue {
  color: string;
}

export interface ContactGender {
  value: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

// ─── FilterDraft — typed form fields for the "Build search" page ─────────────
// Mirrors _shared/crustdataFilterCompiler.ts FilterDraft (kept in sync manually;
// no shared import because frontend and Deno runtimes are separate).
//
// Multi-value boolean semantics (shown in UI helper text):
//   currentTitlesInclude / pastTitlesInclude → OR (any synonym matches)
//   currentTitlesExclude                     → AND (all exclusions enforced)
//   locationCountries / locationCities / locationStates → OR
//   skillsRequired                           → AND (every listed skill required)
//   skillsNiceToHave                         → OR (any matching skill counts)
//   currentCompaniesInclude / pastCompaniesInclude / companyIndustries → OR
//   currentCompaniesExclude / headlineKeywordsExclude → AND
//   currentSeniorities / languages           → OR

export type FilterDraft = {
  // ── Titles ────────────────────────────────────────────────────────────────
  currentTitlesInclude?: string[];
  currentTitlesExclude?: string[];
  pastTitlesInclude?: string[];

  // ── Location ──────────────────────────────────────────────────────────────
  /** Multi-country OR. Supersedes single-value locationCountry. */
  locationCountries?: string[];
  /** @deprecated Use locationCountries */
  locationCountry?: string;
  /** @deprecated Use locationCities */
  locationCity?: string;
  locationCities?: string[];
  locationStates?: string[];

  // ── Skills ────────────────────────────────────────────────────────────────
  skillsRequired?: string[];
  skillsNiceToHave?: string[];

  // ── Experience / seniority ────────────────────────────────────────────────
  /** @deprecated Use currentSeniorities */
  seniority?: string;
  currentSeniorities?: string[];
  yoeMin?: number | null;
  yoeMax?: number | null;

  // ── Companies ─────────────────────────────────────────────────────────────
  currentCompaniesInclude?: string[];
  currentCompaniesExclude?: string[];
  pastCompaniesInclude?: string[];
  companyIndustries?: string[];
  /** ISO 3166-1 alpha-3 code e.g. "USA", "IND", "GBR" */
  companyHQCountry?: string;
  headcountMin?: number | null;
  headcountMax?: number | null;

  // ── Education ─────────────────────────────────────────────────────────────
  educationSchools?: string[];
  educationDegrees?: string[];
  educationFieldsOfStudy?: string[];

  // ── Headline & other ──────────────────────────────────────────────────────
  headlineKeywordsInclude?: string[];
  headlineKeywordsExclude?: string[];
  /** Full language names e.g. "English", "Spanish", "Hindi" */
  languages?: string[];
  connectionsMin?: number | null;
  /** Crustdata recently_changed_jobs boolean flag */
  recentlyChangedJobs?: boolean;

  // ── Title match mode ──────────────────────────────────────────────────────
  /** "all_words" (default, (.)) or "exact_phrase" ([.]) for currentTitlesInclude. */
  titleMatchMode?: "all_words" | "exact_phrase";

  // ── Geo ───────────────────────────────────────────────────────────────────
  /** Center location string for geo radius filter e.g. "San Francisco, CA". */
  geoNear?: string | null;
  /** Radius distance. Requires geoNear. */
  geoDistance?: number | null;
  /** Distance unit (default "mi"). */
  geoUnit?: "km" | "mi";
  /** When true, use geo_exclude (exclude radius) instead of geo_distance. */
  geoExcludeNear?: boolean;

  // ── Continents ────────────────────────────────────────────────────────────
  /** Continents (multi OR). Each → (.) on locationContinent. */
  locationContinents?: string[];

  // ── Function categories ───────────────────────────────────────────────────
  /** Current function categories (multi OR). */
  functionCategories?: string[];

  // ── Employment types ──────────────────────────────────────────────────────
  /** Current employment types (multi OR) e.g. "Full-time", "Contract". */
  employmentTypes?: string[];

  // ── Company domains ───────────────────────────────────────────────────────
  /** Current employer website domains (bare, no scheme) e.g. "stripe.com". */
  currentCompanyDomains?: string[];

  // ── Past company exclude ──────────────────────────────────────────────────
  /** Past company names to exclude. Each → (!) AND. */
  pastCompaniesExclude?: string[];

  // ── Open-to cards ─────────────────────────────────────────────────────────
  /** Open-to signal codes. Emits single "in" condition. */
  openToCards?: Array<"CAREER_INTEREST" | "HIRING_MANAGER" | "VOLUNTEERING">;

  // ── Followers / connections ───────────────────────────────────────────────
  /** Maximum LinkedIn connections count. Emits =< condition. */
  connectionsMax?: number | null;
  /** Minimum LinkedIn follower count. Emits => on followers field. */
  followersMin?: number | null;

  // ── Sort ──────────────────────────────────────────────────────────────────
  /** Field to sort results by. Allowlisted in compiler. */
  sortField?: string | null;
  /** Sort order (default "desc"). */
  sortOrder?: "asc" | "desc";
};
