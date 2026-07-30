// Agent H Stage 2: JD Intake.
//
// Paste a job description, parse it into a structured role brief via
// dataProvider.parseJobDescription (which calls the parse-job-description
// edge function), review/edit the extracted fields, then save it as a
// role brief (a public.deals row -- see
// supabase/schemas/15_agent_h_structured_role_brief_fields.sql for why
// deals rather than a new table).
//
// Deliberately not built as a react-admin <Create> form: the two-phase
// "parse, then review/edit, then save" flow doesn't map cleanly onto a
// single-submit form, so this page manages its own local state and calls
// the data provider directly.

import { useState } from "react";
import { useDataProvider, useGetList, useNotify, useRedirect } from "ra-core";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { CrmDataProvider } from "../providers/types";
import { AgentHShell } from "../shell/AgentHShell";
import { useJdIntakeShellContext } from "../shell/useShellContext";
import type {
  Deal,
  SearchIntentCondition,
  UnenforcedConstraint,
} from "../types";
import { SearchIntentEditor } from "../roles/SearchIntentEditor";
import { parsedBriefToConditions } from "./parsedBriefToConditions";
import "../inbox/agent-h-theme.css";

const SENIORITY_OPTIONS = [
  "intern",
  "entry_level",
  "mid_level",
  "senior",
  "staff",
  "principal",
  "manager",
  "director",
  "executive",
];

const EMPLOYMENT_TYPE_OPTIONS = [
  "full_time",
  "part_time",
  "contract",
  "contract_to_hire",
  "internship",
];

// Agent H, tiered preferences (2026-07-22): a JD like Epiq's -- "PRIMARY
// PREFERENCE: X... SECONDARY/ACCEPTABLE: Y..." -- describes a ranked
// fallback profile, not a single flat requirement set. Kept separate from
// must_have_keywords so the review UI can show "Primary preference" and
// "Secondary / acceptable" as distinct groups instead of one run-on
// sentence. Empty array is the common case (flat JD, no ranking).
type PreferenceTier = {
  rank: number;
  label: string;
  keywords: string[];
  condition: string | null;
};

type ParsedRoleBrief = {
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
  preference_tiers: PreferenceTier[];
  // Ambiguities the parser flagged worth confirming before sourcing starts
  // (task #30). Read-only/dismissible advisory, not a back-and-forth
  // conversation -- see parse-job-description's header comment for why.
  clarifying_questions: string[];
  // Agent H: sourcing preferences, not JD facts -- these describe which
  // companies to pull CANDIDATES from, the opposite direction of
  // `industry` (which is inferred from the JD's own hiring company).
  // Never LLM-extracted from jd_text for that reason; the recruiter fills
  // these in at review time, same as the exclusion fields below.
  company_type: string | null;
  company_size_min: number | null;
  company_size_max: number | null;
  // Recruiter-entered hard excludes. Deliberately not parsed from the JD
  // either -- a JD describing the role essentially never names companies
  // or terms to avoid; that's sourcing judgment, not a JD fact.
  excluded_companies: string[];
  exclusion_keywords: string[];
  // Past-position search (2026-07-22): same "recruiter sourcing judgment,
  // never JD-parsed" treatment as excluded_companies/exclusion_keywords
  // above -- a JD describing the role being hired for doesn't name past
  // titles or employers a good candidate might have; that's the
  // recruiter's own sourcing intuition ("someone who used to be a Founding
  // Engineer," "worked at Microsoft at some point"). Boosts matches in
  // source-candidates-discovery's Coresignal query rather than requiring
  // them -- see that function's DiscoveryCriteria.pastTitles/pastCompanies.
  past_titles: string[];
  past_companies: string[];
};

const arrayToText = (values: string[] | undefined) => (values ?? []).join(", ");

const textToArray = (value: string) =>
  value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

export const JdIntakePage = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const redirect = useRedirect();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: openDeals } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 20 },
    sort: { field: "updated_at", order: "DESC" },
    filter: { "archived_at@is": null },
  });

  const [jdText, setJdText] = useState("");
  const [jdExpanded, setJdExpanded] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parsed, setParsed] = useState<ParsedRoleBrief | null>(null);
  // SearchIntent chip state — seeded from parsed brief, editable before save.
  const [intentConditions, setIntentConditions] = useState<
    SearchIntentCondition[]
  >([]);
  const [intentUnenforceable, setIntentUnenforceable] = useState<
    UnenforcedConstraint[]
  >([]);
  const [pastTitlesText, setPastTitlesText] = useState("");
  const [pastCompaniesText, setPastCompaniesText] = useState("");
  // Local-only until save -- the recruiter can dismiss the clarifying-
  // questions advisory during review; clarifying_questions_dismissed is
  // persisted as-is at create time so it doesn't resurface on the role
  // brief's own detail view.
  const [questionsDismissed, setQuestionsDismissed] = useState(false);

  const shellContext = useJdIntakeShellContext({
    parsedTitle: parsed?.title,
    hasJdText: jdText.trim().length > 0,
    isParsing: parsing,
    isSaving: saving,
  });

  const runFreeTextCommand = async (commandText: string) => {
    try {
      const command = await dataProvider.parseAgentCommand(commandText, {
        view: "inbox",
        open_deals: (openDeals ?? []).map((d) => ({ id: d.id, name: d.name })),
        current_deal_id: null,
      });

      if (command.action === "create_role") {
        toast(command.explanation);
      } else if (
        command.action === "continue_sourcing" &&
        command.deal_id != null
      ) {
        const dealName =
          openDeals?.find((d) => d.id === command.deal_id)?.name ?? "that role";
        const result = await dataProvider.continueSourcingForDeal(
          command.deal_id,
        );
        queryClient.invalidateQueries({ queryKey: ["inbox_per_deal_signals"] });
        const filteredNote =
          result.filteredCount > 0
            ? `, ${result.filteredCount} filtered as not relevant`
            : "";
        toast.success(
          `${dealName}: found ${result.foundCount} candidate${result.foundCount === 1 ? "" : "s"}${filteredNote} — open the role to add to pipeline`,
        );
      } else if (
        command.action === "relax_criterion" &&
        command.criterion_id != null
      ) {
        await dataProvider.relaxLearnedCriterion(command.criterion_id);
        queryClient.invalidateQueries({ queryKey: ["inbox_per_deal_signals"] });
        toast.success("Criterion relaxed");
      } else if (
        command.action === "show_candidates" &&
        command.deal_id != null
      ) {
        navigate(`/roles/${command.deal_id}`);
      } else if (command.action === "show_roles") {
        navigate("/");
      } else if (command.action === "refine_search_intent") {
        if (command.deal_id == null) {
          toast(
            "Please mention which role to adjust, or open a specific role first.",
          );
        } else {
          await dataProvider.refineSearchIntent(command.deal_id, commandText);
          queryClient.invalidateQueries({
            queryKey: ["deals", command.deal_id],
          });
          toast.success(command.explanation);
        }
      } else {
        toast(command.explanation);
      }
    } catch {
      toast.error("Couldn't run that command");
    }
  };

  const handleParse = async () => {
    if (!jdText.trim()) {
      notify("Paste a job description first", { type: "warning" });
      return;
    }
    setParsing(true);
    try {
      const result = await dataProvider.parseJobDescription(jdText);
      const brief: ParsedRoleBrief = {
        ...result,
        preference_tiers: result.preference_tiers ?? [],
        clarifying_questions: result.clarifying_questions ?? [],
        company_type: null,
        company_size_min: null,
        company_size_max: null,
        excluded_companies: [],
        exclusion_keywords: [],
        past_titles: [],
        past_companies: [],
      };
      setParsed(brief);
      setJdExpanded(false); // collapse JD textarea after parse
      // Seed chip editor from parsed brief.
      setIntentConditions(parsedBriefToConditions(brief));
      setIntentUnenforceable([]);
      setPastTitlesText("");
      setPastCompaniesText("");
      setQuestionsDismissed(false);
      notify("Job description parsed — review your sourcing criteria below", {
        type: "success",
      });
    } catch (error: any) {
      notify(error?.message || "Failed to parse job description", {
        type: "error",
      });
    } finally {
      setParsing(false);
    }
  };

  const updateParsed = (patch: Partial<ParsedRoleBrief>) => {
    setParsed((current) => (current ? { ...current, ...patch } : current));
  };

  const updateTier = (rank: number, patch: Partial<PreferenceTier>) => {
    setParsed((current) => {
      if (!current) return current;
      return {
        ...current,
        preference_tiers: current.preference_tiers.map((tier) =>
          tier.rank === rank ? { ...tier, ...patch } : tier,
        ),
      };
    });
  };

  // Create the deal and save the SearchIntent chips.
  const createDealAndSaveIntent = async (
    conditions: SearchIntentCondition[],
    unenforced: UnenforcedConstraint[],
  ) => {
    if (!parsed) return null;
    setSaving(true);
    try {
      const created = await dataProvider.create("deals", {
        data: {
          name: parsed.title,
          stage: "sourcing",
          jd_text: jdText,
          seniority: parsed.seniority,
          location: parsed.location,
          industry: parsed.industry,
          employment_type: parsed.employment_type,
          years_experience_min: parsed.years_experience_min,
          years_experience_max: parsed.years_experience_max,
          company_type: parsed.company_type,
          company_size_min: parsed.company_size_min,
          company_size_max: parsed.company_size_max,
          past_titles: textToArray(pastTitlesText),
          past_companies: textToArray(pastCompaniesText),
          preference_tiers:
            parsed.preference_tiers.length > 0 ? parsed.preference_tiers : null,
          clarifying_questions:
            parsed.clarifying_questions.length > 0
              ? parsed.clarifying_questions
              : null,
          clarifying_questions_dismissed: questionsDismissed,
          role_status: "new",
          contact_ids: [],
          // Flat keyword fields as fallback — overwritten by saveSearchIntent below.
          required_skills: conditions
            .filter(
              (c) => c.category === "skill" && c.disposition === "require",
            )
            .map((c) => c.value),
          must_have_keywords: conditions
            .filter(
              (c) => c.category === "skill" && c.disposition === "require",
            )
            .map((c) => c.value),
          nice_to_have_keywords: conditions
            .filter((c) => c.category === "skill" && c.disposition === "prefer")
            .map((c) => c.value),
          excluded_companies: conditions
            .filter(
              (c) => c.category === "company" && c.disposition === "exclude",
            )
            .map((c) => c.value),
          exclusion_keywords: conditions
            .filter(
              (c) => c.category === "title" && c.disposition === "exclude",
            )
            .map((c) => c.value),
        },
      });

      const newDealId = created.data.id;

      // Persist the chips as the canonical SearchIntent (versioned, no LLM).
      await dataProvider.saveSearchIntent(newDealId, conditions, unenforced);

      notify("Role brief created", { type: "success" });
      return newDealId;
    } catch (error: any) {
      notify(error?.message || "Failed to create the role brief", {
        type: "error",
      });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (
    conditions: SearchIntentCondition[],
    unenforced: UnenforcedConstraint[],
  ) => {
    const dealId = await createDealAndSaveIntent(conditions, unenforced);
    if (dealId != null) redirect(`/roles/${dealId}`);
  };

  const handleContinue = async (
    conditions: SearchIntentCondition[],
    unenforced: UnenforcedConstraint[],
  ) => {
    const dealId = await createDealAndSaveIntent(conditions, unenforced);
    if (dealId != null) navigate(`/build-search?deal_id=${dealId}`);
  };

  return (
    <AgentHShell
      context={shellContext}
      commandBar={{
        placeholder: "Tell Agent H what role you're hiring for",
        hint: 'Try: "create a role for a senior backend engineer" or paste a JD above.',
        slashActions: [],
        onSubmit: runFreeTextCommand,
      }}
    >
      <div className="flex flex-col gap-4 max-w-3xl mx-auto p-6 pb-8 overflow-y-auto flex-1 min-h-0">
        <div>
          <h1 className="text-xl font-semibold">JD Intake</h1>
          <p className="text-muted-foreground text-sm">
            Paste a job description — it'll be parsed into sourcing chips you
            review before saving.
          </p>
        </div>

        {/* JD paste — collapses to a summary after parsing */}
        <div className="flex flex-col gap-2">
          {parsed ? (
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
              onClick={() => setJdExpanded((v) => !v)}
            >
              {jdExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {jdExpanded
                ? "Collapse job description"
                : `Job description — ${jdText.slice(0, 60).trim()}…`}
            </button>
          ) : (
            <Label htmlFor="jd-text">Job description</Label>
          )}
          <div className={cn(parsed && !jdExpanded ? "hidden" : "contents")}>
            <Textarea
              id="jd-text"
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              rows={parsed ? 6 : 10}
              placeholder="Paste the full job description here..."
            />
            <div>
              <Button onClick={handleParse} disabled={parsing}>
                {parsing ? "Parsing..." : "Parse with AI"}
              </Button>
            </div>
          </div>
        </div>

        {parsed && (
          <div className="ah-panel flex flex-col gap-4 p-4">
            {/* ── Compact role metadata header ── */}
            <div className="flex flex-col gap-3">
              {/* Title — full width */}
              <Input
                id="title"
                aria-label="Role title"
                value={parsed.title}
                onChange={(e) => updateParsed({ title: e.target.value })}
                className="text-base font-medium h-10"
                placeholder="Role title"
              />

              {/* Seniority / Type / Location / Industry — one row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <select
                  id="seniority"
                  aria-label="Seniority"
                  className="border border-input bg-background text-foreground rounded-md h-8 px-2 text-xs"
                  value={parsed.seniority}
                  onChange={(e) => updateParsed({ seniority: e.target.value })}
                >
                  {SENIORITY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <select
                  id="employment_type"
                  aria-label="Employment type"
                  className="border border-input bg-background text-foreground rounded-md h-8 px-2 text-xs"
                  value={parsed.employment_type}
                  onChange={(e) =>
                    updateParsed({ employment_type: e.target.value })
                  }
                >
                  {EMPLOYMENT_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <Input
                  id="location"
                  aria-label="Location"
                  placeholder="Location"
                  value={parsed.location}
                  onChange={(e) => updateParsed({ location: e.target.value })}
                  className="h-8 text-xs"
                />
                <Input
                  id="industry"
                  aria-label="Industry"
                  placeholder="Industry"
                  value={parsed.industry ?? ""}
                  onChange={(e) => updateParsed({ industry: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>

              {/* YoE — compact row */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">
                  YoE
                </span>
                <Input
                  id="years_min"
                  type="number"
                  aria-label="Min years of experience"
                  placeholder="Min"
                  value={parsed.years_experience_min ?? ""}
                  onChange={(e) =>
                    updateParsed({
                      years_experience_min: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                  className="h-8 text-xs w-20"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  id="years_max"
                  type="number"
                  aria-label="Max years of experience"
                  placeholder="Max"
                  value={parsed.years_experience_max ?? ""}
                  onChange={(e) =>
                    updateParsed({
                      years_experience_max: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                  className="h-8 text-xs w-20"
                />
              </div>
            </div>

            {/* Clarifying questions advisory */}
            {parsed.clarifying_questions.length > 0 && !questionsDismissed && (
              <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                <h3 className="text-sm font-medium text-amber-900">
                  Worth confirming before sourcing starts
                </h3>
                <ul className="list-disc pl-5 text-sm text-amber-900">
                  {parsed.clarifying_questions.map((question, i) => (
                    <li key={i}>{question}</li>
                  ))}
                </ul>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setQuestionsDismissed(true)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            )}

            {/* Ranked preference tiers */}
            {parsed.preference_tiers.length > 0 && (
              <div className="flex flex-col gap-3 rounded-md border p-3">
                <div>
                  <h3 className="text-sm font-medium">
                    Ranked candidate preferences
                  </h3>
                  <p className="text-muted-foreground text-xs">
                    This JD described a primary-vs-fallback profile — edit each
                    tier below, or clear a tier's keywords to drop it.
                  </p>
                </div>
                {[...parsed.preference_tiers]
                  .sort((a, b) => a.rank - b.rank)
                  .map((tier) => (
                    <div
                      key={tier.rank}
                      className="flex flex-col gap-2 rounded-md bg-muted/40 p-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          Tier {tier.rank}
                        </span>
                        <Input
                          aria-label={`Tier ${tier.rank} label`}
                          value={tier.label}
                          onChange={(e) =>
                            updateTier(tier.rank, { label: e.target.value })
                          }
                          className="h-8"
                        />
                      </div>
                      <Input
                        aria-label={`Tier ${tier.rank} keywords`}
                        placeholder="Keywords (comma-separated)"
                        value={arrayToText(tier.keywords)}
                        onChange={(e) =>
                          updateTier(tier.rank, {
                            keywords: textToArray(e.target.value),
                          })
                        }
                        className="h-8"
                      />
                      <Input
                        aria-label={`Tier ${tier.rank} condition`}
                        placeholder="Extra qualifying condition (optional)"
                        value={tier.condition ?? ""}
                        onChange={(e) =>
                          updateTier(tier.rank, {
                            condition: e.target.value || null,
                          })
                        }
                        className="h-8"
                      />
                    </div>
                  ))}
              </div>
            )}

            {/* ── SearchIntent chip editor ── */}
            <div className="border-t pt-3 flex flex-col gap-2">
              <div>
                <h3 className="text-sm font-medium">Sourcing criteria</h3>
                <p className="text-muted-foreground text-xs">
                  Require = must-have · Prefer = nice-to-have · Exclude = never
                  surface
                </p>
              </div>
              <SearchIntentEditor
                initialConditions={intentConditions}
                initialUnenforceable={intentUnenforceable}
                onSave={(conditions, unenforced) => {
                  setIntentConditions(conditions);
                  setIntentUnenforceable(unenforced);
                  handleSave(conditions, unenforced);
                }}
                onContinue={(conditions, unenforced) => {
                  setIntentConditions(conditions);
                  setIntentUnenforceable(unenforced);
                  handleContinue(conditions, unenforced);
                }}
                saving={saving}
              />
            </div>

            {/* ── Sourcing preferences (optional extra) ── */}
            <div className="border-t pt-3 flex flex-col gap-3">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Sourcing preferences (optional)
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Input
                  id="company_type"
                  aria-label="Company type"
                  placeholder="Company type"
                  value={parsed.company_type ?? ""}
                  onChange={(e) =>
                    updateParsed({ company_type: e.target.value || null })
                  }
                  className="h-8 text-xs"
                />
                <div className="flex items-center gap-1 col-span-1">
                  <Input
                    type="number"
                    aria-label="Min company size"
                    placeholder="Size min"
                    value={parsed.company_size_min ?? ""}
                    onChange={(e) =>
                      updateParsed({
                        company_size_min: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                    className="h-8 text-xs"
                  />
                </div>
                <Input
                  type="number"
                  aria-label="Max company size"
                  placeholder="Size max"
                  value={parsed.company_size_max ?? ""}
                  onChange={(e) =>
                    updateParsed({
                      company_size_max: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                  className="h-8 text-xs"
                />
                <Input
                  id="past-titles"
                  aria-label="Past titles (boosts)"
                  placeholder="Past titles (boosts)"
                  value={pastTitlesText}
                  onChange={(e) => setPastTitlesText(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <Input
                id="past-companies"
                aria-label="Past companies (boosts)"
                placeholder="Past companies (boosts) — e.g. Microsoft, Stripe"
                value={pastCompaniesText}
                onChange={(e) => setPastCompaniesText(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
        )}
      </div>
    </AgentHShell>
  );
};

JdIntakePage.path = "/jd-intake";
