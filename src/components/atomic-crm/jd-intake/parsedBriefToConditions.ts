// Map a ParsedRoleBrief (from parseJobDescription) into an initial set of
// SearchIntentConditions. Pure function — no side effects, no LLM call.
//
// Rules:
//   title                              → title/require
//   seniority                          → seniority/require
//   location                           → location/require (one chip; recruiter can split)
//   years_experience_{min,max}         → experience_range/require
//   required_skills + must_have_keywords → skill/require  (deduplicated)
//   nice_to_have_keywords              → skill/prefer
//   preference_tiers[*].keywords       → skill/prefer
//   excluded_companies                 → company/exclude
//   exclusion_keywords                 → title/exclude
//
// Never invent leadership excludes or client excludes — those are "judgment
// packs" only a recruiter can toggle intentionally.

import type { SearchIntentCondition } from "../types";

export type ParsedBriefInput = {
  title?: string;
  seniority?: string;
  location?: string;
  years_experience_min?: number | null;
  years_experience_max?: number | null;
  required_skills?: string[];
  must_have_keywords?: string[];
  nice_to_have_keywords?: string[];
  preference_tiers?: Array<{
    rank: number;
    label: string;
    keywords: string[];
    condition?: string | null;
  }>;
  excluded_companies?: string[];
  exclusion_keywords?: string[];
};

export function parsedBriefToConditions(
  brief: ParsedBriefInput,
): SearchIntentCondition[] {
  const conditions: SearchIntentCondition[] = [];

  const add = (c: SearchIntentCondition) => {
    if (c.value.trim()) conditions.push({ ...c, value: c.value.trim() });
  };

  // Title
  if (brief.title?.trim()) {
    add({ category: "title", disposition: "require", value: brief.title });
  }

  // Seniority
  if (brief.seniority?.trim()) {
    add({
      category: "seniority",
      disposition: "require",
      value: brief.seniority,
    });
  }

  // Location — single chip; split on " / " if multiple cities are joined
  if (brief.location?.trim()) {
    const parts = brief.location.split(/\s*\/\s*/);
    for (const part of parts) {
      if (part.trim()) {
        add({ category: "location", disposition: "require", value: part });
      }
    }
  }

  // Experience range
  const yoeMin = brief.years_experience_min ?? null;
  const yoeMax = brief.years_experience_max ?? null;
  if (yoeMin !== null || yoeMax !== null) {
    let value: string;
    if (yoeMin !== null && yoeMax !== null) {
      value = `${yoeMin}-${yoeMax}`;
    } else if (yoeMin !== null) {
      value = `min:${yoeMin}`;
    } else {
      value = `max:${yoeMax}`;
    }
    add({ category: "experience_range", disposition: "require", value });
  }

  // required_skills → skill/require
  const seenSkillRequire = new Set<string>();
  for (const s of brief.required_skills ?? []) {
    const v = s.trim().toLowerCase();
    if (v && !seenSkillRequire.has(v)) {
      seenSkillRequire.add(v);
      add({ category: "skill", disposition: "require", value: s });
    }
  }

  // must_have_keywords → skill/require (deduplicate against required_skills)
  for (const kw of brief.must_have_keywords ?? []) {
    const v = kw.trim().toLowerCase();
    if (v && !seenSkillRequire.has(v)) {
      seenSkillRequire.add(v);
      add({ category: "skill", disposition: "require", value: kw });
    }
  }

  // nice_to_have_keywords → skill/prefer
  const seenSkillPrefer = new Set<string>();
  for (const kw of brief.nice_to_have_keywords ?? []) {
    const v = kw.trim().toLowerCase();
    if (v && !seenSkillPrefer.has(v)) {
      seenSkillPrefer.add(v);
      add({ category: "skill", disposition: "prefer", value: kw });
    }
  }

  // preference_tiers → skill/prefer (secondary tiers)
  for (const tier of brief.preference_tiers ?? []) {
    for (const kw of tier.keywords ?? []) {
      const v = kw.trim().toLowerCase();
      if (v && !seenSkillPrefer.has(v)) {
        seenSkillPrefer.add(v);
        add({ category: "skill", disposition: "prefer", value: kw });
      }
    }
  }

  // excluded_companies → company/exclude
  for (const company of brief.excluded_companies ?? []) {
    if (company.trim()) {
      add({ category: "company", disposition: "exclude", value: company });
    }
  }

  // exclusion_keywords → title/exclude
  for (const kw of brief.exclusion_keywords ?? []) {
    if (kw.trim()) {
      add({ category: "title", disposition: "exclude", value: kw });
    }
  }

  return conditions;
}
