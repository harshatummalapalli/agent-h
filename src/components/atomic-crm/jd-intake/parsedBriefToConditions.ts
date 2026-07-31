// Map a ParsedRoleBrief (from parseJobDescription) into an initial set of
// SearchIntentConditions. Pure function — no side effects, no LLM call.
//
// Rules:
//   title                              → title/require
//   seniority                          → seniority/require
//   location                           → location/require (one chip; recruiter can split)
//   years_experience_{min,max}         → experience_range/require
//   required_skills + must_have_keywords → skill/require  (deduplicated, normalized)
//   nice_to_have_keywords              → skill/prefer     (normalized)
//   preference_tiers[*].keywords       → skill/prefer     (normalized)
//   excluded_companies                 → company/exclude
//   exclusion_keywords                 → title/exclude
//
// Never invent leadership excludes or client excludes — those are "judgment
// packs" only a recruiter can toggle intentionally.

import type { SearchIntentCondition, UnenforcedConstraint } from "../types";
import { resolveLocation } from "../../../../supabase/functions/_shared/taxonomies/location";

// ─── Skill normalizer ─────────────────────────────────────────────────────────
//
// Defense-in-depth layer that runs AFTER the LLM parse. Ensures skill tokens
// are atomic even when the model returns prose fragments like
// "Enterprise applications with C#/.NET" or "Python programming".
//
// Primary defense is the system prompt in parse-job-description/index.ts;
// this function is the second layer so even cached / old parse results stay clean.

// Common filler prefixes that wrap a skill token.
const FILLER_PREFIX_RE =
  /^(?:knowledge of|familiarity with|experience (?:with|in)|proficiency in|working knowledge of|understanding of|expertise in|background in|exposure to|skilled in|experience and knowledge of)\s+/i;

// Common filler suffixes that follow a skill token.
const FILLER_SUFFIX_RE =
  /\s+(?:programming|development|experience|knowledge|skills?|expertise|proficiency|background|applications?|technologies?|tools?|frameworks?|engineering|concepts?|principles?)\b.*$/i;

// YoE phrases and soft skills — any token matching these is dropped entirely.
const YOE_OR_PROSE_RE =
  /\b\d+\+?\s*(?:years?|yrs?)\b|^(?:bachelor'?s|master'?s|phd|mba|degree\b)|excellent\s+communication|team\s+player|problem[\s-]solv|strong\s+(?:written|verbal|oral|interpersonal)/i;

// Placeholder values the LLM should not emit but sometimes does.
const PLACEHOLDER_RE =
  /^(?:<unknown>|unknown|n\/a|n\.a\.|tbd|tba|none|not\s+(?:specified|stated|mentioned|applicable)|\?+|-)$/i;

/** Heuristic: is this short string likely a technology / tool name? */
function looksLikeTechToken(s: string): boolean {
  if (!s || s.length > 40) return false;
  const words = s.trim().split(/\s+/);
  if (words.length > 3) return false;
  // Positive signals: camelCase, special chars common in tech names, version digits, all-caps acronym
  if (/[A-Z][a-z]|[a-z][A-Z]|[.#+@]|\d|^[A-Z]{2,}$/.test(s)) return true;
  // Short single word (≤ 12 chars) is likely a tool/language name
  if (words.length === 1 && s.length <= 12) return true;
  // Two short words like "SQL Server", "Spring Boot", "Node js"
  if (words.length === 2 && words.every((w) => w.length <= 10)) return true;
  return false;
}

/**
 * Strip prose filler context around a technology name.
 *
 * Examples:
 *   "Enterprise applications with C#/.NET" → "C#/.NET"
 *   "familiarity with Kubernetes"          → "Kubernetes"
 *   "Python programming"                   → "Python"  (suffix stripped later)
 */
function stripFillerContext(token: string): string {
  // Pattern: "[one or more prose words] with <tech>" — extract the tech part.
  // Covers: "Enterprise applications with C#/.NET", "built with React", "familiarity with X"
  const withMatch = token.match(/^(?:\w[\w-]*\s+)+\bwith\s+(.+)$/i);
  if (withMatch) {
    return withMatch[1].trim();
  }
  return token
    .replace(FILLER_PREFIX_RE, "")
    .replace(FILLER_SUFFIX_RE, "")
    .trim();
}

/**
 * Split a (possibly compound) token into atomic skill tokens.
 *
 * Splits on:
 *   /   → always (e.g. "C#/.NET", "React/Vue/Angular")
 *   or  → when at least one side looks like a tech token
 *   and → only when ALL sides look like tech tokens (avoids splitting "communication and leadership")
 */
function splitAlternatives(token: string): string[] {
  // Slash split (not URLs)
  if (token.includes("/") && !token.startsWith("http")) {
    const parts = token
      .split("/")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 1 && parts.every(looksLikeTechToken)) {
      return parts;
    }
  }

  // " or " split — apply when at least one side is a clear tech token
  const orParts = token
    .split(/\s+or\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (orParts.length > 1 && orParts.some(looksLikeTechToken)) {
    return orParts;
  }

  // " and " split — conservative; require ALL sides to look like tech tokens
  const andParts = token
    .split(/\s+and\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (andParts.length > 1 && andParts.every(looksLikeTechToken)) {
    return andParts;
  }

  return [token];
}

/**
 * Normalize a raw array of skill strings into atomic, deduplicated skill tokens.
 *
 * - Splits "C#/.NET", "Python or Java", "React and Vue" into separate tokens
 * - Strips filler words: "programming", "development", "knowledge of", etc.
 * - Drops YoE phrases ("5+ years experience"), soft skills, degree requirements
 * - Drops placeholder values ("<UNKNOWN>", "N/A", "TBD", etc.)
 * - Deduplicates case-insensitively
 */
export function normalizeSkillTokens(raw: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawToken of raw) {
    const trimmed = rawToken.trim();
    if (!trimmed) continue;

    // Drop YoE / prose phrases before splitting
    if (YOE_OR_PROSE_RE.test(trimmed)) continue;

    // Drop placeholder values
    if (PLACEHOLDER_RE.test(trimmed)) continue;

    // Strip filler context, then split compound tokens
    const extracted = stripFillerContext(trimmed);
    const parts = splitAlternatives(extracted);

    for (const part of parts) {
      // Apply filler stripping to each split part too (defensive)
      const cleaned = part
        .replace(FILLER_PREFIX_RE, "")
        .replace(FILLER_SUFFIX_RE, "")
        .trim();

      if (!cleaned) continue;
      if (YOE_OR_PROSE_RE.test(cleaned)) continue;
      if (PLACEHOLDER_RE.test(cleaned)) continue;

      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(cleaned);
    }
  }

  return result;
}

// ─── Location guard ───────────────────────────────────────────────────────────

// Values the LLM may return for an unknown location — skip chip creation for these.
const UNKNOWN_LOCATION_RE =
  /^(?:<unknown>|unknown|n\/a|n\.a\.|tbd|tba|none|not\s+(?:specified|stated|mentioned|applicable|available)|\?+|-)$/i;

function isUnknownLocation(loc: string): boolean {
  return UNKNOWN_LOCATION_RE.test(loc.trim());
}

// ─── Location splitter ─────────────────────────────────────────────────────────
//
// Splits a location string on /, comma, or " or " separators to extract
// individual city/country tokens. Also strips qualifying phrases like
// "within the United States" that follow a remote token, so "fully remote
// within the United States" → ["remote"].

function splitLocationString(location: string): string[] {
  // Remove qualifiers that follow "remote": "remote within the United States",
  // "fully remote within X", etc. Extract just the "remote" word.
  const remoteQualifierRe =
    /\bfully\s+remote\b|\bremote\s+(?:within|in|across|throughout)\b[^,/]*/gi;
  const normalized = location.replace(remoteQualifierRe, "remote");

  // Split on " / ", ", or ", ", ", or " or " (in order of specificity).
  return normalized
    .split(/\s*\/\s*|,\s+or\s+|\s+or\s+|,\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

// ─── Main converter ───────────────────────────────────────────────────────────

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

  // Location — skip unknown/placeholder values; split on multi-city separators.
  // Handles:
  //   "San Francisco / Austin"              (legacy slash form)
  //   "San Francisco, Austin"               (comma-separated)
  //   "San Francisco, Austin, or Remote"    (comma + or)
  //   "San Francisco or Austin"             (or-separated)
  // "remote" (any casing) is treated as a non-geographic flag, not a city —
  // emitted as other/require so it doesn't pollute the location compiler path.
  if (brief.location?.trim() && !isUnknownLocation(brief.location)) {
    const rawParts = splitLocationString(brief.location);
    for (const raw of rawParts) {
      const part = raw.trim();
      if (!part || isUnknownLocation(part)) continue;

      // Remote flag: any part that is (or contains) the word "remote".
      if (/\bremote\b/i.test(part)) {
        add({
          category: "other",
          disposition: "require",
          value: "remote",
          note: "remote-ok flag",
        });
        continue;
      }

      const resolved = resolveLocation(part);
      // Use the canonical name so the compiler always sees the resolved form;
      // emit unknown locations anyway so the recruiter can edit the chip.
      add({
        category: "location",
        disposition: "require",
        value: resolved.kind === "unknown" ? part : resolved.canonical,
      });
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

  // required_skills + must_have_keywords → skill/require (up to MAX_REQUIRE),
  // then skill/prefer for the remainder.
  //
  // Spec §4.1: "only skills the recruiter explicitly marks, or that the JD
  // states with unambiguous hard language stay Require; everything else Prefer."
  // A JD with 6+ stated must-haves → zero-candidate search by default — cap at
  // MAX_REQUIRE so at most 2-3 are hard filters, the rest rank via prefer.
  const MAX_REQUIRE = 3;
  const seenSkillRequire = new Set<string>();
  let requireCount = 0;

  const allHardSkills = [
    ...normalizeSkillTokens(brief.required_skills ?? []),
    ...normalizeSkillTokens(brief.must_have_keywords ?? []),
  ];

  for (const s of allHardSkills) {
    const v = s.toLowerCase();
    if (seenSkillRequire.has(v)) continue;
    seenSkillRequire.add(v);
    if (requireCount < MAX_REQUIRE) {
      add({ category: "skill", disposition: "require", value: s });
      requireCount++;
    } else {
      // Overflow → prefer so the search doesn't zero out.
      add({ category: "skill", disposition: "prefer", value: s });
    }
  }

  // nice_to_have_keywords → skill/prefer (normalized)
  const seenSkillPrefer = new Set<string>();
  for (const kw of normalizeSkillTokens(brief.nice_to_have_keywords ?? [])) {
    const v = kw.toLowerCase();
    if (!seenSkillPrefer.has(v)) {
      seenSkillPrefer.add(v);
      add({ category: "skill", disposition: "prefer", value: kw });
    }
  }

  // preference_tiers → skill/prefer (normalized)
  for (const tier of brief.preference_tiers ?? []) {
    for (const kw of normalizeSkillTokens(tier.keywords ?? [])) {
      const v = kw.toLowerCase();
      if (!seenSkillPrefer.has(v)) {
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

// ─── Unenforceable constraint extraction ──────────────────────────────────────
//
// Education / degree requirements (bachelor's, master's, PhD, MBA, etc.) are
// not filterable on Crustdata.  parsedBriefToConditions drops them via
// YOE_OR_PROSE_RE.  Instead of silently losing them, surface them as
// UnenforcedConstraint[] so the Prefer tab can show them as context.

const DEGREE_RE =
  /\b(bachelor'?s?|master'?s?|m\.?s\.?|b\.?s\.?|b\.?a\.?|m\.?b\.?a\.?|m\.?eng\.?|phd|ph\.?d\.?|doctorate|mba|bsc|msc)\b/i;

/**
 * Scan the raw skill arrays of a ParsedRoleBrief for degree/education tokens
 * that parsedBriefToConditions would otherwise drop, and return them as
 * UnenforcedConstraint[] for display in the Prefer tab.
 *
 * Pure function — no side effects.
 */
export function extractUnenforceableFromBrief(
  brief: ParsedBriefInput,
): UnenforcedConstraint[] {
  const candidates = [
    ...(brief.required_skills ?? []),
    ...(brief.must_have_keywords ?? []),
  ];

  const seen = new Set<string>();
  const result: UnenforcedConstraint[] = [];

  for (const raw of candidates) {
    const token = raw.trim();
    if (!token) continue;
    if (!DEGREE_RE.test(token)) continue;

    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      description: token,
      reason:
        "Crustdata does not filter by education level — shown as context only",
    });
  }

  return result;
}
