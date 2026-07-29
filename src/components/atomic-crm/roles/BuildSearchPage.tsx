// BuildSearchPage — standalone full-page Build Search experience.
//
// Accessible at /build-search (no deal required).
// Optional: ?deal_id=xxx prefills from the deal's SearchIntent or brief fields.
//
// Draft persists to localStorage under "buildSearch:draft" so recruiters
// can resume mid-session. Cleared via the Reset button.

import { useState, useCallback, useEffect, useRef } from "react";
import { useDataProvider } from "ra-core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import {
  ExternalLink,
  Search,
  X,
  Plus,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  SendHorizonal,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OutreachPreviewPanel } from "../sourcing/OutreachPreviewPanel";
import type { OutreachPrepared } from "../sourcing/sourcingTypes";
import type { Deal, FilterDraft } from "../types";
import type { CrmDataProvider } from "../providers/types";

// Autocomplete field paths (mirrors crustdataCapabilityManifest CRUSTDATA_FIELDS)
const AC_FIELD_TITLE = "experience.employment_details.current.title";
const AC_FIELD_COUNTRY = "basic_profile.location.country";
const AC_FIELD_CITY = "basic_profile.location.city";
const AC_FIELD_STATE = "basic_profile.location.state";
// Company autocomplete uses "name" subkey (not company_name) per Crustdata autocomplete API.
const AC_FIELD_COMPANY = "experience.employment_details.current.name";
const AC_FIELD_SKILLS = "skills.professional_network_skills";
const AC_FIELD_INDUSTRIES =
  "experience.employment_details.current.company_industries";
const AC_FIELD_SCHOOL = "education.schools.school";
const AC_FIELD_LANGUAGES = "basic_profile.languages";

const SORTABLE_FIELD_OPTIONS = [
  { value: "recently_changed_jobs", label: "Recently changed jobs" },
  { value: "professional_network.connections", label: "Connections" },
  { value: "professional_network.followers", label: "Followers" },
  { value: "years_of_experience_raw", label: "Years of experience" },
  { value: "experience.employment_details.start_date", label: "Start date" },
];

const LS_KEY = "buildSearch:draft";

function loadDraft(): FilterDraft {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return sanitizeDraft(JSON.parse(raw) as FilterDraft);
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

function cleanStrArr(arr?: string[]): string[] {
  return (arr ?? []).map((s) => s.trim()).filter(Boolean);
}

/** Drop blank / whitespace-only values so collapsed sticky fields don't leak. */
function sanitizeDraft(draft: FilterDraft): FilterDraft {
  const out: FilterDraft = {};
  const setArr = (key: keyof FilterDraft, arr?: string[]) => {
    const cleaned = cleanStrArr(arr);
    if (cleaned.length > 0) (out as Record<string, unknown>)[key] = cleaned;
  };
  const setStr = (key: keyof FilterDraft, v?: string) => {
    const t = v?.trim();
    if (t) (out as Record<string, unknown>)[key] = t;
  };
  const setNum = (key: keyof FilterDraft, v?: number | null) => {
    if (v != null && Number.isFinite(v) && v > 0) {
      (out as Record<string, unknown>)[key] = v;
    }
  };

  setArr("currentTitlesInclude", draft.currentTitlesInclude);
  setArr("currentTitlesExclude", draft.currentTitlesExclude);
  setArr("pastTitlesInclude", draft.pastTitlesInclude);
  setArr("locationCountries", draft.locationCountries);
  setStr("locationCountry", draft.locationCountry);
  setArr("locationCities", draft.locationCities);
  setStr("locationCity", draft.locationCity);
  setArr("locationStates", draft.locationStates);
  setArr("skillsRequired", draft.skillsRequired);
  setArr("skillsNiceToHave", draft.skillsNiceToHave);
  setStr("seniority", draft.seniority);
  setArr("currentSeniorities", draft.currentSeniorities);
  setNum("yoeMin", draft.yoeMin);
  setNum("yoeMax", draft.yoeMax);
  setArr("currentCompaniesInclude", draft.currentCompaniesInclude);
  setArr("currentCompaniesExclude", draft.currentCompaniesExclude);
  setArr("pastCompaniesInclude", draft.pastCompaniesInclude);
  setArr("companyIndustries", draft.companyIndustries);
  setStr("companyHQCountry", draft.companyHQCountry);
  setNum("headcountMin", draft.headcountMin);
  setNum("headcountMax", draft.headcountMax);
  setArr("educationSchools", draft.educationSchools);
  setArr("educationDegrees", draft.educationDegrees);
  setArr("educationFieldsOfStudy", draft.educationFieldsOfStudy);
  setArr("headlineKeywordsInclude", draft.headlineKeywordsInclude);
  setArr("headlineKeywordsExclude", draft.headlineKeywordsExclude);
  setArr("languages", draft.languages);
  setNum("connectionsMin", draft.connectionsMin);
  if (draft.recentlyChangedJobs === true) out.recentlyChangedJobs = true;
  // New fields
  if (draft.titleMatchMode === "exact_phrase")
    out.titleMatchMode = "exact_phrase";
  const geoNear = draft.geoNear?.trim();
  if (geoNear && draft.geoDistance && draft.geoDistance > 0) {
    out.geoNear = geoNear;
    out.geoDistance = draft.geoDistance;
    if (draft.geoUnit) out.geoUnit = draft.geoUnit;
    if (draft.geoExcludeNear) out.geoExcludeNear = true;
  }
  setArr("locationContinents", draft.locationContinents);
  setArr("functionCategories", draft.functionCategories);
  setArr("employmentTypes", draft.employmentTypes);
  setArr("currentCompanyDomains", draft.currentCompanyDomains);
  setArr("pastCompaniesExclude", draft.pastCompaniesExclude);
  const openToCards = (draft.openToCards ?? []).filter(Boolean);
  if (openToCards.length > 0)
    out.openToCards = openToCards as FilterDraft["openToCards"];
  setNum("connectionsMax", draft.connectionsMax);
  setNum("followersMin", draft.followersMin);
  const sortField = draft.sortField?.trim();
  if (sortField && sortField !== "none") {
    out.sortField = sortField;
    out.sortOrder = draft.sortOrder ?? "desc";
  }
  return out;
}

function isDraftEmpty(draft: FilterDraft): boolean {
  return Object.keys(sanitizeDraft(draft)).length === 0;
}

/** Always-visible chips so collapsed accordion sections can't hide active filters. */
function activeFilterChips(draft: FilterDraft): string[] {
  const d = sanitizeDraft(draft);
  const chips: string[] = [];
  const pushMany = (label: string, vals?: string[]) => {
    for (const v of vals ?? []) chips.push(`${label}: ${v}`);
  };
  pushMany("Title", d.currentTitlesInclude);
  pushMany("Not title", d.currentTitlesExclude);
  pushMany("Past title", d.pastTitlesInclude);
  pushMany("Country", d.locationCountries);
  if (d.locationCountry) chips.push(`Country: ${d.locationCountry}`);
  pushMany("City", d.locationCities);
  if (d.locationCity) chips.push(`City: ${d.locationCity}`);
  pushMany("State", d.locationStates);
  pushMany("Must skill", d.skillsRequired);
  pushMany("Nice skill", d.skillsNiceToHave);
  if (d.seniority) chips.push(`Seniority: ${d.seniority}`);
  pushMany("Seniority", d.currentSeniorities);
  if (d.yoeMin != null) chips.push(`YoE ≥ ${d.yoeMin}`);
  if (d.yoeMax != null) chips.push(`YoE ≤ ${d.yoeMax}`);
  pushMany("Company", d.currentCompaniesInclude);
  pushMany("Not company", d.currentCompaniesExclude);
  pushMany("Past company", d.pastCompaniesInclude);
  pushMany("Industry", d.companyIndustries);
  if (d.companyHQCountry) chips.push(`HQ: ${d.companyHQCountry}`);
  if (d.headcountMin != null) chips.push(`Headcount ≥ ${d.headcountMin}`);
  if (d.headcountMax != null) chips.push(`Headcount ≤ ${d.headcountMax}`);
  pushMany("School", d.educationSchools);
  pushMany("Degree", d.educationDegrees);
  pushMany("Field", d.educationFieldsOfStudy);
  pushMany("Headline", d.headlineKeywordsInclude);
  pushMany("Not headline", d.headlineKeywordsExclude);
  pushMany("Language", d.languages);
  if (d.connectionsMin != null) chips.push(`Connections ≥ ${d.connectionsMin}`);
  if (d.recentlyChangedJobs) chips.push("Recently changed jobs");
  // New fields
  if (d.titleMatchMode === "exact_phrase") chips.push("Title: exact phrase");
  if (d.geoNear && d.geoDistance && d.geoDistance > 0)
    chips.push(
      `Geo ${d.geoExcludeNear ? "exclude" : "within"} ${d.geoDistance}${d.geoUnit ?? "mi"} of ${d.geoNear}`,
    );
  pushMany("Continent", d.locationContinents);
  pushMany("Function", d.functionCategories);
  pushMany("Emp. type", d.employmentTypes);
  pushMany("Domain", d.currentCompanyDomains);
  pushMany("Not past co.", d.pastCompaniesExclude);
  for (const code of d.openToCards ?? []) chips.push(`Open-to: ${code}`);
  if (d.connectionsMax != null) chips.push(`Connections ≤ ${d.connectionsMax}`);
  if (d.followersMin != null) chips.push(`Followers ≥ ${d.followersMin}`);
  if (d.sortField) chips.push(`Sort: ${d.sortField} ${d.sortOrder ?? "desc"}`);
  return chips;
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

function CandidateRow({
  c,
  selected,
  onToggle,
}: {
  c: SearchCandidate;
  selected?: boolean;
  onToggle?: (id: string) => void;
}) {
  const linkedinHref = c.linkedin_url
    ? c.linkedin_url.startsWith("http")
      ? c.linkedin_url
      : `https://www.${c.linkedin_url.replace(/^www\./, "")}`
    : null;

  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      {onToggle && (
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggle(c.id)}
          aria-label={`Select ${c.full_name ?? c.id}`}
          className="mt-0.5 shrink-0"
        />
      )}
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
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

type OutreachQueueItem = {
  candidateKey: string;
  dbId: number;
  prepared: OutreachPrepared;
  name: string;
};

export function BuildSearchPage() {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [searchParams] = useSearchParams();
  const dealId = searchParams.get("deal_id") ?? undefined;

  const [draft, setDraft] = useState<FilterDraft>(loadDraft);
  const [limit, setLimit] = useState(25);
  const [compiledVisible, setCompiledVisible] = useState(false);
  /** When on, edge function progressively drops soft constraints if Crustdata returns 0. */
  const [autoWiden, setAutoWiden] = useState(true);

  // ── Selection + outreach state ───────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rolePickerOpen, setRolePickerOpen] = useState(false);
  const [activeDealId, setActiveDealId] = useState<string | null>(
    dealId ?? null,
  );
  const [outreachState, setOutreachState] = useState<
    "idle" | "preparing" | "reviewing"
  >("idle");
  const [outreachQueue, setOutreachQueue] = useState<OutreachQueueItem[]>([]);
  const [queueIdx, setQueueIdx] = useState(0);
  const [confirming, setConfirming] = useState(false);

  // Persist draft to localStorage on every change (sanitized)
  useEffect(() => {
    saveDraft(sanitizeDraft(draft));
  }, [draft]);

  type SearchResponse = {
    candidates?: SearchCandidate[];
    total_count?: number;
    applied_groups?: string[];
    compiled_filters?: unknown;
    sorts?: Array<{ field: string; order: "asc" | "desc" }>;
    note?: string;
    error?: string;
    error_detail?: string;
    crustdata_http_status?: number | null;
    relaxed_away?: string[];
    next_cursor?: string;
  };

  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [allCandidates, setAllCandidates] = useState<SearchCandidate[]>([]);

  const {
    mutate: runSearch,
    data,
    isPending,
    error,
    reset,
  } = useMutation<SearchResponse, Error, string | undefined>({
    mutationFn: (cursor?: string) => {
      if (!cursor) {
        const cleaned = sanitizeDraft(draft);
        setDraft(cleaned);
        return dataProvider.searchCrustdataFilters(
          cleaned,
          limit,
          dealId,
          autoWiden,
          undefined,
        ) as Promise<SearchResponse>;
      }
      return dataProvider.searchCrustdataFilters(
        sanitizeDraft(draft),
        limit,
        dealId,
        autoWiden,
        cursor,
      ) as Promise<SearchResponse>;
    },
    onSuccess: (r, cursor) => {
      const newCandidates = r.candidates ?? [];
      if (cursor) {
        setAllCandidates((prev) => [...prev, ...newCandidates]);
      } else {
        setAllCandidates(newCandidates);
      }
      setNextCursor(r.next_cursor);
      if (newCandidates.length === 0 && !cursor) {
        setCompiledVisible(true);
      }
    },
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
    setCompiledVisible(false);
    setSelectedIds(new Set());
    setAllCandidates([]);
    setNextCursor(undefined);
    reset();
  };

  // ── Open deals for role picker ────────────────────────────────────────────
  const dealsQuery = useQuery({
    queryKey: ["build-search-open-deals"],
    queryFn: () =>
      dataProvider.getList<Deal>("deals", {
        pagination: { page: 1, perPage: 50 },
        sort: { field: "updated_at", order: "DESC" },
        filter: { "archived_at@is": null },
      }),
    enabled: rolePickerOpen,
    staleTime: 60_000,
  });
  const openDeals = dealsQuery.data?.data ?? [];

  // ── Selection helpers ─────────────────────────────────────────────────────
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const toggleSelectAll = () => {
    if (selectedIds.size === candidates.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(candidates.map((c) => c.id)));
    }
  };

  // ── Outreach flow ─────────────────────────────────────────────────────────
  const startOutreachFlow = async (resolvedDealId: string) => {
    const selected = candidates.filter((c) => selectedIds.has(c.id));
    if (selected.length === 0) return;
    setOutreachState("preparing");
    const queue: OutreachQueueItem[] = [];

    for (let i = 0; i < selected.length; i++) {
      const c = selected[i];
      toast.loading(`Saving ${i + 1}/${selected.length}…`, {
        id: "outreach-progress",
      });
      try {
        const outcome = await dataProvider.saveSourcedCandidate(
          Number(resolvedDealId),
          {
            id: c.id,
            full_name: c.full_name,
            linkedin_url: c.linkedin_url,
            job_title: c.job_title,
            job_company_name: c.job_company_name,
            location_name: c.location_name,
          },
        );
        if (!outcome.candidate_id) continue;

        toast.loading(`Preparing outreach ${i + 1}/${selected.length}…`, {
          id: "outreach-progress",
        });
        const prepared = await dataProvider.prepareFirstOutreach(
          outcome.candidate_id,
          Number(resolvedDealId),
        );
        queue.push({
          candidateKey: c.id,
          dbId: outcome.candidate_id,
          prepared: prepared as unknown as OutreachPrepared,
          name: c.full_name ?? `Candidate #${outcome.candidate_id}`,
        });
      } catch (err: any) {
        toast.error(`${c.full_name ?? c.id}: ${err?.message ?? "Failed"}`);
      }
    }

    toast.dismiss("outreach-progress");
    if (queue.length === 0) {
      toast.error("No outreach could be prepared");
      setOutreachState("idle");
      return;
    }
    toast.success(
      `${queue.length} outreach draft${queue.length > 1 ? "s" : ""} ready`,
    );
    setOutreachQueue(queue);
    setQueueIdx(0);
    setOutreachState("reviewing");
  };

  const handleOutreachSelected = () => {
    if (!activeDealId) {
      setRolePickerOpen(true);
    } else {
      startOutreachFlow(activeDealId);
    }
  };

  const handlePickRole = (id: number) => {
    const picked = String(id);
    setActiveDealId(picked);
    setRolePickerOpen(false);
    startOutreachFlow(picked);
  };

  const handleUpdatePrepared = (next: OutreachPrepared) => {
    setOutreachQueue((q) =>
      q.map((item, idx) =>
        idx === queueIdx ? { ...item, prepared: next } : item,
      ),
    );
  };

  const handleConfirmSend = async () => {
    const item = outreachQueue[queueIdx];
    if (!item || !activeDealId) return;
    setConfirming(true);
    try {
      const p = item.prepared;
      const isDual = p.dual_channel && p.send_email_too && p.email_preview;
      await dataProvider.sendFirstOutreach(item.dbId, Number(activeDealId), {
        channel: p.channel,
        message_body: p.message_body ?? undefined,
        linkedin_provider_id: p.linkedin_provider_id ?? undefined,
        subject: p.channel === "email" ? p.email_preview?.subject : undefined,
        html: p.channel === "email" ? p.email_preview?.html : undefined,
        also_send_email: isDual ? true : undefined,
        email_to: isDual ? p.email_preview?.to : undefined,
        email_subject: isDual ? p.email_preview?.subject : undefined,
        email_html: isDual ? p.email_preview?.html : undefined,
      });
      toast.success(
        isDual ? "Outreach sent via LinkedIn + email" : "Outreach sent",
      );
      const nextIdx = queueIdx + 1;
      if (nextIdx < outreachQueue.length) {
        setQueueIdx(nextIdx);
      } else {
        setOutreachState("idle");
        setOutreachQueue([]);
        setSelectedIds(new Set());
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to send outreach");
    } finally {
      setConfirming(false);
    }
  };

  const handleCancelReview = () => {
    setOutreachState("idle");
    setOutreachQueue([]);
    setQueueIdx(0);
  };

  const empty = isDraftEmpty(draft);
  const filterChips = activeFilterChips(draft);
  const searchData = data;
  const candidates = allCandidates;
  const totalCount = searchData?.total_count ?? 0;
  const appliedGroups = searchData?.applied_groups ?? [];
  const compiledFilters = searchData?.compiled_filters;
  const appliedSorts = searchData?.sorts;
  const searchNote = searchData?.note;
  const searchError = searchData?.error;
  const searchErrorDetail = searchData?.error_detail;
  const relaxedAway = searchData?.relaxed_away ?? [];
  const hasSearched = !!searchData;
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
            variant={!empty ? "outline" : "ghost"}
            size="sm"
            onClick={resetDraft}
            className="gap-1.5"
            title="Clear all filters (including ones hidden in collapsed sections)"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset filters
          </Button>
        </div>

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
                    (OR: any title matches)
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
                <Label className="text-xs font-medium">Title match mode</Label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="titleMatchMode"
                      value="all_words"
                      checked={
                        !draft.titleMatchMode ||
                        draft.titleMatchMode === "all_words"
                      }
                      onChange={() => set("titleMatchMode", "all_words")}
                      className="accent-primary"
                    />
                    <span className="text-xs">
                      All words{" "}
                      <span className="text-muted-foreground">(default)</span>
                    </span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="titleMatchMode"
                      value="exact_phrase"
                      checked={draft.titleMatchMode === "exact_phrase"}
                      onChange={() => set("titleMatchMode", "exact_phrase")}
                      className="accent-primary"
                    />
                    <span className="text-xs">Exact phrase</span>
                  </label>
                </div>
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
                <AutocompleteTagInput
                  aria-label="Cities"
                  values={draft.locationCities ?? []}
                  onChange={(v) => set("locationCities", v)}
                  placeholder="e.g. Hyderabad"
                  autocompleteField={AC_FIELD_CITY}
                  dataProvider={dataProvider}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">States / regions</Label>
                <AutocompleteTagInput
                  aria-label="States"
                  values={draft.locationStates ?? []}
                  onChange={(v) => set("locationStates", v)}
                  placeholder="e.g. Karnataka"
                  autocompleteField={AC_FIELD_STATE}
                  dataProvider={dataProvider}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Continents
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    (OR)
                  </span>
                </Label>
                <TagInput
                  aria-label="Continents"
                  values={draft.locationContinents ?? []}
                  onChange={(v) => set("locationContinents", v)}
                  placeholder="e.g. Asia, Europe"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label className="text-xs font-medium">Geo radius</Label>
                <div className="flex flex-col gap-1.5">
                  <Input
                    className="h-8 text-sm"
                    value={draft.geoNear ?? ""}
                    onChange={(e) => set("geoNear", e.target.value || null)}
                    placeholder="Center location e.g. San Francisco, CA"
                  />
                  <div className="grid grid-cols-[1fr_80px_auto] gap-2 items-center">
                    <Input
                      className="h-8 text-sm"
                      type="number"
                      min={0}
                      value={draft.geoDistance ?? ""}
                      onChange={(e) =>
                        set(
                          "geoDistance",
                          e.target.value ? parseInt(e.target.value, 10) : null,
                        )
                      }
                      placeholder="Distance"
                    />
                    <Select
                      value={draft.geoUnit ?? "mi"}
                      onValueChange={(v) => set("geoUnit", v as "km" | "mi")}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mi">mi</SelectItem>
                        <SelectItem value="km">km</SelectItem>
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs whitespace-nowrap">
                      <Checkbox
                        checked={draft.geoExcludeNear === true}
                        onCheckedChange={(v) =>
                          set("geoExcludeNear", v === true)
                        }
                        aria-label="Exclude radius"
                      />
                      Exclude radius
                    </label>
                  </div>
                </div>
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
                  Any of these skills
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    (OR — at least one must match)
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
              <label className="flex items-start gap-2 cursor-pointer pt-1">
                <Checkbox
                  checked={draft.recentlyChangedJobs === true}
                  onCheckedChange={(v) =>
                    set("recentlyChangedJobs", v === true)
                  }
                  className="mt-0.5"
                  aria-label="Recently changed jobs"
                />
                <span className="text-xs leading-snug">
                  <span className="font-medium">Recently changed jobs</span>
                  <span className="text-muted-foreground block">
                    Only people Crustdata flags as having started a new role
                    recently
                  </span>
                </span>
              </label>
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
                  Past company — exclude
                </Label>
                <TagInput
                  aria-label="Past company exclude"
                  values={draft.pastCompaniesExclude ?? []}
                  onChange={(v) => set("pastCompaniesExclude", v)}
                  placeholder="e.g. IBM"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Website domains
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    (bare: stripe.com)
                  </span>
                </Label>
                <TagInput
                  aria-label="Company website domains"
                  values={draft.currentCompanyDomains ?? []}
                  onChange={(v) => set("currentCompanyDomains", v)}
                  placeholder="e.g. stripe.com"
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
                <AutocompleteTagInput
                  aria-label="Company industries"
                  values={draft.companyIndustries ?? []}
                  onChange={(v) => set("companyIndustries", v)}
                  placeholder="e.g. Financial Services"
                  autocompleteField={AC_FIELD_INDUSTRIES}
                  dataProvider={dataProvider}
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
                <AutocompleteTagInput
                  aria-label="Schools"
                  values={draft.educationSchools ?? []}
                  onChange={(v) => set("educationSchools", v)}
                  placeholder="e.g. IIT Bombay"
                  autocompleteField={AC_FIELD_SCHOOL}
                  dataProvider={dataProvider}
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
                <AutocompleteTagInput
                  aria-label="Languages"
                  values={draft.languages ?? []}
                  onChange={(v) => set("languages", v)}
                  placeholder="e.g. English"
                  autocompleteField={AC_FIELD_LANGUAGES}
                  dataProvider={dataProvider}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Function categories (OR)
                </Label>
                <TagInput
                  aria-label="Function categories"
                  values={draft.functionCategories ?? []}
                  onChange={(v) => set("functionCategories", v)}
                  placeholder="e.g. Engineering, Sales"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Employment types (OR)
                </Label>
                <TagInput
                  aria-label="Employment types"
                  values={draft.employmentTypes ?? []}
                  onChange={(v) => set("employmentTypes", v)}
                  placeholder="e.g. Full-time, Contract"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">
                  Open-to cards
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    (select signals to require)
                  </span>
                </Label>
                <div className="flex flex-col gap-1.5">
                  {(
                    [
                      "CAREER_INTEREST",
                      "HIRING_MANAGER",
                      "VOLUNTEERING",
                    ] as const
                  ).map((code) => (
                    <label
                      key={code}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Checkbox
                        checked={(draft.openToCards ?? []).includes(code)}
                        onCheckedChange={(v) => {
                          const current = draft.openToCards ?? [];
                          set(
                            "openToCards",
                            v
                              ? ([
                                  ...current,
                                  code,
                                ] as FilterDraft["openToCards"])
                              : (current.filter(
                                  (c) => c !== code,
                                ) as FilterDraft["openToCards"]),
                          );
                        }}
                        aria-label={code}
                      />
                      <span className="text-xs">{code}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium">Connections min</Label>
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
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium">Connections max</Label>
                  <Input
                    className="h-8 text-sm"
                    type="number"
                    min={0}
                    value={draft.connectionsMax ?? ""}
                    onChange={(e) =>
                      set(
                        "connectionsMax",
                        e.target.value ? parseInt(e.target.value, 10) : null,
                      )
                    }
                    placeholder="e.g. 500"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">Followers min</Label>
                <Input
                  className="h-8 text-sm"
                  type="number"
                  min={0}
                  value={draft.followersMin ?? ""}
                  onChange={(e) =>
                    set(
                      "followersMin",
                      e.target.value ? parseInt(e.target.value, 10) : null,
                    )
                  }
                  placeholder="e.g. 1000"
                />
              </div>
            </FilterSection>

            {/* Section 8: Sort */}
            <FilterSection title="Sort">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">Sort by</Label>
                <Select
                  value={draft.sortField ?? "none"}
                  onValueChange={(v) =>
                    set("sortField", !v || v === "none" ? null : v)
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Default (relevance)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Default (relevance)</SelectItem>
                    {SORTABLE_FIELD_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Connections/followers ranks results but Crustdata does not
                  return the counts in search results — order is the signal.
                </p>
              </div>
              {draft.sortField && draft.sortField !== "none" && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium">Order</Label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="sortOrder"
                        value="desc"
                        checked={!draft.sortOrder || draft.sortOrder === "desc"}
                        onChange={() => set("sortOrder", "desc")}
                        className="accent-primary"
                      />
                      <span className="text-xs">Descending</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="sortOrder"
                        value="asc"
                        checked={draft.sortOrder === "asc"}
                        onChange={() => set("sortOrder", "asc")}
                        className="accent-primary"
                      />
                      <span className="text-xs">Ascending</span>
                    </label>
                  </div>
                </div>
              )}
            </FilterSection>

            {/* Active filters — always visible so collapsed sections can't hide constraints */}
            {filterChips.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/20 p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Active filters ({filterChips.length})
                  </p>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    onClick={resetDraft}
                  >
                    Clear all
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {filterChips.map((chip) => (
                    <Badge
                      key={chip}
                      variant="secondary"
                      className="text-[10px] font-normal"
                    >
                      {chip}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Run button + limit */}
            <div className="flex items-center gap-3 pt-1">
              <Button
                onClick={() => runSearch(undefined)}
                disabled={isPending || empty}
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

            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox
                checked={autoWiden}
                onCheckedChange={(v) => setAutoWiden(v === true)}
                className="mt-0.5"
                aria-label="Auto-widen if no results"
              />
              <span className="text-xs text-muted-foreground leading-snug">
                Auto-widen if no results (drops company excludes, extra skills,
                YoE, city — <em className="text-foreground">never</em> changes
                your titles)
              </span>
            </label>

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
                {(error as Error).message ||
                  "Search failed. Check your connection and try again."}
              </div>
            )}

            {hasSearched && !isPending && (
              <>
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    {candidates.length > 0 && (
                      <Checkbox
                        checked={
                          selectedIds.size === candidates.length &&
                          candidates.length > 0
                        }
                        onCheckedChange={toggleSelectAll}
                        aria-label="Select all candidates"
                      />
                    )}
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

                {/* Sticky outreach bar */}
                {selectedIds.size > 0 && (
                  <div className="sticky top-4 z-10 flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-background/95 backdrop-blur px-4 py-2.5 shadow-md">
                    <span className="text-sm text-muted-foreground">
                      {selectedIds.size} selected
                    </span>
                    <Button
                      size="sm"
                      disabled={outreachState === "preparing"}
                      onClick={handleOutreachSelected}
                      className="gap-1.5"
                    >
                      <SendHorizonal className="h-3.5 w-3.5" />
                      {outreachState === "preparing"
                        ? "Preparing…"
                        : `Outreach selected (${selectedIds.size})`}
                    </Button>
                  </div>
                )}

                {(searchError || searchNote || relaxedAway.length > 0) && (
                  <div
                    className={`rounded-lg border p-3 text-xs space-y-1 ${
                      searchError
                        ? "border-destructive/30 bg-destructive/5 text-destructive"
                        : relaxedAway.length > 0 && candidates.length > 0
                          ? "border-amber-500/30 bg-amber-500/5 text-foreground"
                          : "border-border bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    {searchError && (
                      <p className="font-medium text-sm">{searchError}</p>
                    )}
                    {searchNote && <p>{searchNote}</p>}
                    {relaxedAway.length > 0 && (
                      <p className="text-muted-foreground">
                        Widened by dropping: {relaxedAway.join(" → ")}. Titles
                        you entered were kept as written.
                      </p>
                    )}
                    {searchErrorDetail && (
                      <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] opacity-80">
                        {searchErrorDetail}
                      </pre>
                    )}
                  </div>
                )}

                {compiledVisible && (
                  <pre className="text-[10px] bg-muted rounded p-3 overflow-x-auto max-h-48 text-muted-foreground">
                    {JSON.stringify(
                      {
                        filters: compiledFilters,
                        ...(appliedSorts?.length
                          ? { sorts: appliedSorts }
                          : {}),
                      },
                      null,
                      2,
                    )}
                  </pre>
                )}

                {/* Zero-result state */}
                {zeroResults && (
                  <div className="rounded-lg border border-border bg-muted/30 p-5 flex flex-col gap-2">
                    <p className="text-sm font-medium">No candidates found</p>
                    <p className="text-xs text-muted-foreground">
                      Even after auto-relaxing constraints, Crustdata found
                      nothing. Try broader titles (e.g.{" "}
                      <em>Software Engineer</em>) or drop the country filter.
                    </p>
                  </div>
                )}

                {/* Candidate list */}
                {candidates.length > 0 && (
                  <>
                    <div className="rounded-lg border border-border divide-y divide-border">
                      {candidates.map((c) => (
                        <div key={c.id} className="px-4">
                          <CandidateRow
                            c={c}
                            selected={selectedIds.has(c.id)}
                            onToggle={toggleSelect}
                          />
                        </div>
                      ))}
                    </div>
                    {nextCursor && (
                      <div className="flex justify-center pt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() => runSearch(nextCursor)}
                        >
                          {isPending ? "Loading…" : "Load more"}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Role picker dialog ────────────────────────────────────────────── */}
      <Dialog open={rolePickerOpen} onOpenChange={setRolePickerOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Pick a role</DialogTitle>
            <DialogDescription>
              Select the open role to add these candidates to.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
            {dealsQuery.isPending && (
              <p className="text-sm text-muted-foreground py-4 text-center animate-pulse">
                Loading roles…
              </p>
            )}
            {openDeals.length === 0 && !dealsQuery.isPending && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No open roles found.
              </p>
            )}
            {openDeals.map((deal) => (
              <button
                key={deal.id}
                type="button"
                className="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors"
                onClick={() => handlePickRole(Number(deal.id))}
              >
                {deal.name}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Outreach review modal ─────────────────────────────────────────── */}
      <Dialog
        open={outreachState === "reviewing" && outreachQueue.length > 0}
        onOpenChange={(open) => {
          if (!open) handleCancelReview();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Review outreach — {outreachQueue[queueIdx]?.name}
            </DialogTitle>
            <DialogDescription>
              {queueIdx + 1} of {outreachQueue.length}
            </DialogDescription>
          </DialogHeader>
          {outreachQueue[queueIdx] && (
            <OutreachPreviewPanel
              prepared={outreachQueue[queueIdx].prepared}
              onPreparedChange={handleUpdatePrepared}
              onConfirm={handleConfirmSend}
              onCancel={handleCancelReview}
              confirming={confirming}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
