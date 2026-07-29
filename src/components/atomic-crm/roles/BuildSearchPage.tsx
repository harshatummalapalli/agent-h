// BuildSearchPage — standalone full-page Build Search experience.
//
// Accessible at /build-search (no deal required).
// Optional: ?deal_id=xxx prefills from the deal's SearchIntent or brief fields.
//
// Draft persists to localStorage under "buildSearch:draft" so recruiters
// can resume mid-session. Cleared via the Reset button.

import { useState, useCallback, useEffect, useRef } from "react";
import { useDataProvider, useGetOne } from "ra-core";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import {
  Search,
  X,
  Plus,
  RotateCcw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Deal, FilterDraft } from "../types";
import type { CrmDataProvider } from "../providers/types";
import {
  intentToDraft,
  dealBriefToDraft,
  type DealBriefFields,
} from "./BuildSearchTab";
import { CandidateCard } from "./CandidateCard";

// Autocomplete field paths (mirrors crustdataCapabilityManifest CRUSTDATA_FIELDS)
const AC_FIELD_TITLE = "experience.employment_details.current.title";
const AC_FIELD_COUNTRY = "basic_profile.location.country";
const AC_FIELD_COMPANY = "experience.employment_details.current.company_name";
const AC_FIELD_SKILLS = "skills.professional_network_skills";

const LS_KEY = "buildSearch:draft";

function loadDraft(): FilterDraft {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as FilterDraft;
  } catch {
    /* ignore */
  }
  return {};
}

function saveDraft(draft: FilterDraft) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

function isDraftEmpty(draft: FilterDraft): boolean {
  const multiEmpty = (arr?: string[]) => !arr || arr.length === 0;
  return (
    multiEmpty(draft.currentTitlesInclude) &&
    multiEmpty(draft.currentTitlesExclude) &&
    multiEmpty(draft.pastTitlesInclude) &&
    !draft.locationCountry &&
    multiEmpty(draft.locationCountries) &&
    !draft.locationCity &&
    multiEmpty(draft.locationCities) &&
    multiEmpty(draft.locationStates) &&
    multiEmpty(draft.skillsRequired) &&
    multiEmpty(draft.skillsNiceToHave) &&
    !draft.seniority &&
    multiEmpty(draft.currentSeniorities) &&
    !draft.yoeMin &&
    !draft.yoeMax &&
    multiEmpty(draft.currentCompaniesInclude) &&
    multiEmpty(draft.currentCompaniesExclude) &&
    multiEmpty(draft.pastCompaniesInclude) &&
    multiEmpty(draft.companyIndustries) &&
    !draft.companyHQCountry &&
    !draft.headcountMin &&
    !draft.headcountMax &&
    multiEmpty(draft.educationSchools) &&
    multiEmpty(draft.educationDegrees) &&
    multiEmpty(draft.educationFieldsOfStudy) &&
    multiEmpty(draft.headlineKeywordsInclude) &&
    multiEmpty(draft.headlineKeywordsExclude) &&
    multiEmpty(draft.languages) &&
    !draft.connectionsMin
  );
}

// ─── TagInput ─────────────────────────────────────────────────────────────────

function TagInput({
  values,
  onChange,
  placeholder,
  "aria-label": ariaLabel,
}: {
  values: string[];
  onChange: (vals: string[]) => void;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const [input, setInput] = useState("");

  const commit = () => {
    const v = input.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setInput("");
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <Badge key={v} variant="secondary" className="gap-1 text-xs pr-1">
          {v}
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={() => onChange(values.filter((x) => x !== v))}
            className="ml-0.5 rounded hover:bg-muted"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </Badge>
      ))}
      <div className="flex gap-1 min-w-[140px]">
        <Input
          className="h-7 text-xs px-2"
          value={input}
          aria-label={ariaLabel}
          placeholder={placeholder}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Backspace" && !input && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={commit}
        />
        {input.trim() && (
          <button
            type="button"
            onClick={commit}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Add"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── AutocompleteTagInput — TagInput with Crustdata typeahead ─────────────────

function AutocompleteTagInput({
  values,
  onChange,
  placeholder,
  "aria-label": ariaLabel,
  autocompleteField,
  dataProvider,
}: {
  values: string[];
  onChange: (vals: string[]) => void;
  placeholder?: string;
  "aria-label"?: string;
  autocompleteField: string;
  dataProvider: CrmDataProvider;
}) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = (val?: string) => {
    const v = (val ?? input).trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setInput("");
    setSuggestions([]);
  };

  const onInputChange = (raw: string) => {
    setInput(raw);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (raw.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await dataProvider.autocompleteCrustdataField(
          autocompleteField,
          raw.trim(),
          8,
        );
        setSuggestions(results.filter((r) => !values.includes(r)));
      } catch {
        setSuggestions([]);
      }
    }, 300);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <Badge key={v} variant="secondary" className="gap-1 text-xs pr-1">
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="ml-0.5 rounded hover:bg-muted"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
        <div className="flex gap-1 min-w-[140px]">
          <Input
            className="h-7 text-xs px-2"
            value={input}
            aria-label={ariaLabel}
            placeholder={placeholder}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Backspace" && !input && values.length > 0) {
                onChange(values.slice(0, -1));
              }
              if (e.key === "Escape") setSuggestions([]);
            }}
            onBlur={() => {
              // Delay so click on suggestion fires first
              setTimeout(() => {
                commit();
                setSuggestions([]);
              }, 150);
            }}
          />
          {input.trim() && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit()}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Add"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="bg-popover border border-border rounded-md shadow-md z-10 max-h-48 overflow-y-auto">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Result row ───────────────────────────────────────────────────────────────

type SearchCandidate = {
  id: string;
  full_name?: string;
  job_title?: string;
  job_company_name?: string;
  location_name?: string;
  linkedin_url?: string;
  skills?: string[];
  years_experience?: number | null;
};

function CandidateRow({ c }: { c: SearchCandidate }) {
  const headline =
    [c.job_title, c.job_company_name].filter(Boolean).join(" · ") || undefined;
  return (
    <CandidateCard
      density="row"
      name={c.full_name ?? "—"}
      headline={headline}
      location={c.location_name}
      linkedinUrl={c.linkedin_url}
      skills={c.skills}
    />
  );
}

// ─── Accordion section ────────────────────────────────────────────────────────

function FilterSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium hover:bg-muted/30 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{title}</span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 flex flex-col gap-4 border-t border-border bg-muted/10">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── BuildSearchPage ──────────────────────────────────────────────────────────

export function BuildSearchPage() {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [searchParams] = useSearchParams();
  const dealId = searchParams.get("deal_id") ?? undefined;

  // When deal_id is present, start with empty draft; prefill from deal on load.
  // Without deal_id, load from localStorage as before.
  const [draft, setDraft] = useState<FilterDraft>(() =>
    dealId ? {} : loadDraft(),
  );
  const prefillApplied = useRef(false);
  const [limit, setLimit] = useState(25);
  const [compiledVisible, setCompiledVisible] = useState(false);

  // Fetch deal when deal_id is present — prefill draft from intent / brief fields.
  const { data: dealRecord } = useGetOne<Deal>(
    "deals",
    { id: dealId! },
    { enabled: !!dealId },
  );
  useEffect(() => {
    if (!dealId || !dealRecord || prefillApplied.current) return;
    prefillApplied.current = true;
    const deal = dealRecord as DealBriefFields;
    const fromIntent = intentToDraft(deal.role_brief_search_intent?.current);
    const hasIntent =
      (fromIntent.currentTitlesInclude?.length ?? 0) > 0 ||
      (fromIntent.locationCountries?.length ?? 0) > 0 ||
      !!fromIntent.locationCountry ||
      (fromIntent.skillsRequired?.length ?? 0) > 0;
    setDraft(hasIntent ? fromIntent : dealBriefToDraft(deal));
  }, [dealId, dealRecord]);

  // Persist draft to localStorage on every change (only when not in deal_id mode)
  useEffect(() => {
    if (!dealId) saveDraft(draft);
  }, [draft, dealId]);

  const {
    mutate: runSearch,
    data,
    isPending,
    error,
    reset,
  } = useMutation({
    mutationFn: () => dataProvider.searchCrustdataFilters(draft, limit, dealId),
    onError: () => {},
  });

  const set = useCallback(
    <K extends keyof FilterDraft>(key: K, value: FilterDraft[K]) =>
      setDraft((d) => ({ ...d, [key]: value })),
    [],
  );

  const resetDraft = () => {
    setDraft({});
    localStorage.removeItem(LS_KEY);
    reset();
  };

  const prefillPending = !!dealId && !prefillApplied.current && !dealRecord;
  const empty = isDraftEmpty(draft);
  const candidates =
    (data as { candidates?: SearchCandidate[] } | undefined)?.candidates ?? [];
  const totalCount =
    (data as { total_count?: number } | undefined)?.total_count ?? 0;
  const appliedGroups =
    (data as { applied_groups?: string[] } | undefined)?.applied_groups ?? [];
  const compiledFilters = (data as { compiled_filters?: unknown } | undefined)
    ?.compiled_filters;
  const hasSearched = !!data;
  const zeroResults = hasSearched && candidates.length === 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Build your search
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manually tune Crustdata filters to find the right people. Results
              are not added to any role pipeline automatically.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetDraft}
            className="gap-1.5 text-muted-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>

        {prefillPending && (
          <p className="text-sm text-muted-foreground">Loading role filters…</p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-8 items-start">
          {/* ── Filter panel ── */}
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Filters
            </p>

            {/* Section 1: Titles */}
            <FilterSection title="Titles" defaultOpen>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Current title — include
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    (OR: any synonym matches)
                  </span>
                </Label>
                <AutocompleteTagInput
                  aria-label="Current title include"
                  values={draft.currentTitlesInclude ?? []}
                  onChange={(v) => set("currentTitlesInclude", v)}
                  placeholder="e.g. Security Analyst"
                  autocompleteField={AC_FIELD_TITLE}
                  dataProvider={dataProvider}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Current title — exclude keywords
                </Label>
                <TagInput
                  aria-label="Current title exclude"
                  values={draft.currentTitlesExclude ?? []}
                  onChange={(v) => set("currentTitlesExclude", v)}
                  placeholder="e.g. Manager"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Past title — include (optional)
                </Label>
                <TagInput
                  aria-label="Past title include"
                  values={draft.pastTitlesInclude ?? []}
                  onChange={(v) => set("pastTitlesInclude", v)}
                  placeholder="e.g. SOC Analyst"
                />
              </div>
            </FilterSection>

            {/* Section 2: Location */}
            <FilterSection title="Location">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Countries
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    (OR — full name: United States, India…)
                  </span>
                </Label>
                <AutocompleteTagInput
                  aria-label="Countries"
                  values={draft.locationCountries ?? []}
                  onChange={(v) => set("locationCountries", v)}
                  placeholder="e.g. India"
                  autocompleteField={AC_FIELD_COUNTRY}
                  dataProvider={dataProvider}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">Cities</Label>
                <TagInput
                  aria-label="Cities"
                  values={draft.locationCities ?? []}
                  onChange={(v) => set("locationCities", v)}
                  placeholder="e.g. Hyderabad"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">States / regions</Label>
                <TagInput
                  aria-label="States"
                  values={draft.locationStates ?? []}
                  onChange={(v) => set("locationStates", v)}
                  placeholder="e.g. Karnataka"
                />
              </div>
            </FilterSection>

            {/* Section 3: Skills */}
            <FilterSection title="Skills">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Must-have skills
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    (AND — every skill required)
                  </span>
                </Label>
                <p className="text-xs text-muted-foreground -mt-0.5">
                  Too many AND skills → zero results. Keep to 2–3 critical ones.
                </p>
                <AutocompleteTagInput
                  aria-label="Must-have skills"
                  values={draft.skillsRequired ?? []}
                  onChange={(v) => set("skillsRequired", v)}
                  placeholder="e.g. Python"
                  autocompleteField={AC_FIELD_SKILLS}
                  dataProvider={dataProvider}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Nice-to-have skills
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    (OR — any of these)
                  </span>
                </Label>
                <TagInput
                  aria-label="Nice-to-have skills"
                  values={draft.skillsNiceToHave ?? []}
                  onChange={(v) => set("skillsNiceToHave", v)}
                  placeholder="e.g. GraphQL"
                />
              </div>
            </FilterSection>

            {/* Section 4: Experience & Seniority */}
            <FilterSection title="Experience & Seniority">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Seniority
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    (OR)
                  </span>
                </Label>
                <TagInput
                  aria-label="Seniority levels"
                  values={draft.currentSeniorities ?? []}
                  onChange={(v) => set("currentSeniorities", v)}
                  placeholder="e.g. Senior"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium">YoE min</Label>
                  <Input
                    className="h-8 text-sm"
                    type="number"
                    min={0}
                    max={50}
                    value={draft.yoeMin ?? ""}
                    onChange={(e) =>
                      set(
                        "yoeMin",
                        e.target.value ? parseInt(e.target.value, 10) : null,
                      )
                    }
                    placeholder="e.g. 4"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium">YoE max</Label>
                  <Input
                    className="h-8 text-sm"
                    type="number"
                    min={0}
                    max={50}
                    value={draft.yoeMax ?? ""}
                    onChange={(e) =>
                      set(
                        "yoeMax",
                        e.target.value ? parseInt(e.target.value, 10) : null,
                      )
                    }
                    placeholder="e.g. 15"
                  />
                </div>
              </div>
            </FilterSection>

            {/* Section 5: Companies */}
            <FilterSection title="Companies">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Current company — include (OR)
                </Label>
                <AutocompleteTagInput
                  aria-label="Current company include"
                  values={draft.currentCompaniesInclude ?? []}
                  onChange={(v) => set("currentCompaniesInclude", v)}
                  placeholder="e.g. Palo Alto Networks"
                  autocompleteField={AC_FIELD_COMPANY}
                  dataProvider={dataProvider}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Current company — exclude
                </Label>
                <TagInput
                  aria-label="Current company exclude"
                  values={draft.currentCompaniesExclude ?? []}
                  onChange={(v) => set("currentCompaniesExclude", v)}
                  placeholder="e.g. TCS"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Past company — include (OR)
                </Label>
                <TagInput
                  aria-label="Past company include"
                  values={draft.pastCompaniesInclude ?? []}
                  onChange={(v) => set("pastCompaniesInclude", v)}
                  placeholder="e.g. Google"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Industries
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    (OR — e.g. Computer Software)
                  </span>
                </Label>
                <TagInput
                  aria-label="Company industries"
                  values={draft.companyIndustries ?? []}
                  onChange={(v) => set("companyIndustries", v)}
                  placeholder="e.g. Financial Services"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  HQ country
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    (ISO alpha-3: USA, IND, GBR)
                  </span>
                </Label>
                <Input
                  className="h-8 text-sm"
                  value={draft.companyHQCountry ?? ""}
                  onChange={(e) =>
                    set("companyHQCountry", e.target.value || undefined)
                  }
                  placeholder="e.g. USA"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium">Headcount min</Label>
                  <Input
                    className="h-8 text-sm"
                    type="number"
                    min={0}
                    value={draft.headcountMin ?? ""}
                    onChange={(e) =>
                      set(
                        "headcountMin",
                        e.target.value ? parseInt(e.target.value, 10) : null,
                      )
                    }
                    placeholder="e.g. 200"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium">Headcount max</Label>
                  <Input
                    className="h-8 text-sm"
                    type="number"
                    min={0}
                    value={draft.headcountMax ?? ""}
                    onChange={(e) =>
                      set(
                        "headcountMax",
                        e.target.value ? parseInt(e.target.value, 10) : null,
                      )
                    }
                    placeholder="e.g. 5000"
                  />
                </div>
              </div>
            </FilterSection>

            {/* Section 6: Education */}
            <FilterSection title="Education">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">Schools (OR)</Label>
                <TagInput
                  aria-label="Schools"
                  values={draft.educationSchools ?? []}
                  onChange={(v) => set("educationSchools", v)}
                  placeholder="e.g. IIT Bombay"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">Degrees (OR)</Label>
                <TagInput
                  aria-label="Degrees"
                  values={draft.educationDegrees ?? []}
                  onChange={(v) => set("educationDegrees", v)}
                  placeholder="e.g. MBA"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Fields of study (OR)
                </Label>
                <TagInput
                  aria-label="Fields of study"
                  values={draft.educationFieldsOfStudy ?? []}
                  onChange={(v) => set("educationFieldsOfStudy", v)}
                  placeholder="e.g. Computer Science"
                />
              </div>
            </FilterSection>

            {/* Section 7: Other */}
            <FilterSection title="Other">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Headline keywords — include (OR)
                </Label>
                <TagInput
                  aria-label="Headline include"
                  values={draft.headlineKeywordsInclude ?? []}
                  onChange={(v) => set("headlineKeywordsInclude", v)}
                  placeholder="e.g. AI"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Headline keywords — exclude
                </Label>
                <TagInput
                  aria-label="Headline exclude"
                  values={draft.headlineKeywordsExclude ?? []}
                  onChange={(v) => set("headlineKeywordsExclude", v)}
                  placeholder="e.g. Intern"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">Languages (OR)</Label>
                <TagInput
                  aria-label="Languages"
                  values={draft.languages ?? []}
                  onChange={(v) => set("languages", v)}
                  placeholder="e.g. English"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Min LinkedIn connections
                </Label>
                <Input
                  className="h-8 text-sm"
                  type="number"
                  min={0}
                  value={draft.connectionsMin ?? ""}
                  onChange={(e) =>
                    set(
                      "connectionsMin",
                      e.target.value ? parseInt(e.target.value, 10) : null,
                    )
                  }
                  placeholder="e.g. 500"
                />
              </div>
            </FilterSection>

            {/* Run button + limit */}
            <div className="flex items-center gap-3 pt-1">
              <Button
                onClick={() => runSearch()}
                disabled={isPending || empty || prefillPending}
                className="flex-1"
              >
                <Search className="h-4 w-4 mr-2" />
                {isPending ? "Searching…" : "Run search"}
              </Button>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">
                  Limit
                </Label>
                <Input
                  className="h-8 text-sm w-16"
                  type="number"
                  min={1}
                  max={100}
                  value={limit}
                  onChange={(e) =>
                    setLimit(
                      Math.min(
                        100,
                        Math.max(1, parseInt(e.target.value, 10) || 25),
                      ),
                    )
                  }
                />
              </div>
            </div>

            {empty && (
              <p className="text-xs text-muted-foreground text-center py-2">
                Add at least one filter to run a search.
              </p>
            )}
          </div>

          {/* ── Results panel ── */}
          <div className="flex flex-col gap-4">
            {!hasSearched && !isPending && (
              <div className="flex flex-col items-center justify-center gap-3 py-20 text-center text-muted-foreground">
                <Search className="h-10 w-10 opacity-20" />
                <p className="text-sm max-w-xs">
                  Configure your filters and hit <strong>Run search</strong> to
                  find candidates directly from Crustdata.
                </p>
              </div>
            )}

            {isPending && (
              <div className="flex items-center justify-center py-20 text-muted-foreground text-sm animate-pulse">
                Searching…
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                Search failed. Check your connection and try again.
              </div>
            )}

            {hasSearched && !isPending && (
              <>
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">
                      {totalCount > 0
                        ? `${totalCount.toLocaleString()} result${totalCount === 1 ? "" : "s"}`
                        : "No results"}
                    </span>
                    {appliedGroups.length > 0 && (
                      <span className="text-muted-foreground">
                        · {appliedGroups.join(", ")}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    onClick={() => setCompiledVisible((v) => !v)}
                  >
                    {compiledVisible ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    Compiled filters
                  </button>
                </div>

                {compiledVisible && (
                  <pre className="text-[10px] bg-muted rounded p-3 overflow-x-auto max-h-48 text-muted-foreground">
                    {JSON.stringify(compiledFilters, null, 2)}
                  </pre>
                )}

                {/* Zero-result state */}
                {zeroResults && (
                  <div className="rounded-lg border border-border bg-muted/30 p-5 flex flex-col gap-2">
                    <p className="text-sm font-medium">No candidates found</p>
                    <p className="text-xs text-muted-foreground">
                      Common causes:
                    </p>
                    <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
                      <li>
                        Too many AND skills — try removing one or two from{" "}
                        <em>Must-have</em>, or move them to{" "}
                        <em>Nice-to-have</em>
                      </li>
                      <li>
                        Country spelling — use full names like{" "}
                        <strong>United States</strong> or <strong>India</strong>{" "}
                        (not abbreviations)
                      </li>
                      <li>
                        Seniority vocabulary — try <strong>Senior</strong>,{" "}
                        <strong>Lead</strong>, or <strong>Principal</strong>
                      </li>
                      <li>
                        Company HQ country requires ISO alpha-3 (
                        <strong>USA</strong>, <strong>IND</strong>,{" "}
                        <strong>GBR</strong>)
                      </li>
                    </ul>
                  </div>
                )}

                {/* Candidate list */}
                {candidates.length > 0 && (
                  <div className="rounded-lg border border-border divide-y divide-border">
                    {candidates.map((c) => (
                      <div key={c.id} className="px-4">
                        <CandidateRow c={c} />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
