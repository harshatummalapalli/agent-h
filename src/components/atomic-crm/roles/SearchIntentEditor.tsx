// SearchIntentEditor — editable chip editor for recruiter sourcing intent.
//
// Shows three disposition columns (Require / Prefer / Exclude) as chips grouped
// by category. A "Your judgment" panel surfaces one-click packs:
//   • Leadership title excludes
//   • Company exclude input
//   • Career interest (prefer open-to-new-opportunities)
//   • Unenforceable / soft-constraint notes
//
// Designed to be used at JD intake (seeded from parsedBriefToConditions) and
// inline on the Role workspace (editing the persisted SearchIntent).
//
// Props:
//   initialConditions     — seed chips (not controlled after mount)
//   initialUnenforceable  — seed soft-constraint notes
//   onSave(conditions, unenforceable) — called when recruiter clicks "Save"
//   onContinue            — optional; if present shows "Continue to search"
//   saveLabel             — override Save button label
//   saving                — disable buttons while parent is async
//
// Internally state is fully controlled; callers receive the final arrays on save.

import { useState } from "react";
import { X, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  SearchIntentCategory,
  SearchIntentCondition,
  SearchIntentDisposition,
  UnenforcedConstraint,
} from "../types";

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<SearchIntentCategory, string> = {
  title: "Title",
  skill: "Skill",
  location: "Location",
  company: "Company",
  experience_range: "Experience",
  seniority: "Seniority",
  other: "Other",
};

const CATEGORY_OPTIONS: SearchIntentCategory[] = [
  "skill",
  "title",
  "location",
  "company",
  "seniority",
  "experience_range",
  "other",
];

const DISPOSITION_CONFIG: Record<
  SearchIntentDisposition,
  { label: string; emptyHint: string; chipCls: string; headerCls: string }
> = {
  require: {
    label: "Require",
    emptyHint: "Add a must-have",
    chipCls:
      "bg-green-50 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-200 dark:border-green-800",
    headerCls: "text-green-700 dark:text-green-400",
  },
  prefer: {
    label: "Prefer",
    emptyHint: "Add a nice-to-have",
    chipCls:
      "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-800",
    headerCls: "text-blue-700 dark:text-blue-400",
  },
  exclude: {
    label: "Exclude",
    emptyHint: "Add a hard exclude",
    chipCls:
      "bg-red-50 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800",
    headerCls: "text-red-700 dark:text-red-400",
  },
};

const LEADERSHIP_EXCLUDE_VALUES = [
  "Architect",
  "Manager",
  "VP",
  "Director",
  "CxO",
  "CEO",
  "CTO",
  "CFO",
  "COO",
  "Founder",
  "Head of",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function conditionKey(c: SearchIntentCondition): string {
  return `${c.category}:${c.disposition}:${c.value.toLowerCase()}`;
}

// ─── Chip component ───────────────────────────────────────────────────────────

function Chip({
  condition,
  onRemove,
}: {
  condition: SearchIntentCondition;
  onRemove: () => void;
}) {
  const chipCls = DISPOSITION_CONFIG[condition.disposition].chipCls;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${chipCls}`}
    >
      <span className="opacity-60 text-[10px]">
        {CATEGORY_LABELS[condition.category]}
      </span>
      <span>{condition.value}</span>
      <button
        type="button"
        aria-label={`Remove ${condition.value}`}
        onClick={onRemove}
        className="ml-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 p-0.5"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

// ─── AddChipInput — category select + value input per disposition column ──────

function AddChipInput({
  disposition,
  onAdd,
}: {
  disposition: SearchIntentDisposition;
  onAdd: (c: SearchIntentCondition) => void;
}) {
  const [category, setCategory] = useState<SearchIntentCategory>("skill");
  const [value, setValue] = useState("");
  const placeholder = DISPOSITION_CONFIG[disposition].emptyHint;

  const commit = () => {
    const v = value.trim();
    if (!v) return;
    onAdd({ category, disposition, value: v });
    setValue("");
  };

  return (
    <div className="flex items-center gap-1.5 mt-2">
      <select
        aria-label="Category"
        className="h-7 rounded-md border border-input bg-background text-xs px-1.5 text-foreground"
        value={category}
        onChange={(e) => setCategory(e.target.value as SearchIntentCategory)}
      >
        {CATEGORY_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {CATEGORY_LABELS[opt]}
          </option>
        ))}
      </select>
      <Input
        className="h-7 text-xs flex-1 min-w-0"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      <button
        type="button"
        aria-label="Add chip"
        onClick={commit}
        disabled={!value.trim()}
        className="shrink-0 h-7 w-7 flex items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── DispositionPanel ─────────────────────────────────────────────────────────

function DispositionPanel({
  disposition,
  conditions,
  onAdd,
  onRemove,
}: {
  disposition: SearchIntentDisposition;
  conditions: SearchIntentCondition[];
  onAdd: (c: SearchIntentCondition) => void;
  onRemove: (key: string) => void;
}) {
  const { label, headerCls } = DISPOSITION_CONFIG[disposition];

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 flex-1 min-w-0">
      <p
        className={`text-xs font-semibold uppercase tracking-wide ${headerCls}`}
      >
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5 min-h-[2rem]">
        {conditions.length === 0 && (
          <span className="text-xs text-muted-foreground/60 italic">
            None yet
          </span>
        )}
        {conditions.map((c) => (
          <Chip
            key={conditionKey(c)}
            condition={c}
            onRemove={() => onRemove(conditionKey(c))}
          />
        ))}
      </div>
      <AddChipInput disposition={disposition} onAdd={onAdd} />
    </div>
  );
}

// ─── JudgmentPacks ────────────────────────────────────────────────────────────

function JudgmentPacks({
  conditions,
  unenforceable,
  onAddCondition,
  onRemoveCondition,
  onAddUnenforceable,
  onRemoveUnenforceable,
}: {
  conditions: SearchIntentCondition[];
  unenforceable: UnenforcedConstraint[];
  onAddCondition: (c: SearchIntentCondition) => void;
  onRemoveCondition: (key: string) => void;
  onAddUnenforceable: (u: UnenforcedConstraint) => void;
  onRemoveUnenforceable: (i: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const [companyInput, setCompanyInput] = useState("");
  const [noteInput, setNoteInput] = useState("");

  const leadershipActive = LEADERSHIP_EXCLUDE_VALUES.every((v) =>
    conditions.some(
      (c) =>
        conditionKey(c) ===
        conditionKey({ category: "title", disposition: "exclude", value: v }),
    ),
  );

  const careerInterestKey = conditionKey({
    category: "other",
    disposition: "prefer",
    value: "open to new opportunities",
  });
  const careerInterestActive = conditions.some(
    (c) => conditionKey(c) === careerInterestKey,
  );

  const toggleLeadership = () => {
    if (leadershipActive) {
      LEADERSHIP_EXCLUDE_VALUES.forEach((v) =>
        onRemoveCondition(
          conditionKey({ category: "title", disposition: "exclude", value: v }),
        ),
      );
    } else {
      LEADERSHIP_EXCLUDE_VALUES.forEach((v) => {
        const key = conditionKey({
          category: "title",
          disposition: "exclude",
          value: v,
        });
        if (!conditions.some((c) => conditionKey(c) === key)) {
          onAddCondition({
            category: "title",
            disposition: "exclude",
            value: v,
          });
        }
      });
    }
  };

  const toggleCareerInterest = () => {
    if (careerInterestActive) {
      onRemoveCondition(careerInterestKey);
    } else {
      onAddCondition({
        category: "other",
        disposition: "prefer",
        value: "open to new opportunities",
      });
    }
  };

  const addCompanyExclude = () => {
    const v = companyInput.trim();
    if (!v) return;
    onAddCondition({ category: "company", disposition: "exclude", value: v });
    setCompanyInput("");
  };

  const addNote = () => {
    const v = noteInput.trim();
    if (!v) return;
    onAddUnenforceable({
      description: v,
      reason: "Cannot hard-filter — flag for manual review",
    });
    setNoteInput("");
  };

  const excludedCompanies = conditions.filter(
    (c) => c.category === "company" && c.disposition === "exclude",
  );

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        type="button"
        className="flex items-center gap-2 w-full px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        Your judgment
      </button>

      {open && (
        <div className="px-4 pb-4 flex flex-col gap-4">
          {/* Leadership exclude pack */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-foreground">
                Exclude leadership titles
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Architect, Manager, VP, Director, CxO, Founder, Head of…
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={leadershipActive}
              onClick={toggleLeadership}
              className={`shrink-0 mt-0.5 h-5 w-9 rounded-full transition-colors ${
                leadershipActive ? "bg-primary" : "bg-muted-foreground/30"
              }`}
            >
              <span
                className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  leadershipActive ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {/* Company exclude input */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs font-medium">Exclude company</Label>
            <div className="flex gap-1.5">
              <Input
                className="h-7 text-xs flex-1"
                placeholder="e.g. TCS, Wipro"
                value={companyInput}
                onChange={(e) => setCompanyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCompanyExclude();
                  }
                }}
              />
              <button
                type="button"
                aria-label="Add company exclude"
                onClick={addCompanyExclude}
                disabled={!companyInput.trim()}
                className="shrink-0 h-7 w-7 flex items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {excludedCompanies.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {excludedCompanies.map((c) => (
                  <Chip
                    key={conditionKey(c)}
                    condition={c}
                    onRemove={() => onRemoveCondition(conditionKey(c))}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Career interest toggle */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-foreground">
                Prefer open to new opportunities
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Prefer candidates signaling career interest
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={careerInterestActive}
              onClick={toggleCareerInterest}
              className={`shrink-0 mt-0.5 h-5 w-9 rounded-full transition-colors ${
                careerInterestActive ? "bg-primary" : "bg-muted-foreground/30"
              }`}
            >
              <span
                className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  careerInterestActive ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {/* Unenforceable / soft notes */}
          <div className="flex flex-col gap-2">
            <div>
              <Label className="text-xs font-medium">
                Soft constraints (cannot hard-filter)
              </Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Visa status, salary band, notice period — noted, never faked as
                hard filters.
              </p>
            </div>
            <div className="flex gap-1.5">
              <Input
                className="h-7 text-xs flex-1"
                placeholder="e.g. No H1-B, max ₹30 LPA"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addNote();
                  }
                }}
              />
              <button
                type="button"
                aria-label="Add soft constraint"
                onClick={addNote}
                disabled={!noteInput.trim()}
                className="shrink-0 h-7 w-7 flex items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {unenforceable.length > 0 && (
              <ul className="flex flex-col gap-1">
                {unenforceable.map((u, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <span className="text-orange-500 shrink-0">~</span>
                    <span className="flex-1">{u.description}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${u.description}`}
                      onClick={() => onRemoveUnenforceable(i)}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SearchIntentEditor ───────────────────────────────────────────────────────

export type SearchIntentEditorProps = {
  initialConditions?: SearchIntentCondition[];
  initialUnenforceable?: UnenforcedConstraint[];
  onSave: (
    conditions: SearchIntentCondition[],
    unenforceable: UnenforcedConstraint[],
  ) => void | Promise<void>;
  onContinue?: (
    conditions: SearchIntentCondition[],
    unenforceable: UnenforcedConstraint[],
  ) => void | Promise<void>;
  saveLabel?: string;
  continueLabel?: string;
  saving?: boolean;
};

export function SearchIntentEditor({
  initialConditions = [],
  initialUnenforceable = [],
  onSave,
  onContinue,
  saveLabel = "Save role",
  continueLabel = "Continue to search",
  saving = false,
}: SearchIntentEditorProps) {
  const [conditions, setConditions] =
    useState<SearchIntentCondition[]>(initialConditions);
  const [unenforceable, setUnenforceable] =
    useState<UnenforcedConstraint[]>(initialUnenforceable);

  const addCondition = (c: SearchIntentCondition) => {
    const key = conditionKey(c);
    setConditions((prev) =>
      prev.some((x) => conditionKey(x) === key) ? prev : [...prev, c],
    );
  };

  const removeCondition = (key: string) => {
    setConditions((prev) => prev.filter((c) => conditionKey(c) !== key));
  };

  const require = conditions.filter((c) => c.disposition === "require");
  const prefer = conditions.filter((c) => c.disposition === "prefer");
  const exclude = conditions.filter((c) => c.disposition === "exclude");

  return (
    <div className="flex flex-col gap-4">
      {/* Disposition panels */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(["require", "prefer", "exclude"] as SearchIntentDisposition[]).map(
          (disp) => (
            <DispositionPanel
              key={disp}
              disposition={disp}
              conditions={
                disp === "require"
                  ? require
                  : disp === "prefer"
                    ? prefer
                    : exclude
              }
              onAdd={addCondition}
              onRemove={removeCondition}
            />
          ),
        )}
      </div>

      {/* Judgment packs */}
      <JudgmentPacks
        conditions={conditions}
        unenforceable={unenforceable}
        onAddCondition={addCondition}
        onRemoveCondition={removeCondition}
        onAddUnenforceable={(u) => setUnenforceable((prev) => [...prev, u])}
        onRemoveUnenforceable={(i) =>
          setUnenforceable((prev) => prev.filter((_, idx) => idx !== i))
        }
      />

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          onClick={() => onSave(conditions, unenforceable)}
          disabled={saving}
          variant="outline"
        >
          {saving ? "Saving…" : saveLabel}
        </Button>
        {onContinue && (
          <Button
            onClick={() => onContinue(conditions, unenforceable)}
            disabled={saving}
          >
            {saving ? "Saving…" : continueLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
