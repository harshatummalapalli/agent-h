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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CrmDataProvider } from "../providers/types";
import { AgentHShell } from "../shell/AgentHShell";
import { useJdIntakeShellContext } from "../shell/useShellContext";
import type { Deal } from "../types";
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
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parsed, setParsed] = useState<ParsedRoleBrief | null>(null);
  const [skillsText, setSkillsText] = useState("");
  const [mustHaveText, setMustHaveText] = useState("");
  const [niceToHaveText, setNiceToHaveText] = useState("");
  const [excludedCompaniesText, setExcludedCompaniesText] = useState("");
  const [exclusionKeywordsText, setExclusionKeywordsText] = useState("");
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
          `${dealName}: found ${result.foundCount}, saved ${result.savedCount} to pipeline${filteredNote}`,
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
        navigate("/deals");
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
      // Sourcing-preference/exclusion fields are never part of the LLM
      // parse result (see the ParsedRoleBrief comment) -- default them
      // here so the review form always has a well-formed object to edit.
      setParsed({
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
      });
      setSkillsText(arrayToText(result.required_skills));
      setMustHaveText(arrayToText(result.must_have_keywords));
      setNiceToHaveText(arrayToText(result.nice_to_have_keywords));
      setExcludedCompaniesText("");
      setExclusionKeywordsText("");
      setPastTitlesText("");
      setPastCompaniesText("");
      setQuestionsDismissed(false);
      notify(
        "Job description parsed -- review the fields below before saving",
        { type: "success" },
      );
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

  const handleCreate = async () => {
    if (!parsed) return;
    setSaving(true);
    try {
      const created = await dataProvider.create("deals", {
        data: {
          name: parsed.title,
          // Agent H: "opportunity" was Atomic's stock sales-deal stage,
          // kept only so the record showed up in the Kanban view before a
          // recruiting-specific stage vocabulary existed. That vocabulary
          // now exists (see root/defaultConfiguration.ts) -- every role
          // starts life at the first pipeline stage, "sourcing".
          stage: "sourcing",
          jd_text: jdText,
          seniority: parsed.seniority,
          location: parsed.location,
          industry: parsed.industry,
          employment_type: parsed.employment_type,
          years_experience_min: parsed.years_experience_min,
          years_experience_max: parsed.years_experience_max,
          required_skills: textToArray(skillsText),
          must_have_keywords: textToArray(mustHaveText),
          nice_to_have_keywords: textToArray(niceToHaveText),
          company_type: parsed.company_type,
          company_size_min: parsed.company_size_min,
          company_size_max: parsed.company_size_max,
          excluded_companies: textToArray(excludedCompaniesText),
          exclusion_keywords: textToArray(exclusionKeywordsText),
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
        },
      });
      notify("Role brief created", { type: "success" });
      // Role Workspace (2026-07-19): go straight into the new role's
      // workspace (sourcing/calibration + pipeline, all on one screen)
      // instead of the plain deals list -- matches Noon.ai's flow of
      // JD intake leading directly into Sourcing under the same role
      // context, rather than dropping the recruiter back at a list they'd
      // have to click through again to resume work on what they just
      // created.
      redirect(`/roles/${created.data.id}`);
    } catch (error: any) {
      notify(error?.message || "Failed to create the role brief", {
        type: "error",
      });
    } finally {
      setSaving(false);
    }
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
      <div className="flex flex-col gap-6 max-w-3xl mx-auto p-6 pb-8 overflow-y-auto flex-1 min-h-0">
        <div>
          <h1 className="text-2xl font-semibold">JD Intake</h1>
          <p className="text-muted-foreground text-sm">
            Paste a job description in plain language. It'll be parsed into a
            structured role brief you can review and edit before saving.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="jd-text">Job description</Label>
          <Textarea
            id="jd-text"
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            rows={10}
            placeholder="Paste the full job description here..."
          />
          <div>
            <Button onClick={handleParse} disabled={parsing}>
              {parsing ? "Parsing..." : "Parse with AI"}
            </Button>
          </div>
        </div>

        {parsed && (
          <div className="ah-panel flex flex-col gap-4 p-6">
            <h2 className="text-lg font-medium">Review extracted fields</h2>

            <div className="flex flex-col gap-2">
              <Label htmlFor="title">Role title</Label>
              <Input
                id="title"
                value={parsed.title}
                onChange={(e) => updateParsed({ title: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="seniority">Seniority</Label>
                <select
                  id="seniority"
                  className="border border-input bg-background text-foreground rounded-md h-9 px-2"
                  value={parsed.seniority}
                  onChange={(e) => updateParsed({ seniority: e.target.value })}
                >
                  {SENIORITY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="employment_type">Employment type</Label>
                <select
                  id="employment_type"
                  className="border border-input bg-background text-foreground rounded-md h-9 px-2"
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
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  value={parsed.location}
                  onChange={(e) => updateParsed({ location: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="industry">Industry</Label>
                <Input
                  id="industry"
                  value={parsed.industry ?? ""}
                  onChange={(e) => updateParsed({ industry: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="years_min">Years experience (min)</Label>
                <Input
                  id="years_min"
                  type="number"
                  value={parsed.years_experience_min ?? ""}
                  onChange={(e) =>
                    updateParsed({
                      years_experience_min: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="years_max">Years experience (max)</Label>
                <Input
                  id="years_max"
                  type="number"
                  value={parsed.years_experience_max ?? ""}
                  onChange={(e) =>
                    updateParsed({
                      years_experience_max: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="skills">Required skills (comma-separated)</Label>
              <Input
                id="skills"
                value={skillsText}
                onChange={(e) => setSkillsText(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="must-have">
                Must-have keywords (comma-separated)
              </Label>
              <Input
                id="must-have"
                value={mustHaveText}
                onChange={(e) => setMustHaveText(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="nice-to-have">
                Nice-to-have keywords (comma-separated)
              </Label>
              <Input
                id="nice-to-have"
                value={niceToHaveText}
                onChange={(e) => setNiceToHaveText(e.target.value)}
              />
            </div>

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

            {parsed.preference_tiers.length > 0 && (
              <div className="flex flex-col gap-3 rounded-md border p-3">
                <div>
                  <h3 className="text-sm font-medium">
                    Ranked candidate preferences
                  </h3>
                  <p className="text-muted-foreground text-xs">
                    This JD described a primary-vs-fallback profile -- edit each
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

            <div className="border-t pt-4 flex flex-col gap-4">
              <div>
                <h3 className="text-sm font-medium">
                  Sourcing preferences (optional)
                </h3>
                <p className="text-muted-foreground text-xs">
                  Which companies to pull candidates from -- not facts about
                  this role, just where to look.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="company_type">Company type</Label>
                  <Input
                    id="company_type"
                    placeholder="Startup, Product, Services..."
                    value={parsed.company_type ?? ""}
                    onChange={(e) =>
                      updateParsed({ company_type: e.target.value || null })
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Company size (employees)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      aria-label="Minimum company size"
                      placeholder="Min"
                      value={parsed.company_size_min ?? ""}
                      onChange={(e) =>
                        updateParsed({
                          company_size_min: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                    />
                    <span className="text-muted-foreground text-sm">to</span>
                    <Input
                      type="number"
                      aria-label="Maximum company size"
                      placeholder="Max"
                      value={parsed.company_size_max ?? ""}
                      onChange={(e) =>
                        updateParsed({
                          company_size_max: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="excluded-companies">
                  Excluded companies (comma-separated)
                </Label>
                <Input
                  id="excluded-companies"
                  placeholder="Companies to never surface -- competitors, already contacted, etc."
                  value={excludedCompaniesText}
                  onChange={(e) => setExcludedCompaniesText(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="exclusion-keywords">
                  Exclusion keywords (comma-separated)
                </Label>
                <Input
                  id="exclusion-keywords"
                  placeholder="Terms that should rule a candidate out"
                  value={exclusionKeywordsText}
                  onChange={(e) => setExclusionKeywordsText(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="past-titles">
                  Past titles (comma-separated, optional)
                </Label>
                <Input
                  id="past-titles"
                  placeholder="Boosts, doesn't require -- e.g. 'Founding Engineer' for someone who held that title earlier in their career"
                  value={pastTitlesText}
                  onChange={(e) => setPastTitlesText(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="past-companies">
                  Past companies (comma-separated, optional)
                </Label>
                <Input
                  id="past-companies"
                  placeholder="Boosts, doesn't require -- e.g. 'Microsoft' for candidates who worked there at any point, not just currently"
                  value={pastCompaniesText}
                  onChange={(e) => setPastCompaniesText(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Button onClick={handleCreate} disabled={saving}>
                {saving ? "Saving..." : "Create Role Brief"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AgentHShell>
  );
};

JdIntakePage.path = "/jd-intake";
