import { supabaseDataProvider } from "ra-supabase-core";
import {
  withLifecycleCallbacks,
  type DataProvider,
  type GetListParams,
  type Identifier,
  type ResourceCallbacks,
} from "ra-core";
import type {
  Candidate,
  ContactNote,
  Deal,
  DealCandidate,
  DealNote,
  RAFile,
  Sale,
  SalesFormData,
  SignUpData,
} from "../../types";
import type { ConfigurationContextValue } from "../../root/ConfigurationContext";
import { ATTACHMENTS_BUCKET } from "../commons/attachments";
import { getIsInitialized } from "./authProvider";
import { getSupabaseClient } from "./supabase";
import { isCandidateRelevantToDeal } from "./candidateRelevanceFilter";

const getBaseDataProvider = () =>
  supabaseDataProvider({
    instanceUrl: import.meta.env.VITE_SUPABASE_URL,
    apiKey: import.meta.env.VITE_SB_PUBLISHABLE_KEY,
    supabaseClient: getSupabaseClient(),
    sortOrder: "asc,desc.nullslast" as any,
  });

const processCompanyLogo = async (params: any) => {
  const logo = params.data.logo;

  if (logo?.rawFile instanceof File) {
    await uploadToBucket(logo);
  }

  return {
    ...params,
    data: {
      ...params.data,
      logo,
    },
  };
};

const getDataProviderWithCustomMethods = () => {
  const baseDataProvider = getBaseDataProvider();

  return {
    ...baseDataProvider,
    async getList(resource: string, params: GetListParams) {
      if (resource === "companies") {
        return baseDataProvider.getList("companies_summary", params);
      }
      if (resource === "contacts") {
        return baseDataProvider.getList("contacts_summary", params);
      }
      if (resource === "activity_log") {
        const { data, total } = await baseDataProvider.getList(
          "activity_log",
          params,
        );
        // Rename snake_case view columns to camelCase to match Activity type
        return {
          data: data.map((row: any) => ({
            ...row,
            contactNote: row.contact_note ?? undefined,
            dealNote: row.deal_note ?? undefined,
            contact_note: undefined,
            deal_note: undefined,
          })),
          total,
        };
      }

      return baseDataProvider.getList(resource, params);
    },
    async getOne(resource: string, params: any) {
      if (resource === "companies") {
        return baseDataProvider.getOne("companies_summary", params);
      }
      if (resource === "contacts") {
        return baseDataProvider.getOne("contacts_summary", params);
      }

      return baseDataProvider.getOne(resource, params);
    },

    async signUp({ email, password, first_name, last_name }: SignUpData) {
      const response = await getSupabaseClient().auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name,
            last_name,
          },
        },
      });

      if (!response.data?.user || response.error) {
        console.error("signUp.error", response.error);
        throw new Error(response?.error?.message || "Failed to create account");
      }

      // Update the is initialized cache
      (getIsInitialized as any)._is_initialized_cache = true;

      return {
        id: response.data.user.id,
        email,
        password,
      };
    },
    async salesCreate(body: SalesFormData) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        data: Sale;
      }>("users", {
        method: "POST",
        body,
      });

      if (!data || error) {
        console.error("salesCreate.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(errorDetails?.message || "Failed to create the user");
      }

      return data.data;
    },
    async salesUpdate(
      id: Identifier,
      data: Partial<Omit<SalesFormData, "password">>,
    ) {
      const { email, first_name, last_name, administrator, avatar, disabled } =
        data;

      const { data: updatedData, error } =
        await getSupabaseClient().functions.invoke<{
          data: Sale;
        }>("users", {
          method: "PATCH",
          body: {
            sales_id: id,
            email,
            first_name,
            last_name,
            administrator,
            disabled,
            avatar,
          },
        });

      if (!updatedData || error) {
        console.error("salesCreate.error", error);
        throw new Error("Failed to update account manager");
      }

      return updatedData.data;
    },
    async updatePassword(id: Identifier) {
      const { data: passwordUpdated, error } =
        await getSupabaseClient().functions.invoke<boolean>("update_password", {
          method: "PATCH",
          body: {
            sales_id: id,
          },
        });

      if (!passwordUpdated || error) {
        console.error("update_password.error", error);
        throw new Error("Failed to update password");
      }

      return passwordUpdated;
    },
    async unarchiveDeal(deal: Deal) {
      // get all deals where stage is the same as the deal to unarchive
      const { data: deals } = await baseDataProvider.getList<Deal>("deals", {
        filter: { stage: deal.stage },
        pagination: { page: 1, perPage: 1000 },
        sort: { field: "index", order: "ASC" },
      });

      // set index for each deal starting from 1, if the deal to unarchive is found, set its index to the last one
      const updatedDeals = deals.map((d, index) => ({
        ...d,
        index: d.id === deal.id ? 0 : index + 1,
        archived_at: d.id === deal.id ? null : d.archived_at,
      }));

      return await Promise.all(
        updatedDeals.map((updatedDeal) =>
          baseDataProvider.update("deals", {
            id: updatedDeal.id,
            data: updatedDeal,
            previousData: deals.find((d) => d.id === updatedDeal.id),
          }),
        ),
      );
    },
    async isInitialized() {
      return getIsInitialized();
    },
    async mergeContacts(sourceId: Identifier, targetId: Identifier) {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "merge_contacts",
        {
          method: "POST",
          body: { loserId: sourceId, winnerId: targetId },
        },
      );

      if (error) {
        console.error("merge_contacts.error", error);
        throw new Error("Failed to merge contacts");
      }

      return data;
    },
    // Agent H Stage 2: JD intake. Calls the parse-job-description edge
    // function, which runs a single forced tool-use call against Claude to
    // turn free-text JD content into the structured role-brief fields added
    // in supabase/schemas/15_agent_h_structured_role_brief_fields.sql.
    async parseJobDescription(jdText: string) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        data: {
          title: string;
          seniority: string;
          location: string;
          industry: string | null;
          employment_type: string;
          years_experience_min: number | null;
          years_experience_max: number | null;
          required_skills: string[];
          must_have_keywords: string[];
          nice_to_have_keywords: string[];
          // Agent H, tiered preferences + clarifying questions
          // (2026-07-22) -- see parse-job-description's own header
          // comment and JdIntakePage's PreferenceTier type.
          preference_tiers: Array<{
            rank: number;
            label: string;
            keywords: string[];
            condition: string | null;
          }>;
          clarifying_questions: string[];
        };
      }>("parse-job-description", {
        method: "POST",
        body: { jd_text: jdText },
      });

      if (!data || error) {
        console.error("parseJobDescription.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to parse the job description",
        );
      }

      return data.data;
    },
    // Agent H Stage 3, checkpoint 3a: pure PDL discovery. Calls the
    // source-candidates-discovery edge function, which builds a PDL Person
    // Search query from a role brief's structured fields and returns
    // whatever candidates PDL finds. No dedup, matching, or scoring yet --
    // see the edge function's own header comment for the full checkpoint
    // scope.
    async sourceCandidates(
      roleBriefId: Identifier,
      size?: number,
      scrollToken?: string | null,
      isPreview?: boolean,
      // Taxonomy/boolean-logic test addition: optional forced vendor name
      // ("crustdata" active; "coresignal"/"apollo" dormant).
      // function's runDiscovery preferredProvider param -- lets the same
      // role brief be run against ONE specific vendor on demand for a real
      // side-by-side comparison, bypassing the normal priority-fallback
      // behavior. Omitted by default (undefined), in which case the edge
      // function just uses whichever configured provider comes first.
      provider?: string,
    ) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        role_brief: {
          id: number;
          title: string | null;
          location: string | null;
        };
        query_used: unknown;
        notes: string[];
        total: number;
        // Real total-match-count across the full search index; null for a
        // provider that doesn't supply it separately. Was already returned
        // by the edge function -- just not declared in this invoke<> type
        // until the funnel-bar UI needed to read it.
        total_matches_all: number | null;
        candidates: Array<{
          id: string;
          full_name?: string;
          job_title?: string;
          job_company_name?: string;
          location_name?: string;
          linkedin_url?: string;
          emails?: { address: string; type?: string }[];
          skills?: string[];
        }>;
        scroll_token: string | null;
      }>("source-candidates-discovery", {
        method: "POST",
        body: {
          role_brief_id: roleBriefId,
          size,
          ...(scrollToken ? { scroll_token: scrollToken } : {}),
          ...(isPreview ? { is_preview: true } : {}),
          ...(provider ? { provider } : {}),
        },
      });

      if (!data || error) {
        console.error("sourceCandidates.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to search for candidates",
        );
      }

      return data;
    },

    // Agent H Stage 3: free-portal sourcing (2026-07-19). Calls the
    // source-candidates-free-portals edge function -- a SEPARATE function
    // from source-candidates-discovery, deliberately: GitHub, Stack
    // Overflow, Hugging Face, and Kaggle via their own free, official
    // public APIs, before any Coresignal/PDL/Apollo payment-plan decision
    // is made. Reuses the same role_brief_learned_criteria table the
    // calibration loop already writes to, so a recruiter's "not a fit"
    // feedback narrows these free-portal results too (require/exclude
    // keyword only -- years-of-experience criteria don't apply here, see
    // the edge function's header comment for why, surfaced via `notes`).
    async sourceFreePortalCandidates(roleBriefId: Identifier, size?: number) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        candidates: Array<{
          id: string;
          full_name?: string;
          job_title?: string;
          job_company_name?: string;
          location_name?: string;
          linkedin_url?: string | null;
          skills?: string[];
          _source_vendor: string;
          _portal_url?: string | null;
        }>;
        notes: string[];
        total: number;
      }>("source-candidates-free-portals", {
        method: "POST",
        body: { role_brief_id: roleBriefId, size },
      });

      if (!data || error) {
        console.error("sourceFreePortalCandidates.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to search free portals",
        );
      }

      return data;
    },

    // Exa.ai sourcing (2026-07-19): a paid, general public-web people-search
    // API -- separate from sourceFreePortalCandidates because cost is a real,
    // distinct property of this data source (unlike GitHub/Stack Exchange/
    // Hugging Face/Kaggle) that should stay visible, not blended into "free".
    // Same calibration-loop reuse and vendor-neutral save path as the free
    // portals; see source-candidates-exa's header comment for the judgment
    // call on why this is treated differently from the declined BrightData/
    // direct-LinkedIn-automation path.
    async sourceExaCandidates(roleBriefId: Identifier, size?: number) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        candidates: Array<{
          id: string;
          full_name?: string;
          job_title?: string;
          job_company_name?: string;
          location_name?: string;
          linkedin_url?: string | null;
          skills?: string[];
          _source_vendor: string;
          _portal_url?: string | null;
        }>;
        notes: string[];
        total: number;
      }>("source-candidates-exa", {
        method: "POST",
        body: { role_brief_id: roleBriefId, size },
      });

      if (!data || error) {
        console.error("sourceExaCandidates.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to search Exa",
        );
      }

      return data;
    },

    // Agent H Stage 3: X-ray search (2026-07-22). Runs multiple Exa
    // searches per portal, scoped via includeDomains to linkedin.com /
    // codechef.com / hackerrank.com -- see source-candidates-xray/index.ts's
    // header comment for the full v1-v4 history (BrightData SERP -> direct
    // DuckDuckGo fetch, blocked by bot detection -> BrightData proxy relay,
    // blocked on a paid zone/payment method -> Exa's includeDomains, which
    // is already a live, working, cheap vendor on this project). Kept as
    // its own button (SourceCandidatesPage) rather than folded into
    // continueSourcingForDeal, mainly for clarity on what ran and its own
    // notes, not because it's expensive -- unlike the earlier BrightData
    // design this no longer needs a separate cost gate.
    async sourceXrayCandidates(roleBriefId: Identifier) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        candidates: Array<{
          id: string;
          full_name?: string;
          job_title?: string;
          job_company_name?: string;
          location_name?: string;
          linkedin_url?: string | null;
          skills?: string[];
          _source_vendor: string;
          _portal_url?: string | null;
        }>;
        notes: string[];
        total: number;
      }>("source-candidates-xray", {
        method: "POST",
        body: { role_brief_id: roleBriefId },
      });

      if (!data || error) {
        console.error("sourceXrayCandidates.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to run X-ray search",
        );
      }

      return data;
    },

    // Agent H, Triage Inbox + Command Canvas: the "continue sourcing"
    // command-bar action. Runs both free-portal and Exa search for a role
    // in one shot and saves what comes back straight into the pipeline --
    // the same two calls + save loop a recruiter would do by hand from
    // SourceCandidatesPage's "Search free & low-cost portals" button, just
    // triggered by a typed command instead of clicking through. Capped to
    // the first MAX_AUTO_SAVE results so one command can't silently flood
    // a role's pipeline; anything beyond that is still visible by running
    // the same search manually from the Sourcing screen.
    //
    // Relevance pre-filter (2026-07-20): free-portal/Exa search matches on
    // loose keyword overlap (e.g. "Python"), which let through irrelevant
    // Hugging Face/Kaggle model-author "candidates" on the AI Engineer role
    // during live testing -- title/skills mentioned Python, nothing else
    // about the role. Before saving, each candidate must clear
    // isCandidateRelevantToDeal() against the deal's own required_skills/
    // must_have_keywords/excluded_companies/exclusion_keywords -- the same
    // criteria the recruiter already set on the role, not a new concept.
    // Filtered-out candidates are still reported (filteredCount) rather than
    // silently dropped, so the recruiter can tell the filter did something.
    async continueSourcingForDeal(dealId: Identifier) {
      const MAX_AUTO_SAVE = 15;
      const [dealResult, freePortalResult, exaResult] = await Promise.all([
        baseDataProvider
          .getOne("deals", { id: dealId })
          .catch((error: Error) => {
            console.error(
              "continueSourcingForDeal: failed to fetch deal",
              error,
            );
            return null;
          }),
        this.sourceFreePortalCandidates(dealId).catch((error: Error) => {
          console.error(
            "continueSourcingForDeal: free-portal search failed",
            error,
          );
          return null;
        }),
        this.sourceExaCandidates(dealId).catch((error: Error) => {
          console.error("continueSourcingForDeal: Exa search failed", error);
          return null;
        }),
      ]);

      const found = [
        ...(freePortalResult?.candidates ?? []),
        ...(exaResult?.candidates ?? []),
      ];
      const seen = new Set<string>();
      const deduped = found.filter((candidate) => {
        const key = candidate.linkedin_url || candidate.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const deal = dealResult?.data as
        | {
            required_skills?: string[] | null;
            must_have_keywords?: string[] | null;
            exclusion_keywords?: string[] | null;
            excluded_companies?: string[] | null;
          }
        | null
        | undefined;

      // No deal criteria to filter against (fetch failed, or the role has no
      // required_skills/must_have_keywords set at all) -- fall back to
      // saving everything found, same as before this filter existed, rather
      // than blocking the whole command on a missing deal record.
      const relevant = deal
        ? deduped.filter((candidate) =>
            isCandidateRelevantToDeal(candidate, deal),
          )
        : deduped;
      const filteredCount = deduped.length - relevant.length;

      const toSave = relevant.slice(0, MAX_AUTO_SAVE);
      let savedCount = 0;
      // Agent H, sourcing sidebar (2026-07-21): the UI needs more than a
      // bare count to render result cards as candidates come in -- collect
      // the minimal display fields (name/title/company) for each candidate
      // that actually saved, rather than making the sidebar do a second
      // round-trip to re-fetch deal_candidates after the fact.
      const savedCandidates: Array<{
        id: number;
        fullName: string;
        title: string | null;
        company: string | null;
      }> = [];
      for (const candidate of toSave) {
        try {
          const result = await this.saveSourcedCandidate(dealId, candidate);
          savedCount += 1;
          savedCandidates.push({
            id: result.candidate_id,
            fullName: candidate.full_name ?? "Unnamed candidate",
            title: candidate.job_title ?? null,
            company: candidate.job_company_name ?? null,
          });
        } catch (error) {
          console.error(
            "continueSourcingForDeal: failed to save candidate",
            candidate.id,
            error,
          );
        }
      }

      return {
        foundCount: deduped.length,
        filteredCount,
        savedCount,
        savedCandidates,
        notes: [
          ...(freePortalResult?.notes ?? []),
          ...(exaResult?.notes ?? []),
        ],
      };
    },

    // Agent H, task #54 (2026-07-19): the recruiter-side counterpart to the
    // public candidate-application portal -- "a recruiter got a resume from
    // a job portal, email, or WhatsApp, and should be able to upload it
    // against the role". Calls upload-candidate-resume with a FormData body
    // (deal_id, full_name, email, phone, resume file) -- this rides the
    // recruiter's own session (functions.invoke attaches it automatically),
    // unlike the public submit-candidate-application path.
    async uploadCandidateResume(
      dealId: Identifier,
      details: {
        fullName: string;
        email?: string;
        phone?: string;
        resumeFile: File;
      },
    ) {
      const form = new FormData();
      form.set("deal_id", String(dealId));
      form.set("full_name", details.fullName);
      if (details.email) form.set("email", details.email);
      if (details.phone) form.set("phone", details.phone);
      form.set("resume", details.resumeFile);

      const { data, error } = await getSupabaseClient().functions.invoke<{
        status: "created" | "linked_existing";
        candidate_id: number;
      }>("upload-candidate-resume", { method: "POST", body: form });

      if (!data || error) {
        console.error("uploadCandidateResume.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(errorDetails?.error || "Failed to upload this resume");
      }

      return data;
    },

    // Agent H, task #56-59 (2026-07-19): bulk resume upload with auto-
    // parsing -- "more of Kharta's features", part 2. Unlike
    // uploadCandidateResume (one recruiter-typed name per file),
    // bulk-upload-candidate-resumes auto-parses each file's name/email/
    // phone from its own resume text via Claude, since typing details for
    // every file in a batch would defeat the point of a bulk upload.
    async bulkUploadCandidateResumes(dealId: Identifier, resumeFiles: File[]) {
      const form = new FormData();
      form.set("deal_id", String(dealId));
      for (const file of resumeFiles) form.append("resumes", file);

      const { data, error } = await getSupabaseClient().functions.invoke<{
        total: number;
        created: number;
        linked_existing: number;
        failed: number;
        results: Array<{
          filename: string;
          status: "created" | "linked_existing" | "failed";
          candidate_id?: number;
          parsed_name?: string | null;
          parsed_email?: string | null;
          error?: string;
        }>;
      }>("bulk-upload-candidate-resumes", { method: "POST", body: form });

      if (!data || error) {
        console.error("bulkUploadCandidateResumes.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(errorDetails?.error || "Failed to upload resumes");
      }

      return data;
    },

    async saveSourcedCandidate(
      roleBriefId: Identifier,
      candidate: Record<string, unknown>,
    ) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        status: "created" | "linked_existing";
        candidate_id: number;
      }>("save-sourced-candidate", {
        method: "POST",
        body: { role_brief_id: roleBriefId, candidate },
      });

      if (!data || error) {
        console.error("saveSourcedCandidate.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to save candidate",
        );
      }

      return data;
    },
    // Agent H Stage 3: calibration loop. Captures a recruiter's fit/not-fit
    // judgment (+ required reason) on one of the top Voyage-ranked
    // candidates shown before a full pull, keyed on this role brief (deal)
    // + the discovery vendor's candidate id. No dedicated edge function
    // needed -- this is a simple table write, same pattern as
    // getConfiguration/updateConfiguration below. candidateSnapshot is
    // whatever subset of the candidate object the review UI is showing
    // (title, company, location, skills, etc.), stored as-is so the
    // judgment stays interpretable even if the underlying vendor record
    // changes later.
    //
    // Vendor-neutral rename (2026-07-11 session): sourceId/source_id, not
    // pdlId/pdl_id -- Coresignal, not PDL, is the active discovery vendor
    // now (see migration agent_h_stage3_calibration_feedback_source_id_rename).
    async submitCalibrationFeedback(
      dealId: Identifier,
      sourceId: string,
      fit: boolean,
      reason: string,
      candidateSnapshot?: Record<string, unknown>,
    ) {
      const { data } = await baseDataProvider.create(
        "candidate_calibration_feedback",
        {
          data: {
            deal_id: dealId,
            source_id: sourceId,
            fit,
            reason,
            candidate_snapshot: candidateSnapshot ?? null,
          },
        },
      );
      return data;
    },
    // Agent H Stage 3: calibration loop. Fetches any calibration judgments
    // already recorded for a role brief, so the review UI can show "already
    // calibrated" state (e.g. after a page refresh) instead of asking the
    // recruiter to re-judge the same 3 candidates.
    async getCalibrationFeedback(dealId: Identifier) {
      const { data } = await baseDataProvider.getList(
        "candidate_calibration_feedback",
        {
          pagination: { page: 1, perPage: 50 },
          sort: { field: "created_at", order: "ASC" },
          filter: { deal_id: dealId },
        },
      );
      return data;
    },
    // Agent H Stage 3: the real calibration loop (2026-07-17). Sends a
    // "not a fit" reason to source-candidates-discovery's
    // calibration_contextualize mode, which uses Claude to decide whether
    // the reason implies a concrete, checkable search criterion and, if so,
    // computes the blast radius (how many candidates it would exclude) by
    // re-running a cheap Coresignal preview with/without the criterion --
    // see that edge function's handleCalibrationContextualize for the full
    // design. Nothing is persisted by this call; applying the suggested
    // criterion is a separate step (applyLearnedCriterion below), only
    // triggered when the recruiter reviews the blast radius and confirms.
    // Task #42 (2026-07-22): optional matchEvidence threads an X-ray
    // candidate's _match_evidence (why the query ladder's narrow-to-broad
    // widening surfaced this person -- e.g. "broadened to nearby metro
    // Bengaluru") into the same Claude call that interprets the rejection
    // reason. Undefined/omitted for calibration on non-X-ray candidates
    // (free-portal, Coresignal/PDL), which never carry this field --
    // see source-candidates-xray's header comment for where it originates.
    async contextualizeCalibrationFeedback(
      dealId: Identifier,
      reason: string,
      matchEvidence?: string | null,
    ) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
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
      }>("source-candidates-discovery", {
        method: "POST",
        body: {
          mode: "calibration_contextualize",
          deal_id: dealId,
          reason,
          ...(matchEvidence ? { match_evidence: matchEvidence } : {}),
        },
      });

      if (!data || error) {
        console.error("contextualizeCalibrationFeedback.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to interpret the rejection reason",
        );
      }

      return data;
    },
    // Agent H Stage 3: the real calibration loop. Persists a criterion the
    // recruiter reviewed (via contextualizeCalibrationFeedback) and decided
    // to apply -- a plain table write (schema
    // role_brief_learned_criteria), same "no dedicated edge function
    // needed" pattern as submitCalibrationFeedback above. Every future
    // search for this role brief will fold this criterion in (see
    // source-candidates-discovery's fetchLearnedCriteria) until it's
    // relaxed via relaxLearnedCriterion below.
    async applyLearnedCriterion(
      dealId: Identifier,
      criterion: {
        criterion_type:
          | "require_keyword"
          | "exclude_keyword"
          | "years_experience_min"
          | "years_experience_max";
        value: { keyword?: string; years?: number };
        label: string;
      },
      sourceFeedbackId?: Identifier | null,
    ) {
      const { data } = await baseDataProvider.create(
        "role_brief_learned_criteria",
        {
          data: {
            deal_id: dealId,
            criterion_type: criterion.criterion_type,
            value: criterion.value,
            label: criterion.label,
            source_feedback_id: sourceFeedbackId ?? null,
          },
        },
      );
      return data;
    },
    // Agent H Stage 3: the real calibration loop. Every learned criterion
    // for a role brief (active AND relaxed), so the Control Panel can show
    // full history and offer "Reapply" on a relaxed one, not just the
    // currently-active set.
    async getRoleBriefLearnedCriteria(dealId: Identifier) {
      const { data } = await baseDataProvider.getList(
        "role_brief_learned_criteria",
        {
          pagination: { page: 1, perPage: 100 },
          sort: { field: "created_at", order: "ASC" },
          filter: { deal_id: dealId },
        },
      );
      return data;
    },
    // Agent H Stage 3: the real calibration loop. Control Panel data --
    // current search total plus, for every learned criterion, its live
    // "N rejected" count (Noon-style), computed by source-candidates-
    // discovery's criteria_impact mode via cheap Coresignal preview calls.
    async getRoleBriefCriteriaImpact(dealId: Identifier) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        base_total: number | null;
        criteria: Array<{
          id: number;
          criterion_type: string;
          label: string;
          status: "active" | "relaxed";
          rejected_count: number | null;
        }>;
      }>("source-candidates-discovery", {
        method: "POST",
        body: { mode: "criteria_impact", deal_id: dealId },
      });

      if (!data || error) {
        console.error("getRoleBriefCriteriaImpact.error", error);
        throw new Error("Failed to compute criteria impact");
      }

      return data;
    },
    // Agent H Stage 3: the real calibration loop -- Noon's "Relax"/"Unlearn".
    // Turns a criterion off (excluded from future searches) without
    // deleting it, so its history and the option to Reapply stay available.
    async relaxLearnedCriterion(id: Identifier) {
      const { data } = await baseDataProvider.update(
        "role_brief_learned_criteria",
        { id, data: { status: "relaxed" }, previousData: { id } },
      );
      return data;
    },
    // Agent H Stage 3: the real calibration loop -- the reverse of Relax.
    // Turns a previously-relaxed criterion back on for future searches.
    async reapplyLearnedCriterion(id: Identifier) {
      const { data } = await baseDataProvider.update(
        "role_brief_learned_criteria",
        { id, data: { status: "active" }, previousData: { id } },
      );
      return data;
    },
    // Agent H Stage 3, candidate-visibility follow-up: every candidate
    // sourced/saved for a role brief, ranked best-match-first. Reads two
    // plain tables (deal_candidates, then candidates by id) rather than a
    // dedicated edge function or DB view -- same "just read the tables"
    // discipline as getCalibrationFeedback above, and there's no join-view
    // in the schema yet to lean on instead. Used by the role brief's
    // Candidates tab (DealShow.tsx) so a recruiter can trace "who did we
    // source for this JD" without leaving the role brief.
    async getCandidatesForDeal(
      dealId: Identifier,
    ): Promise<Array<{ dealCandidate: DealCandidate; candidate: Candidate }>> {
      const { data: links } = await baseDataProvider.getList<DealCandidate>(
        "deal_candidates",
        {
          pagination: { page: 1, perPage: 200 },
          sort: { field: "match_score", order: "DESC" },
          filter: { deal_id: dealId },
        },
      );
      if (links.length === 0) return [];

      const candidateIds = links.map((link) => link.candidate_id);
      const { data: candidates } = await baseDataProvider.getMany<Candidate>(
        "candidates",
        { ids: candidateIds },
      );
      const candidatesById = new Map(
        candidates.map((candidate) => [String(candidate.id), candidate]),
      );

      return links
        .map((dealCandidate) => {
          const candidate = candidatesById.get(
            String(dealCandidate.candidate_id),
          );
          return candidate ? { dealCandidate, candidate } : null;
        })
        .filter(
          (
            row,
          ): row is { dealCandidate: DealCandidate; candidate: Candidate } =>
            row !== null,
        );
    },
    // Agent H Stage 3, task #27: manual, on-demand contact-enrichment
    // waterfall (Hunter.io -> Apollo.io) for one already-saved candidate.
    // Calls enrich-candidate-contact -- never runs automatically on save or
    // on a discovery hit, only when a recruiter clicks "Enrich contact" on a
    // specific candidate (Harsha's explicit call, 2026-07-11 session).
    async enrichCandidateContact(candidateId: Identifier) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        status: "enriched" | "not_found" | "failed";
        source: "hunter" | "apollo" | null;
        email: string | null;
        notes: string[];
      }>("enrich-candidate-contact", {
        method: "POST",
        body: { candidate_id: Number(candidateId) },
      });

      if (!data || error) {
        console.error("enrichCandidateContact.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to enrich contact info",
        );
      }

      return data;
    },
    // Agent H Stage 3, checkpoint 3d / task #28: manual, on-demand GitHub +
    // Stack Overflow dev-signal enrichment for one already-saved candidate.
    // Same manual-trigger discipline as enrichCandidateContact. Best-effort
    // identity resolution, not guaranteed-correct -- see the edge
    // function's own header comment for why.
    async enrichCandidateDevSignals(candidateId: Identifier) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        status: "enriched" | "not_found" | "failed";
        github_url: string | null;
        github_corroborated: boolean | null;
        stackoverflow_url: string | null;
        stackoverflow_corroborated: boolean | null;
        notes: string[];
      }>("enrich-candidate-devsignals", {
        method: "POST",
        body: { candidate_id: Number(candidateId) },
      });

      if (!data || error) {
        console.error("enrichCandidateDevSignals.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to enrich dev signals",
        );
      }

      return data;
    },
    // Agent H Stage 3, task #75: manual, on-demand FULL profile enrichment
    // (Coresignal Collect -> PDL Enrich fallback) for one already-saved
    // candidate. This is the deliberately-expensive step that gets the
    // complete LinkedIn-style record -- full experience history (each job's
    // own company details), education, certifications, languages, skills --
    // not just the plain fields the cheap discovery search returns. Same
    // manual-trigger discipline as enrichCandidateContact/DevSignals: only
    // runs when a recruiter explicitly clicks "View full profile" on one
    // specific candidate, never automatically.
    async enrichCandidateWorkHistory(candidateId: Identifier) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        status: "enriched" | "not_found" | "failed";
        source: "coresignal_collect" | "pdl_enrich" | null;
        experience_count: number;
        education_count: number;
        notes: string[];
      }>("enrich-candidate-workhistory", {
        method: "POST",
        body: { candidate_id: Number(candidateId) },
      });

      if (!data || error) {
        console.error("enrichCandidateWorkHistory.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to fetch full profile",
        );
      }

      return data;
    },
    // Companion read for the above: pulls the stored full profile straight
    // from public.candidates (no vendor call, no cost) -- used both right
    // after a fresh enrichCandidateWorkHistory call, and to show an
    // already-enriched profile again later without re-spending a credit.
    async getCandidateFullProfile(candidateId: Identifier) {
      const { data } = await baseDataProvider.getOne("candidates", {
        id: candidateId,
      });
      return data as {
        full_profile_status: string | null;
        full_profile_source: string | null;
        full_profile_raw: Record<string, unknown> | null;
        full_profile_updated_at: string | null;
        work_history: Array<{
          title: string | null;
          company: string | null;
          date_from: string | null;
          date_to: string | null;
          duration_months: number | null;
          description: string | null;
        }> | null;
      };
    },
    // Agent H Stage 4, task #75 (Screening): manual, on-demand scoring of
    // one already-saved candidate against one specific role brief (deal) --
    // calls score-candidate, a port of Kharta's real scoring engine (see
    // that function's own header comment for the full "why" and what's
    // ported verbatim vs. adapted). Never runs automatically; only when a
    // recruiter explicitly asks to screen a candidate against a role.
    async scoreCandidate(candidateId: Identifier, dealId: Identifier) {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "score-candidate",
        {
          method: "POST",
          body: { candidate_id: Number(candidateId), deal_id: Number(dealId) },
        },
      );

      if (!data || error) {
        console.error("scoreCandidate.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to score candidate",
        );
      }

      return data;
    },
    // On-demand must-haves evidence for a not-yet-saved discovery hit.
    // Calls score-candidate in evidence_only mode (same must_haves_check
    // prompt, no candidate_scores row written).
    async scoreDiscoveryEvidence(
      dealId: Identifier,
      discoveryCandidate: Record<string, unknown>,
    ) {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "score-candidate",
        {
          method: "POST",
          body: {
            deal_id: Number(dealId),
            evidence_only: true,
            discovery_candidate: discoveryCandidate,
          },
        },
      );

      if (!data || error) {
        console.error("scoreDiscoveryEvidence.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to load match evidence",
        );
      }

      return data as {
        must_haves_check: Array<{
          requirement: string;
          status: "found" | "inferred" | "absent";
          confidence: "high" | "medium" | "low";
        }>;
      };
    },
    // Companion read: pulls an already-computed score straight from
    // public.candidate_scores (no vendor/model call, no cost) -- same
    // "read what's stored, only re-run on explicit request" pattern as
    // getCandidateFullProfile.
    async getCandidateScore(candidateId: Identifier, dealId: Identifier) {
      const { data } = await baseDataProvider.getList("candidate_scores", {
        pagination: { page: 1, perPage: 1 },
        sort: { field: "created_at", order: "DESC" },
        filter: { candidate_id: candidateId, deal_id: dealId },
      });
      return (data as any[])?.[0] ?? null;
    },
    // Agent H Stage 3: Sourcing -- LinkedIn-stage holistic fit assessment.
    // Deliberately NOT a numeric score -- see assess-candidate-fit's own
    // header comment for the full reasoning (Kharta's scoring math was
    // calibrated against resumes, and applying it to LinkedIn's much
    // thinner, untailored data risks punishing under-documentation as if
    // it were a real skill gap). Kept side by side with scoreCandidate,
    // Harsha's explicit call, so the two approaches can be compared
    // directly on real candidates rather than one replacing the other.
    async assessCandidateFit(candidateId: Identifier, dealId: Identifier) {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "assess-candidate-fit",
        {
          method: "POST",
          body: { candidate_id: Number(candidateId), deal_id: Number(dealId) },
        },
      );

      if (!data || error) {
        console.error("assessCandidateFit.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to assess candidate fit",
        );
      }

      return data;
    },
    // Companion read: pulls an already-computed fit assessment straight
    // from public.candidate_fit_assessments (no model call, no cost) --
    // same "read what's stored, only re-run on explicit request" pattern
    // as getCandidateScore/getCandidateFullProfile.
    async getCandidateFitAssessment(
      candidateId: Identifier,
      dealId: Identifier,
    ) {
      const { data } = await baseDataProvider.getList(
        "candidate_fit_assessments",
        {
          pagination: { page: 1, perPage: 1 },
          sort: { field: "created_at", order: "DESC" },
          filter: { candidate_id: candidateId, deal_id: dealId },
        },
      );
      return (data as any[])?.[0] ?? null;
    },
    // Agent H Stage 5: Scheduling -- draft a booking link + email preview
    // (no Resend call, no interviews upsert). Recruiter approves, then
    // sendBookingLink fires the actual email.
    async prepareBookingLink(candidateId: Identifier, dealId: Identifier) {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "prepare-booking-link",
        {
          method: "POST",
          body: { candidate_id: Number(candidateId), deal_id: Number(dealId) },
        },
      );

      if (!data || error) {
        console.error("prepareBookingLink.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to prepare booking link",
        );
      }

      return data;
    },
    async sendBookingLink(
      candidateId: Identifier,
      dealId: Identifier,
      payload: {
        booking_link_url: string;
        subject?: string;
        html?: string;
      },
    ) {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "send-booking-link",
        {
          method: "POST",
          body: {
            candidate_id: Number(candidateId),
            deal_id: Number(dealId),
            booking_link_url: payload.booking_link_url,
            subject: payload.subject,
            html: payload.html,
          },
        },
      );

      if (!data || error) {
        console.error("sendBookingLink.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to send booking link",
        );
      }

      return data;
    },
    /** @deprecated Use prepareBookingLink + sendBookingLink after recruiter approval. */
    async createBookingLink(candidateId: Identifier, dealId: Identifier) {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "create-booking-link",
        {
          method: "POST",
          body: { candidate_id: Number(candidateId), deal_id: Number(dealId) },
        },
      );

      if (!data || error) {
        console.error("createBookingLink.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to create booking link",
        );
      }

      return data;
    },
    // Companion read: pulls the current booking state straight from
    // public.interviews (no Cal.com call) -- same "read what's stored"
    // pattern as getCandidateScore/getCandidateFitAssessment. Cal.com's own
    // webhooks (not this app) are what keep this row's status/scheduled_at
    // current once a candidate actually books.
    async getCandidateInterview(candidateId: Identifier, dealId: Identifier) {
      const { data } = await baseDataProvider.getList("interviews", {
        pagination: { page: 1, perPage: 1 },
        sort: { field: "updated_at", order: "DESC" },
        filter: { candidate_id: candidateId, deal_id: dealId },
      });
      return (data as any[])?.[0] ?? null;
    },
    // Agent H, task 76: draft resume-request email preview (no send).
    async prepareRequestResume(candidateId: Identifier, dealId: Identifier) {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "prepare-request-resume",
        {
          method: "POST",
          body: { candidate_id: Number(candidateId), deal_id: Number(dealId) },
        },
      );

      if (!data || error) {
        console.error("prepareRequestResume.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to prepare resume request",
        );
      }

      return data;
    },
    // Agent H, task 76: send resume request after recruiter approves preview.
    async requestCandidateResume(
      candidateId: Identifier,
      dealId: Identifier,
      approvedEmail: { subject: string; html: string },
    ) {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "request-candidate-resume",
        {
          method: "POST",
          body: {
            candidate_id: Number(candidateId),
            deal_id: Number(dealId),
            subject: approvedEmail.subject,
            html: approvedEmail.html,
          },
        },
      );

      if (!data || error) {
        console.error("requestCandidateResume.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to request resume",
        );
      }

      return data;
    },
    // Companion read: pulls the candidate's current resume_status straight
    // from public.candidates (no email/vendor call) -- same "read what's
    // stored" pattern as getCandidateScore/getCandidateInterview. A reply
    // only arrives once the candidate actually checks their email and
    // responds, so this is meant to be called on a manual "Check for resume"
    // click, not immediately after requestCandidateResume.
    async getCandidateResumeInfo(candidateId: Identifier) {
      const { data } = await baseDataProvider.getOne("candidates", {
        id: candidateId,
      });
      return data as {
        resume_status: "not_requested" | "requested" | "received";
        resume_original_filename: string | null;
        resume_received_at: string | null;
        resume_reply_text: string | null;
      };
    },
    // Agent H Phase 4: prepare first outreach — detect channel (LinkedIn
    // connection/InMail or email fallback), resolve Unipile provider_id,
    // draft message with Claude, check daily cap. Returns preview for
    // recruiter approval before send is called (Phase C).
    async prepareFirstOutreach(candidateId: Identifier, dealId: Identifier) {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "prepare-first-outreach",
        {
          method: "POST",
          body: { candidate_id: Number(candidateId), deal_id: Number(dealId) },
        },
      );

      if (!data || error) {
        console.error("prepareFirstOutreach.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to prepare outreach",
        );
      }

      return data as {
        channel: "email" | "linkedin_connection" | "linkedin_inmail";
        linkedin_provider_id: string | null;
        message_body: string | null;
        char_count: number | null;
        is_open_profile: boolean | null;
        cap_remaining: number | null;
        drafted_by: "claude" | "fallback_template";
        email_preview: {
          to: string;
          reply_to?: string;
          subject: string;
          html: string;
        } | null;
      };
    },

    // Agent H, Stage 1: Outreach — send first outreach after recruiter
    // approval (Phase C). Now accepts channel + approved message body for
    // LinkedIn path; falls back to email when channel is omitted or "email".
    async sendFirstOutreach(
      candidateId: Identifier,
      dealId: Identifier,
      opts?: {
        channel?: "email" | "linkedin_connection" | "linkedin_inmail";
        message_body?: string;
        linkedin_provider_id?: string;
        subject?: string;
        html?: string;
      },
    ) {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "send-first-outreach",
        {
          method: "POST",
          body: {
            candidate_id: Number(candidateId),
            deal_id: Number(dealId),
            ...(opts ?? {}),
          },
        },
      );

      if (!data || error) {
        console.error("sendFirstOutreach.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to send outreach",
        );
      }

      return data;
    },
    // Agent H Stage 6: Offer -- draft email preview + offers row (status
    // draft). sendOffer sends via Resend only after recruiter approval.
    async prepareOffer(
      candidateId: Identifier,
      dealId: Identifier,
      terms: {
        position_title: string;
        compensation_amount?: number | null;
        compensation_currency?: string;
        compensation_frequency?: "annual" | "monthly";
        start_date?: string | null;
        expiry_date?: string | null;
        benefits_summary?: string | null;
      },
    ) {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "prepare-offer",
        {
          method: "POST",
          body: {
            candidate_id: Number(candidateId),
            deal_id: Number(dealId),
            ...terms,
          },
        },
      );

      if (!data || error) {
        console.error("prepareOffer.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to prepare offer",
        );
      }

      return data;
    },
    async sendOffer(
      candidateId: Identifier,
      dealId: Identifier,
      approvedEmail: { subject: string; html: string },
    ) {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "send-offer",
        {
          method: "POST",
          body: {
            candidate_id: Number(candidateId),
            deal_id: Number(dealId),
            subject: approvedEmail.subject,
            html: approvedEmail.html,
          },
        },
      );

      if (!data || error) {
        console.error("sendOffer.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to send offer",
        );
      }

      return data;
    },
    // Companion read: pulls the current offer state straight from
    // public.offers (no email/vendor call) -- same "read what's stored"
    // pattern as getCandidateInterview/getCandidateResumeInfo. A reply only
    // arrives once the candidate actually checks their email and responds.
    async getCandidateOffer(candidateId: Identifier, dealId: Identifier) {
      const { data } = await baseDataProvider.getList("offers", {
        pagination: { page: 1, perPage: 1 },
        sort: { field: "updated_at", order: "DESC" },
        filter: { candidate_id: candidateId, deal_id: dealId },
      });
      return (data as any[])?.[0] ?? null;
    },
    // Agent H Stage 6: a recruiter's manual call, made after reading
    // response_text -- offers.status never guesses accepted/declined/
    // negotiating on its own (see the migration's comment on this column),
    // so this is the only path that sets those three values.
    async updateOfferStatus(
      offerId: Identifier,
      status: "accepted" | "declined" | "negotiating" | "expired",
    ) {
      const { data } = await baseDataProvider.update("offers", {
        id: offerId,
        data: { status },
        previousData: { id: offerId },
      });
      return data;
    },
    // Phase C: recruiter-authored turn in the shared role transcript.
    // See docs/adr/ADR-617f-phase-c-human-in-the-loop-approval.md
    async createRoleConversationTurn(
      dealId: Identifier,
      turn: {
        content: string;
        metadata?: Record<string, unknown>;
        in_reply_to?: Identifier | null;
        idempotency_key?: string | null;
      },
    ) {
      const { data } = await baseDataProvider.create(
        "role_conversation_turns",
        {
          data: {
            deal_id: Number(dealId),
            speaker: "recruiter",
            content: turn.content,
            metadata: turn.metadata ?? {},
            in_reply_to: turn.in_reply_to ?? null,
            idempotency_key: turn.idempotency_key ?? null,
          },
        },
      );
      return data;
    },
    async appendAgentConversationTurn(
      dealId: Identifier,
      turn: {
        content: string;
        metadata?: Record<string, unknown>;
        in_reply_to?: Identifier | null;
        idempotency_key?: string | null;
      },
    ) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        turn: Record<string, unknown>;
      }>("append-agent-conversation-turn", {
        method: "POST",
        body: {
          deal_id: Number(dealId),
          content: turn.content,
          metadata: turn.metadata ?? {},
          in_reply_to: turn.in_reply_to ?? null,
          idempotency_key: turn.idempotency_key ?? null,
        },
      });

      if (!data?.turn || error) {
        console.error("appendAgentConversationTurn.error", error);
        throw new Error(
          "Failed to record the agent's reply in the transcript.",
        );
      }

      return data.turn;
    },
    // Agent H Unipile Phase 3: LinkedIn hosted auth + checkpoint handling.
    async createUnipileHostedAuthLink(reconnect = false) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        url: string;
        expires_on?: string;
      }>("create-unipile-hosted-auth-link", {
        method: "POST",
        body: { reconnect },
      });

      if (!data?.url || error) {
        console.error("createUnipileHostedAuthLink.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to start LinkedIn connection",
        );
      }

      return data;
    },
    async getUnipileLinkedInAccount() {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "get-unipile-linkedin-account",
        { method: "POST", body: {} },
      );

      if (!data || error) {
        console.error("getUnipileLinkedInAccount.error", error);
        throw new Error("Failed to load LinkedIn connection status");
      }

      return data;
    },
    async solveUnipileCheckpoint(code: string, tryAnotherWay = false) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        status: string;
        checkpoint_type?: string;
        seat_type?: string;
        message?: string;
      }>("solve-unipile-checkpoint", {
        method: "POST",
        body: { code, try_another_way: tryAnotherWay },
      });

      if (!data || error) {
        console.error("solveUnipileCheckpoint.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(
          errorDetails?.message ||
            errorDetails?.error ||
            "Failed to verify LinkedIn checkpoint",
        );
      }

      return data;
    },
    // Agent H, Triage Inbox + Command Canvas: classifies command-bar free
    // text into one of the app's real supported actions via parse-agent-
    // command (Claude Haiku tool-use). Has no side effects itself -- the
    // caller dispatches the returned action to the actual dataProvider
    // methods (sourceFreePortalCandidates, relaxLearnedCriterion, etc).
    async parseAgentCommand(
      commandText: string,
      context: {
        view: "inbox" | "canvas";
        open_deals: Array<{ id: Identifier; name: string }>;
        current_deal_id?: Identifier | null;
        active_criteria?: Array<{ id: Identifier; label: string }>;
        selected_candidate_count?: number;
        selected_candidates?: Array<{ id: Identifier; name: string }>;
        pipeline_candidates?: Array<{ id: Identifier; name: string }>;
      },
    ) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        action:
          | "create_role"
          | "continue_sourcing"
          | "relax_criterion"
          | "request_resume"
          | "reject_candidates"
          | "show_candidates"
          | "show_roles"
          | "send_first_outreach"
          | "send_offer"
          | "send_booking_link"
          | "unknown";
        deal_id: number | null;
        criterion_id: number | null;
        candidate_id: number | null;
        use_selected_candidates: boolean;
        explanation: string;
      }>("parse-agent-command", {
        method: "POST",
        body: { command_text: commandText, context },
      });

      if (!data || error) {
        console.error("parseAgentCommand.error", error);
        throw new Error("Agent H couldn't understand that command right now.");
      }
      return data;
    },
    // Agent H, Triage Canvas: "Reject" action. deal_candidates has no
    // status column (see its own type comment), so rejecting a sourced
    // candidate means removing the link entirely rather than flipping a
    // flag. Returns the deleted row so the UI can offer Undo by re-creating
    // an identical link (see undoRejectDealCandidate below).
    async rejectDealCandidate(dealCandidateId: Identifier) {
      const { data } = await baseDataProvider.delete("deal_candidates", {
        id: dealCandidateId,
        previousData: { id: dealCandidateId },
      });
      return data as DealCandidate;
    },
    // Agent H, Triage Canvas: the Undo half of rejectDealCandidate --
    // re-creates the link with the same deal/candidate/match_score/
    // sourced_via so the candidate reappears exactly where it was.
    async undoRejectDealCandidate(rejected: DealCandidate) {
      const { data } = await baseDataProvider.create("deal_candidates", {
        data: {
          deal_id: rejected.deal_id,
          candidate_id: rejected.candidate_id,
          sourced_via: rejected.sourced_via,
          match_score: rejected.match_score,
        },
      });
      return data as DealCandidate;
    },
    // Agent H: configuration is now one row per tenant (not Atomic's
    // original single global row with a hardcoded id of 1 -- see
    // supabase/schemas/12_agent_h_configuration_per_tenant.sql). RLS already
    // scopes the "configuration" table to the current tenant, so fetching
    // "whichever row I'm allowed to see" always returns the right one,
    // without the frontend needing to know its own tenant_id up front.
    async getConfiguration(): Promise<ConfigurationContextValue> {
      const { data } = await baseDataProvider.getList("configuration", {
        pagination: { page: 1, perPage: 1 },
        sort: { field: "id", order: "ASC" },
        filter: {},
      });
      return (data?.[0]?.config as ConfigurationContextValue) ?? {};
    },
    async updateConfiguration(
      config: ConfigurationContextValue,
    ): Promise<ConfigurationContextValue> {
      const { data: existing } = await baseDataProvider.getList(
        "configuration",
        {
          pagination: { page: 1, perPage: 1 },
          sort: { field: "id", order: "ASC" },
          filter: {},
        },
      );
      const existingRow = existing?.[0];

      if (!existingRow) {
        // First time this tenant is saving settings -- no row exists yet.
        const { data } = await baseDataProvider.create("configuration", {
          data: { config },
        });
        return data.config as ConfigurationContextValue;
      }

      const { data } = await baseDataProvider.update("configuration", {
        id: existingRow.id,
        data: { config },
        previousData: existingRow,
      });
      return data.config as ConfigurationContextValue;
    },
  } satisfies DataProvider;
};

export type CrmDataProvider = ReturnType<
  typeof getDataProviderWithCustomMethods
>;

const processConfigLogo = async (logo: any): Promise<string> => {
  if (typeof logo === "string") return logo;
  if (logo?.rawFile instanceof File) {
    await uploadToBucket(logo);
    return logo.src;
  }
  return logo?.src ?? "";
};

const lifeCycleCallbacks: ResourceCallbacks[] = [
  {
    resource: "configuration",
    beforeUpdate: async (params) => {
      const config = params.data.config;
      if (config) {
        config.lightModeLogo = await processConfigLogo(config.lightModeLogo);
        config.darkModeLogo = await processConfigLogo(config.darkModeLogo);
      }
      return params;
    },
  },
  {
    resource: "contact_notes",
    beforeSave: async (data: ContactNote, _, __) => {
      if (data.attachments) {
        data.attachments = await Promise.all(
          data.attachments.map((fi) => uploadToBucket(fi)),
        );
      }
      return data;
    },
  },
  {
    resource: "deal_notes",
    beforeSave: async (data: DealNote, _, __) => {
      if (data.attachments) {
        data.attachments = await Promise.all(
          data.attachments.map((fi) => uploadToBucket(fi)),
        );
      }
      return data;
    },
  },
  {
    resource: "sales",
    beforeSave: async (data: Sale, _, __) => {
      if (data.avatar) {
        await uploadToBucket(data.avatar);
      }
      return data;
    },
  },
  {
    resource: "contacts",
    beforeGetList: async (params) => {
      return applyFullTextSearch([
        "first_name",
        "last_name",
        "company_name",
        "title",
        "email",
        "phone",
        "background",
      ])(params);
    },
  },
  {
    resource: "companies",
    beforeGetList: async (params) => {
      return applyFullTextSearch([
        "name",
        "phone_number",
        "website",
        "zipcode",
        "city",
        "state_abbr",
      ])(params);
    },
    beforeCreate: async (params) => {
      const createParams = await processCompanyLogo(params);

      return {
        ...createParams,
        data: {
          created_at: new Date().toISOString(),
          ...createParams.data,
        },
      };
    },
    beforeUpdate: async (params) => {
      return await processCompanyLogo(params);
    },
  },
  {
    resource: "contacts_summary",
    beforeGetList: async (params) => {
      return applyFullTextSearch(["first_name", "last_name"])(params);
    },
  },
  {
    resource: "deals",
    beforeGetList: async (params) => {
      return applyFullTextSearch(["name", "category", "description"])(params);
    },
  },
];

export const getDataProvider = () => {
  if (import.meta.env.VITE_SUPABASE_URL === undefined) {
    throw new Error("Please set the VITE_SUPABASE_URL environment variable");
  }
  if (import.meta.env.VITE_SB_PUBLISHABLE_KEY === undefined) {
    throw new Error(
      "Please set the VITE_SB_PUBLISHABLE_KEY environment variable",
    );
  }
  return withLifecycleCallbacks(
    getDataProviderWithCustomMethods(),
    lifeCycleCallbacks,
  ) as CrmDataProvider;
};

const applyFullTextSearch = (columns: string[]) => (params: GetListParams) => {
  if (!params.filter?.q) {
    return params;
  }
  const { q, ...filter } = params.filter;
  return {
    ...params,
    filter: {
      ...filter,
      "@or": columns.reduce((acc, column) => {
        if (column === "email")
          return {
            ...acc,
            [`email_fts@ilike`]: q,
          };
        if (column === "phone")
          return {
            ...acc,
            [`phone_fts@ilike`]: q,
          };
        else
          return {
            ...acc,
            [`${column}@ilike`]: q,
          };
      }, {}),
    },
  };
};

const uploadToBucket = async (fi: RAFile) => {
  if (!fi.src.startsWith("blob:") && !fi.src.startsWith("data:")) {
    // Sign URL check if path exists in the bucket
    if (fi.path) {
      const { error } = await getSupabaseClient()
        .storage.from(ATTACHMENTS_BUCKET)
        .createSignedUrl(fi.path, 60);

      if (!error) {
        return fi;
      }
    }
  }

  const dataContent = fi.src
    ? await fetch(fi.src)
        .then((res) => {
          if (res.status !== 200) {
            return null;
          }
          return res.blob();
        })
        .catch(() => null)
    : fi.rawFile;

  if (dataContent == null) {
    // We weren't able to download the file from its src (e.g. user must be signed in on another website to access it)
    // or the file has no content (not probable)
    // In that case, just return it as is: when trying to download it, users should be redirected to the other website
    // and see they need to be signed in. It will then be their responsibility to upload the file back to the note.
    return fi;
  }

  const file = fi.rawFile;
  const fileParts = file.name.split(".");
  const fileExt = fileParts.length > 1 ? `.${file.name.split(".").pop()}` : "";
  const fileName = `${Math.random()}${fileExt}`;
  const filePath = `${fileName}`;
  const { error: uploadError } = await getSupabaseClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .upload(filePath, dataContent);

  if (uploadError) {
    console.error("uploadError", uploadError);
    throw new Error("Failed to upload attachment");
  }

  const { data } = getSupabaseClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .getPublicUrl(filePath);

  fi.path = filePath;
  fi.src = data.publicUrl;

  // save MIME type
  const mimeType = file.type;
  fi.type = mimeType;

  return fi;
};
