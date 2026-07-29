// BuildSearchTab — manual Crustdata filter search tab.
//
// Lets recruiters tune explicit Crustdata Person Search filters and see results
// directly. Isolated from calibration: results are local to this tab and do NOT
// write to role_discovery_cache or the calibration pool.
//
// Pre-fills from deal.role_brief_search_intent so the first use already matches
// the deal's parsed requirements (title terms, location, skills, YoE, seniority).

import { useState, useCallback } from "react";
import { useDataProvider } from "ra-core";
import { useMutation } from "@tanstack/react-query";
import {
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Search,
  X,
  Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  Deal,
  FilterDraft,
  SearchIntentCondition,
  VersionedSearchIntent,
} from "../types";
import type { CrmDataProvider } from "../providers/types";

// ─── Pre-fill from SearchIntent ───────────────────────────────────────────────

function intentToDraft(intent: VersionedSearchIntent | undefined): FilterDraft {
  if (!intent) return {};
  const conds = intent.conditions ?? [];

  const pickValues = (
    predicate: (c: SearchIntentCondition) => boolean,
  ): string[] =>
    conds
      .filter(predicate)
      .map((c) => c.value)
      .filter(Boolean);

  const titleIncludes = pickValues(
    (c) => c.category === "title" && c.disposition === "require",
  );
  const titleExcludes = pickValues(
    (c) => c.category === "title" && c.disposition === "exclude",
  );
  const skills = pickValues(
    (c) => c.category === "skill" && c.disposition === "require",
  );
  const seniorityVals = pickValues(
    (c) => c.category === "seniority" && c.disposition === "require",
  );

  // Parse location: prefer country extraction. "India", "Hyderabad, India",
  // "Hyderabad (India)" etc. Simple heuristic — recruiter can adjust.
  const locationVals = pickValues(
    (c) => c.category === "location" && c.disposition === "require",
  );
  let locationCountry = "";
  let locationCity = "";
  if (locationVals.length > 0) {
    const raw = locationVals[0];
    // Paren form: "City (Country)"
    const parenMatch = raw.match(/^(.+?)\s*\(([^)]+)\)$/);
    // Comma form: "City, Country"
    const commaMatch = raw.match(/^(.+?),\s*(.+)$/);
    if (parenMatch) {
      locationCity = parenMatch[1].trim();
      locationCountry = parenMatch[2].trim();
    } else if (commaMatch) {
      locationCity = commaMatch[1].trim();
      locationCountry = commaMatch[2].trim();
    } else {
      // Assume bare country name (single word / known country)
      locationCountry = raw.trim();
    }
  }

  // Parse YoE range: value like "5-10", "min:5", "max:10"
  const yoeVals = pickValues(
    (c) => c.category === "experience_range" && c.disposition === "require",
  );
  let yoeMin: number | null = null;
  let yoeMax: number | null = null;
  if (yoeVals.length > 0) {
    const v = yoeVals[0];
    const rangeMatch = v.match(/^(\d+)-(\d+)$/);
    const minMatch = v.match(/^min:(\d+)$/);
    const maxMatch = v.match(/^max:(\d+)$/);
    if (rangeMatch) {
      yoeMin = parseInt(rangeMatch[1], 10);
      yoeMax = parseInt(rangeMatch[2], 10);
    } else if (minMatch) {
      yoeMin = parseInt(minMatch[1], 10);
    } else if (maxMatch) {
      yoeMax = parseInt(maxMatch[1], 10);
    }
  }

  return {
    currentTitlesInclude: titleIncludes.length > 0 ? titleIncludes : undefined,
    currentTitlesExclude: titleExcludes.length > 0 ? titleExcludes : undefined,
    skillsRequired: skills.length > 0 ? skills : undefined,
    seniority: seniorityVals.length > 0 ? seniorityVals[0] : undefined,
    locationCountry: locationCountry || undefined,
    locationCity: locationCity || undefined,
    yoeMin,
    yoeMax,
  };
}

// ─── TagInput — multi-value text input for include/exclude lists ──────────────

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
  const linkedinHref = c.linkedin_url
    ? c.linkedin_url.startsWith("http")
      ? c.linkedin_url
      : `https://www.${c.linkedin_url.replace(/^www\./, "")}`
    : null;

  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-border last:border-0">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-medium truncate">
          {c.full_name ?? "—"}
        </span>
        <span className="text-xs text-muted-foreground truncate">
          {[c.job_title, c.job_company_name].filter(Boolean).join(" · ") || "—"}
        </span>
        {c.location_name && (
          <span className="text-xs text-muted-foreground truncate">
            {c.location_name}
          </span>
        )}
        {c.skills && c.skills.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {c.skills.slice(0, 5).map((s) => (
              <Badge
                key={s}
                variant="outline"
                className="text-[10px] py-0 px-1.5 h-4"
              >
                {s}
              </Badge>
            ))}
            {c.skills.length > 5 && (
              <span className="text-[10px] text-muted-foreground">
                +{c.skills.length - 5}
              </span>
            )}
          </div>
        )}
      </div>
      {linkedinHref && (
        <a
          href={linkedinHref}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Open LinkedIn profile"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}

// ─── BuildSearchTab ───────────────────────────────────────────────────────────

export function BuildSearchTab({ deal }: { deal: Deal }) {
  const dataProvider = useDataProvider<CrmDataProvider>();

  // Initialize draft from deal's current SearchIntent (if any).
  const [draft, setDraft] = useState<FilterDraft>(() =>
    intentToDraft(deal?.role_brief_search_intent?.current),
  );

  const [compiledVisible, setCompiledVisible] = useState(false);
  const [limit, setLimit] = useState(25);

  const {
    mutate: runSearch,
    data,
    isPending,
    error,
    reset,
  } = useMutation({
    mutationFn: () =>
      dataProvider.searchCrustdataFilters(draft, limit, String(deal.id)),
    onError: () => {},
  });

  const set = useCallback(
    <K extends keyof FilterDraft>(key: K, value: FilterDraft[K]) =>
      setDraft((d) => ({ ...d, [key]: value })),
    [],
  );

  const resetAll = () => {
    setDraft(intentToDraft(deal?.role_brief_search_intent?.current));
    reset();
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col gap-6">
      {/* Filter panel */}
      <div className="ah-panel p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium tracking-wide uppercase text-muted-foreground">
            Filters
          </h3>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={resetAll}
          >
            Reset to brief
          </button>
        </div>

        {/* Row: current title include */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium">Current title — include</Label>
          <TagInput
            aria-label="Current title include"
            values={draft.currentTitlesInclude ?? []}
            onChange={(v) => set("currentTitlesInclude", v)}
            placeholder="e.g. Security Analyst"
          />
        </div>

        {/* Row: current title exclude */}
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

        {/* Row: past title include */}
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

        {/* Row: location */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">Country (exact)</Label>
            <Input
              className="h-8 text-sm"
              value={draft.locationCountry ?? ""}
              onChange={(e) =>
                set("locationCountry", e.target.value || undefined)
              }
              placeholder="e.g. India"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">City (contains)</Label>
            <Input
              className="h-8 text-sm"
              value={draft.locationCity ?? ""}
              onChange={(e) => set("locationCity", e.target.value || undefined)}
              placeholder="e.g. Hyderabad"
            />
          </div>
        </div>

        {/* Row: skills */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium">
            Skills — must have any of
          </Label>
          <TagInput
            aria-label="Skills"
            values={draft.skillsRequired ?? []}
            onChange={(v) => set("skillsRequired", v)}
            placeholder="e.g. SIEM"
          />
        </div>

        {/* Row: seniority */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium">Seniority (fuzzy match)</Label>
          <Input
            className="h-8 text-sm"
            value={draft.seniority ?? ""}
            onChange={(e) => set("seniority", e.target.value || undefined)}
            placeholder="e.g. Senior"
          />
        </div>

        {/* Row: YoE */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">
              Years of experience — min
            </Label>
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
            <Label className="text-xs font-medium">
              Years of experience — max
            </Label>
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

        {/* Row: current company include/exclude */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium">
            Current company — include any of
          </Label>
          <TagInput
            aria-label="Current company include"
            values={draft.currentCompaniesInclude ?? []}
            onChange={(v) => set("currentCompaniesInclude", v)}
            placeholder="e.g. Palo Alto Networks"
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

        {/* Row: headcount */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">
              Company headcount — min
            </Label>
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
              placeholder="e.g. 50"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">
              Company headcount — max
            </Label>
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

        {/* Limit + Run */}
        <div className="flex items-center gap-3 pt-2 border-t border-border">
          <div className="flex items-center gap-2">
            <Label className="text-xs font-medium whitespace-nowrap">
              Results limit
            </Label>
            <Input
              className="h-7 text-xs w-16"
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={(e) =>
                setLimit(
                  Math.max(
                    1,
                    Math.min(100, parseInt(e.target.value, 10) || 25),
                  ),
                )
              }
            />
          </div>
          <Button
            size="sm"
            onClick={() => runSearch()}
            disabled={isPending}
            className="ml-auto"
          >
            <Search className="h-3.5 w-3.5 mr-1.5" />
            {isPending ? "Searching…" : "Run search"}
          </Button>
        </div>
      </div>

      {/* Compiled query debug (collapsed by default) */}
      {data?.compiled_filters && (
        <div className="ah-panel overflow-hidden">
          <button
            type="button"
            className="flex items-center gap-2 w-full px-4 py-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setCompiledVisible((v) => !v)}
          >
            {compiledVisible ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            )}
            Compiled Crustdata filters
            {data.applied_groups?.length > 0 && (
              <span className="ml-1 text-muted-foreground/60">
                ({data.applied_groups.join(", ")})
              </span>
            )}
          </button>
          {compiledVisible && (
            <pre className="px-4 pb-4 text-[11px] leading-relaxed text-muted-foreground overflow-x-auto">
              {JSON.stringify(data.compiled_filters, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error instanceof Error
            ? error.message
            : "Search failed — please try again."}
        </div>
      )}

      {/* Results */}
      {data && (
        <div className="ah-panel p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium tracking-wide uppercase text-muted-foreground">
              Results
            </h3>
            <span className="text-xs text-muted-foreground">
              {data.total_count > 0
                ? `${data.candidates.length} shown${data.total_count > data.candidates.length ? ` of ~${data.total_count.toLocaleString()}` : ""}`
                : "No results"}
            </span>
          </div>

          {data.note && (
            <p className="text-xs text-muted-foreground mb-4 italic">
              {data.note}
            </p>
          )}

          {data.candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No candidates matched these filters. Try widening the title terms
              or removing some constraints.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {data.candidates.map((c) => (
                <CandidateRow key={c.id || c.full_name} c={c} />
              ))}
            </div>
          )}

          {data.candidates.length > 0 && (
            <p className="mt-4 text-[11px] text-muted-foreground/60">
              Results are read-only in this tab. Credits are consumed by
              Crustdata per search — no writes to your candidate pool.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
