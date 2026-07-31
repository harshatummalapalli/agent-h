// Seniority taxonomy — table-driven lookup replacing string-shape heuristics.
//
// No Deno-specific imports — Vitest-compatible (mirrors searchIntent.ts pattern).
//
// Usage:
//   const canonical = resolveSeniority("Mid-Level"); // → "mid_level"
//   const crustVocab = SENIORITY_CRUSTDATA_VOCAB["mid_level"]; // → ["Mid Level", ...]
//   if (!canonical) logUnresolved("seniority", raw, dealId);

export type CanonicalSeniority =
  | "intern"
  | "entry_level"
  | "mid_level"
  | "senior"
  | "staff"
  | "principal"
  | "manager"
  | "director"
  | "executive";

// Maps ANY known phrasing → canonical value.
// Grows only by adding rows — never by adding compiler if-branches.
//
// Open decision (2026-07-30): "Lead" → "staff" for v1.
// Rationale: JD vocabulary "Lead Engineer" / "Tech Lead" maps closest to Staff IC
// in the Crustdata seniority ladder. Adjust by changing this single row.
export const SENIORITY_ALIASES: Record<string, CanonicalSeniority> = {
  // intern
  intern: "intern",
  internship: "intern",
  "summer intern": "intern",

  // entry_level
  entry: "entry_level",
  "entry level": "entry_level",
  entry_level: "entry_level",
  junior: "entry_level",
  "jr.": "entry_level",
  jr: "entry_level",
  associate: "entry_level",
  "0-2 years": "entry_level",

  // mid_level
  mid: "mid_level",
  "mid level": "mid_level",
  "mid-level": "mid_level",
  mid_level: "mid_level",
  "mid level engineer": "mid_level",
  intermediate: "mid_level",
  "3-5 years": "mid_level",
  "2-5 years": "mid_level",
  "2-4 years": "mid_level",
  "non-senior": "mid_level",

  // senior
  senior: "senior",
  "sr.": "senior",
  sr: "senior",
  "sr engineer": "senior",
  "senior engineer": "senior",
  "senior developer": "senior",
  "5+ years": "senior",
  "5-8 years": "senior",
  "6+ years": "senior",

  // staff (includes "Lead" → staff, v1 decision)
  staff: "staff",
  "staff engineer": "staff",
  "staff developer": "staff",
  l5: "staff",
  ic5: "staff",
  lead: "staff",
  "tech lead": "staff",
  "technical lead": "staff",
  "lead engineer": "staff",
  "senior staff": "staff",
  "senior staff engineer": "staff",

  // principal
  principal: "principal",
  "principal engineer": "principal",
  "principal developer": "principal",
  l6: "principal",
  ic6: "principal",

  // manager
  manager: "manager",
  "engineering manager": "manager",
  em: "manager",
  "eng manager": "manager",
  "team lead": "manager",

  // director
  director: "director",
  "director of engineering": "director",
  "engineering director": "director",

  // executive
  executive: "executive",
  vp: "executive",
  "vice president": "executive",
  svp: "executive",
  "senior vice president": "executive",
  cto: "executive",
  "chief technology officer": "executive",
  "chief engineer": "executive",
};

/** All canonical seniority values, in ascending order of seniority. */
export const SENIORITY_CANONICALS: CanonicalSeniority[] = [
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

/** Resolve a raw seniority string to a canonical value, or null if unrecognized. */
export function resolveSeniority(raw: string): CanonicalSeniority | null {
  const key = raw.trim().toLowerCase();
  return SENIORITY_ALIASES[key] ?? null;
}

// Maps canonical seniority → the words that appear in real Crustdata profiles,
// OR'd together when building the filter.
//
// These are the actual values Crustdata's seniority_level field contains.
// When adding a new canonical: check the Crustdata capability manifest for
// confirmed vocabulary. When unsure, err on the side of more variants.
export const SENIORITY_CRUSTDATA_VOCAB: Record<CanonicalSeniority, string[]> = {
  intern: ["Intern", "Internship"],
  entry_level: ["Entry Level", "Junior", "Associate", "Entry"],
  mid_level: ["Mid Level", "Intermediate", "Mid-Level"],
  senior: ["Senior", "Sr."],
  staff: ["Staff", "Staff Engineer", "L5", "Senior Staff", "Tech Lead", "Lead"],
  principal: ["Principal", "Principal Engineer", "L6"],
  manager: ["Manager", "Engineering Manager"],
  director: ["Director"],
  executive: ["Executive", "VP", "Vice President", "CTO", "SVP"],
};
