// Crustdata query-builder (pure, no I/O, no Deno-specific imports) -- kept in
// its own file, separate from crustdataProvider's HTTP call in index.ts, so
// this mapping logic can be unit-tested directly under Vitest without
// dragging in index.ts's "jsr:@panva/jose@6" / edge-runtime imports (Deno-
// only, not resolvable under Node/Vitest). See crustdataQueryBuilder.test.ts.
//
// Crustdata second-provider addition (2026-07-23): added alongside the
// existing coresignalProvider so the platform can switch or fall back
// between vendors without an architectural rewrite -- see the
// DISCOVERY_PROVIDERS header comment in index.ts. This is explicitly a
// "build it now even though we haven't picked a winner" addition: the
// business reason is optionality (switch under a pricing crunch, fall back
// if one vendor degrades, hedge against either vendor's future pricing/plan
// changes), not a decision that Crustdata has won over Coresignal.
//
// API shape confirmed directly against Crustdata's live OpenAPI spec
// (docs.crustdata.com/api-reference/person-apis/search-people-using-filters-
// and-sorting, fetched 2026-07-23) AND live API testing this session, not
// docs-only:
//   POST https://api.crustdata.com/person/search
//   Header: Authorization: Bearer <CRUSTDATA_API_KEY>, x-api-version: 2025-11-01
//   Body: { filters: PersonSearchCondition | PersonSearchConditionGroup, limit }
//   A single condition: { field: "<dot.notation.path>", type: "<operator>", value }
//   A group: { op: "and" | "or", conditions: [...] }
//   Response: { profiles: [...], next_cursor, total_count, total_count_relation? }
//
// Operator-set discrepancy, disclosed rather than silently picking one:
// live testing this session confirmed "<=" behaving as expected AND
// confirmed "has_all" (nested-array cross-element match) as real, working
// operators -- but the live OpenAPI spec fetched the same session lists the
// canonical enum as =, !=, <, =<, >, =>, in, not_in, (.), (!), [.],
// geo_distance, geo_exclude (no "<=", no "has_all"; "=<"/"=>" instead of
// "<="/">=", with the spec explicitly warning: "Use '=<' and '=>' instead of
// '<=' and '>='"). This module follows the SPEC's operators for anything
// this file actually sends (=<, =>, ., etc.) since it's the more current,
// authoritative source of truth, but keeps "has_all" and "<=" in the type
// union below (unused by this file today) since live testing did observe
// them work -- a real API surface, just not the one this query-builder
// happens to need yet, not removed to keep the discrepancy visible in code
// rather than silently forgotten.
export type CrustdataFilterOperator =
  | "="
  | "!="
  | "<"
  | "=<"
  | "<=" // observed live; spec prefers "=<" -- see header note. Not emitted here.
  | ">"
  | "=>"
  | "in"
  | "not_in"
  | "has_all" // observed live (nested-array cross-element match); not in the fetched spec's enum. Not emitted here.
  | "(.)"
  | "(!)"
  | "[.]";

export type CrustdataFilterCondition = {
  field: string;
  type: CrustdataFilterOperator;
  value: string | number | Array<string | number>;
};

export type CrustdataFilterGroup = {
  op: "and" | "or";
  conditions: Array<CrustdataFilterCondition | CrustdataFilterGroup>;
};

export type CrustdataFilters = CrustdataFilterCondition | CrustdataFilterGroup;

// Field paths below are taken directly from Crustdata's PersonSearchCondition
// enum (the live-fetched spec's field list), not guessed. Only the subset
// this query-builder actually maps criteria onto is named here.
export const CRUSTDATA_FIELDS = {
  currentTitle: "experience.employment_details.current.title",
  pastTitle: "experience.employment_details.past.title",
  currentCompanyName: "experience.employment_details.current.company_name",
  pastCompanyName: "experience.employment_details.past.company_name",
  currentSeniorityLevel:
    "experience.employment_details.current.seniority_level",
  currentCompanyHeadcountLatest:
    "experience.employment_details.current.company_headcount_latest",
  locationCity: "basic_profile.location.city",
  skills: "skills.professional_network_skills",
  yearsOfExperience: "years_of_experience",
} as const;

// A subset of DiscoveryCriteria (index.ts) -- deliberately re-declared here,
// not imported, so this pure module has zero dependency on index.ts (which
// pulls in Deno-only jsr: imports at module scope and would otherwise break
// under Vitest/Node). Kept structurally identical to the fields
// coresignalProvider/pdlProvider already consume from DiscoveryCriteria, so
// index.ts can pass its own DiscoveryCriteria value here without any
// conversion -- TypeScript's structural typing accepts an object with extra
// properties (learnedCriteria items, in particular, carry more fields than
// CrustdataLearnedCriterion needs) as long as the ones this type requires
// are present.
export type CrustdataLearnedCriterion = {
  criterionType:
    | "require_keyword"
    | "exclude_keyword"
    | "years_experience_min"
    | "years_experience_max";
  value: { keyword?: string; years?: number };
  label: string;
};

export type CrustdataSearchCriteria = {
  titles: string[] | null;
  location: string | null;
  requiredSkills: string[] | null;
  seniority: string | null;
  yearsExperienceMin: number | null;
  yearsExperienceMax: number | null;
  excludedCompanies: string[] | null;
  exclusionKeywords: string[] | null;
  pastTitles: string[] | null;
  pastCompanies: string[] | null;
  companySizeMin: number | null;
  companySizeMax: number | null;
  learnedCriteria: CrustdataLearnedCriterion[] | null;
};

const REMOTE_PATTERN = /remote/i;

// Same honest-gap principle as SENIORITY_TO_PDL_LEVELS / SENIORITY_TO_
// CORESIGNAL_LEVELS in index.ts: PDL and Coresignal both had their seniority
// enum CONFIRMED directly against published docs. Crustdata's
// experience.employment_details.current.seniority_level field exists (real,
// documented field name) but its actual value vocabulary was NOT confirmed
// live this session (only the operators, the title-phrase gotcha, and the
// field catalog were) -- so this mapping is matched with the fuzzy "(.)"
// contains operator (tolerant of vocabulary mismatches) rather than an exact
// "=" or "in" match against an unverified enum, and "mid_level" is left
// unmapped for the same reason the other two providers leave it unmapped:
// no honest equivalent between "entry" and "senior".
export const SENIORITY_TO_CRUSTDATA_TERMS: Record<string, string[] | null> = {
  intern: ["Intern"],
  entry_level: ["Entry Level", "Junior"],
  mid_level: null,
  senior: ["Senior"],
  staff: ["Staff", "Senior"],
  principal: ["Principal", "Senior"],
  manager: ["Manager"],
  director: ["Director"],
  executive: ["VP", "Vice President", "Head of", "Chief"],
};

const MAX_DECOMPOSED_TERMS = 6;
const SHINGLE_SIZE = 2;
// How many of the required skills BEYOND the top one become the "at least
// one of these" OR-group described in buildCrustdataFilters' skills section
// below -- named to avoid a repeated magic "3" at each of its two use sites.
const CRUSTDATA_REMAINING_SKILLS_COUNT = 3;

// Splits a compound phrase on the same real-world JD-authoring separators
// PDL's/Coresignal's query builders already handle for compound skill
// strings ("AWS/Azure/GCP") -- "/", "|", "&", "," -- into separate candidate
// phrases, each trimmed and de-duplicated.
function splitCompoundPhrase(phrase: string): string[] {
  return phrase
    .split(/[/|&,]|\bor\b|\band\b/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

// Critical gotcha fix (confirmed by live Crustdata testing this session,
// not a guess): Crustdata's "(.)" operator does LITERAL, non-word-split
// phrase matching per OR-alternative -- a value like "AI Engineer|.NET AI|
// Azure OpenAI Engineer" returned 0 results even though relevant candidates
// exist, because none of those exact 3-word phrases appear verbatim in
// indexed titles. "AI Engineer" alone (2 words, a common phrase) returned
// real, correct matches in the same test. This is the Crustdata analog of
// buildCoresignalSkillClause's "/"-splitting in index.ts -- same underlying
// problem (a long, over-specific phrase never appears verbatim in real
// profile text), a different fix shape because "(.)" has no ES-style
// "operator: and" word-matching mode to fall back on.
//
// Fix: any candidate phrase longer than SHINGLE_SIZE words is broken into
// overlapping SHINGLE_SIZE-word shingles ("Azure OpenAI Engineer" ->
// ["Azure OpenAI", "OpenAI Engineer"]) rather than kept as one long literal
// phrase or blown out to single words (single words are usually too broad --
// "Engineer" alone would match almost anyone). Short phrases (<= SHINGLE_SIZE
// words) are kept as-is, matching the "AI Engineer" case that worked.
// Deliberately tuned by the same trial-and-error discipline as Coresignal's
// majority-match fraction (CORESIGNAL_TOP_SKILLS_MAJORITY_FRACTION in
// index.ts) -- SHINGLE_SIZE=2 is the smallest window that reproduces the
// live-confirmed "AI Engineer" success case; a future calibration pass
// against real Crustdata result counts (the same kind of tuning that
// produced Coresignal's 0.6 majority fraction) may adjust this further.
export function decomposeSearchPhrase(
  phrase: string,
  maxTerms: number = MAX_DECOMPOSED_TERMS,
  shingleSize: number = SHINGLE_SIZE,
): string[] {
  const variants = splitCompoundPhrase(phrase);
  const terms = new Set<string>();

  for (const variant of variants) {
    const words = variant.split(/\s+/).filter((w) => w.length > 0);
    if (words.length <= shingleSize) {
      if (words.length > 0) terms.add(words.join(" "));
      continue;
    }
    for (let i = 0; i + shingleSize <= words.length; i++) {
      terms.add(words.slice(i, i + shingleSize).join(" "));
    }
  }

  return Array.from(terms).slice(0, maxTerms);
}

// Builds one or more "(.)" conditions from phrases, decomposing each phrase
// first (see decomposeSearchPhrase). Returns a single condition when there is
// only one term; otherwise an explicit OR-group -- never a pipe-joined value
// inside one condition (live bisection 2026-07-24: pipe-joining multiple title
// alternatives collapsed ANDed searches to zero even when each term alone
// matches millions of profiles).
export function buildContainsOrGroupFromPhrases(
  field: string,
  phrases: string[],
): CrustdataFilterCondition | CrustdataFilterGroup | null {
  const allTerms = phrases.flatMap((p) => decomposeSearchPhrase(p));
  const deduped = Array.from(new Set(allTerms)).filter((t) => t.length > 0);
  if (deduped.length === 0) return null;

  const conditions: CrustdataFilterCondition[] = deduped.map((value) => ({
    field,
    type: "(.)",
    value,
  }));

  if (conditions.length === 1) return conditions[0];
  return { op: "or", conditions };
}

// Builds a single "(.)" condition for one source phrase. When decomposeSearchPhrase
// yields multiple shingles for that phrase, they are OR-joined with "|" inside the
// value (safe for a single logical phrase). For multiple alternative phrases
// (expanded title synonyms, seniority aliases), use buildContainsOrGroupFromPhrases.
export function buildContainsCondition(
  field: string,
  phrases: string[],
): CrustdataFilterCondition | null {
  if (phrases.length !== 1) return null;
  const terms = decomposeSearchPhrase(phrases[0]);
  const deduped = Array.from(new Set(terms)).filter((t) => t.length > 0);
  if (deduped.length === 0) return null;
  return {
    field,
    type: "(.)",
    value: deduped.slice(0, MAX_DECOMPOSED_TERMS).join("|"),
  };
}

// "(!)" excludes rows whose value contains this substring (case-insensitive,
// confirmed live) -- unlike "(.)", the spec explicitly says "(!)" matches
// multi-word values as a literal phrase (not word-split), so no shingle
// decomposition is applied here: an exclude should stay precise (excluding
// too broadly is the wrong failure direction for a hard "must_not").
function buildExcludeCondition(
  field: string,
  phrase: string,
): CrustdataFilterCondition {
  return { field, type: "(!)", value: phrase.trim() };
}

type BuildOptions = {
  // Mirrors pdlProvider's { useSeniority } tight-vs-loose toggle -- kept
  // here so a future crustdataProvider fallback pass (same "seniority
  // returned too few results, retry without it" pattern as pdlProvider.search
  // in index.ts) can reuse this builder without duplicating the rest of the
  // mapping logic.
  useSeniority: boolean;
};

export type BuildCrustdataFiltersResult = {
  // null when there's nothing to filter on at all (no title, no location) --
  // callers treat this the same way pdlProvider/coresignalProvider treat an
  // empty "must" array: a DiscoveryConfigError, not a vendor failure.
  filters: CrustdataFilterGroup | null;
  notes: string[];
};

// Turns a DiscoveryCriteria-shaped object into a Crustdata PersonSearch
// filter tree. This is the Crustdata equivalent of buildPdlQuery /
// coresignalProvider's inline query construction in index.ts -- same
// conceptual job (map vendor-neutral criteria onto one vendor's real filter
// language), different target schema. Unlike Coresignal's Elasticsearch DSL,
// Crustdata's filter language has no "should"/ranking-boost primitive -- only
// "and"/"or" groups of hard conditions (confirmed directly against the
// PersonSearchConditionGroup schema: op is "and" | "or", nothing else) -- so
// signals Coresignal treats as soft/non-exclusionary (industry, company
// type, nice-to-have keywords) have no honest equivalent here and are
// deliberately NOT sent as Crustdata filters at all (same "disclose the gap
// rather than force a wrong-shaped filter" principle as buildPdlQuery's
// unmapped seniority levels) -- forcing them into a hard "and" would risk
// the exact same over-narrowing bug Coresignal's v1 query hit (a single
// over-specific stacked filter collapsing real matches to zero).
// pastTitles/pastCompanies are the one exception: since Crustdata can't
// express "boost, don't require", they become a real "at least one of these"
// OR-group filter here (disclosed via a note) rather than being silently
// dropped -- a recruiter who entered a specific past-employer preference
// clearly wants it to narrow the search, and an OR-across-several-past-
// employers group is still a reasonably wide net, not a single brittle
// AND.
export function buildCrustdataFilters(
  criteria: CrustdataSearchCriteria,
  options: BuildOptions = { useSeniority: true },
): BuildCrustdataFiltersResult {
  const conditions: Array<CrustdataFilterCondition | CrustdataFilterGroup> = [];
  const notes: string[] = [];

  // --- Title: explicit OR-group of decomposed contains conditions (one term
  // per condition -- never pipe-joined alternatives in a single value). ---
  if (criteria.titles && criteria.titles.length > 0) {
    const titleFilter = buildContainsOrGroupFromPhrases(
      CRUSTDATA_FIELDS.currentTitle,
      criteria.titles,
    );
    if (titleFilter) {
      conditions.push(titleFilter);
      if (criteria.titles.length > 1) {
        notes.push(
          `Searching ${criteria.titles.length} equivalent titles: ${criteria.titles.join(", ")} (each decomposed into shorter literal phrases and combined as an OR-group -- contains-match only matches exact phrases, not word-split text; see decomposeSearchPhrase).`,
        );
      } else {
        notes.push(`Requiring title match: "${criteria.titles[0]}".`);
      }
    }
  } else {
    notes.push(
      "No role title on this role brief -- title not used in the search query.",
    );
  }

  // --- Location: skip entirely for remote roles, same convention as
  // buildPdlQuery/coresignalProvider. ---
  if (criteria.location && !REMOTE_PATTERN.test(criteria.location)) {
    const city = criteria.location.split(",")[0].trim();
    const condition = buildContainsCondition(CRUSTDATA_FIELDS.locationCity, [
      city,
    ]);
    if (condition) {
      conditions.push(condition);
      notes.push(
        `Requiring location "${city}" (matched against the city field).`,
      );
    }
  } else if (criteria.location) {
    notes.push(
      "Role marked remote/location-flexible -- no location constraint applied.",
    );
  }

  // --- Skills: top skill is a real (decomposed) requirement, same
  // "top skill only" discipline as buildPdlQuery -- see its header note for
  // why forcing many specific skills onto a controlled/fuzzy vocabulary at
  // once tends to zero out results. Remaining skills (up to
  // CRUSTDATA_REMAINING_SKILLS_COUNT) become an "at least one of these" OR
  // group -- Crustdata's and/or-only filter language has no minimum_should_
  // match, so "any one of the remaining skills" is the closest honest
  // equivalent to Coresignal's majority-match fraction, applied as a nested
  // group rather than dropped outright. ---
  if (criteria.requiredSkills && criteria.requiredSkills.length > 0) {
    const [topSkill, ...rest] = criteria.requiredSkills;
    const topCondition = buildContainsCondition(CRUSTDATA_FIELDS.skills, [
      topSkill,
    ]);
    if (topCondition) {
      conditions.push(topCondition);
      notes.push(`Requiring skill: "${topSkill}".`);
    }

    const remaining = rest.slice(0, CRUSTDATA_REMAINING_SKILLS_COUNT);
    if (remaining.length > 0) {
      const remainingConditions = remaining
        .map((skill) =>
          buildContainsCondition(CRUSTDATA_FIELDS.skills, [skill]),
        )
        .filter((c): c is CrustdataFilterCondition => c !== null);
      if (remainingConditions.length > 0) {
        conditions.push({ op: "or", conditions: remainingConditions });
        notes.push(
          `Requiring at least one of ${remainingConditions.length} additional skill(s): ${remaining.join(", ")} (applied as a real OR-group filter, not a ranking-only boost).`,
        );
      }
      const dropped = rest.slice(CRUSTDATA_REMAINING_SKILLS_COUNT);
      if (dropped.length > 0) {
        notes.push(
          `${dropped.length} lower-priority skill(s) not used as a search filter at all (${dropped.join(", ")}) -- no soft ranking signal to fold them into.`,
        );
      }
    }
  } else {
    notes.push(
      "No required skills on this role brief -- skills not used in the search query.",
    );
  }

  // --- Seniority: best-effort fuzzy contains-match -- see
  // SENIORITY_TO_CRUSTDATA_TERMS header note for why this uses "(.)" rather
  // than an exact "=" against an unconfirmed enum. ---
  if (options.useSeniority && criteria.seniority) {
    const mapped = SENIORITY_TO_CRUSTDATA_TERMS[criteria.seniority];
    if (mapped && mapped.length > 0) {
      const seniorityFilter = buildContainsOrGroupFromPhrases(
        CRUSTDATA_FIELDS.currentSeniorityLevel,
        mapped,
      );
      if (seniorityFilter) {
        conditions.push(seniorityFilter);
        notes.push(
          `Requiring seniority level "${criteria.seniority}" (matched via fuzzy contains-match on the seniority field).`,
        );
      }
    } else {
      notes.push(
        `Seniority "${criteria.seniority}" doesn't have a clean equivalent in the search taxonomy -- not used as a filter.`,
      );
    }
  } else if (criteria.seniority) {
    notes.push("Seniority not applied for this broader search pass.");
  } else {
    notes.push(
      "No seniority on this role brief -- seniority not used in the search query.",
    );
  }

  // --- Years of experience: a real range filter. Confirmed field
  // (years_of_experience, root-level). Spec explicitly warns to use "=<"/
  // "=>" instead of "<="/">=" -- see this file's header note on the
  // operator-set discrepancy for why "=<"/"=>" (not "<="/">=") are emitted
  // here despite the live-tested "<=" also having worked. ---
  if (
    (criteria.yearsExperienceMin && criteria.yearsExperienceMin > 0) ||
    (criteria.yearsExperienceMax && criteria.yearsExperienceMax > 0)
  ) {
    const rangeConditions: CrustdataFilterCondition[] = [];
    if (criteria.yearsExperienceMin && criteria.yearsExperienceMin > 0) {
      rangeConditions.push({
        field: CRUSTDATA_FIELDS.yearsOfExperience,
        type: "=>",
        value: criteria.yearsExperienceMin,
      });
    }
    if (criteria.yearsExperienceMax && criteria.yearsExperienceMax > 0) {
      rangeConditions.push({
        field: CRUSTDATA_FIELDS.yearsOfExperience,
        type: "=<",
        value: criteria.yearsExperienceMax,
      });
    }
    conditions.push(...rangeConditions);
    notes.push(
      `Requiring ${criteria.yearsExperienceMin ?? "any"}-${criteria.yearsExperienceMax ?? "any"} years of experience (years_of_experience).`,
    );
  }

  // --- Company size: a real numeric range filter (unlike industry/company
  // type below, this is a plain numeric field, not a fuzzy taxonomy match --
  // no over-narrowing risk from an inexact-match false exclusion the way
  // free-text industry matching would have). ---
  if (criteria.companySizeMin || criteria.companySizeMax) {
    if (criteria.companySizeMin) {
      conditions.push({
        field: CRUSTDATA_FIELDS.currentCompanyHeadcountLatest,
        type: "=>",
        value: criteria.companySizeMin,
      });
    }
    if (criteria.companySizeMax) {
      conditions.push({
        field: CRUSTDATA_FIELDS.currentCompanyHeadcountLatest,
        type: "=<",
        value: criteria.companySizeMax,
      });
    }
    notes.push(
      `Requiring current company size ${criteria.companySizeMin ?? "any"}-${criteria.companySizeMax ?? "any"} employees (company_headcount_latest).`,
    );
  }

  // --- Excludes: hard "(!)" per excluded company / exclusion keyword,
  // same "precise term, safe to hard-exclude" reasoning as coresignalProvider's
  // must_not clauses in index.ts. ---
  if (criteria.excludedCompanies && criteria.excludedCompanies.length > 0) {
    for (const company of criteria.excludedCompanies) {
      conditions.push(
        buildExcludeCondition(CRUSTDATA_FIELDS.currentCompanyName, company),
      );
    }
    notes.push(
      `Excluding candidates currently at: ${criteria.excludedCompanies.join(", ")}.`,
    );
  }

  if (criteria.exclusionKeywords && criteria.exclusionKeywords.length > 0) {
    for (const keyword of criteria.exclusionKeywords) {
      conditions.push(
        buildExcludeCondition(CRUSTDATA_FIELDS.currentTitle, keyword),
      );
      conditions.push(buildExcludeCondition(CRUSTDATA_FIELDS.skills, keyword));
    }
    notes.push(
      `Excluding candidates matching: ${criteria.exclusionKeywords.join(", ")} (checked against title and skills).`,
    );
  }

  // --- Past-position search: an OR-group requiring at least one match --
  // see this function's header note for why this is a real filter here
  // (not a "should"/boost the way it is for coresignalProvider). ---
  if (criteria.pastTitles && criteria.pastTitles.length > 0) {
    const pastTitleFilter = buildContainsOrGroupFromPhrases(
      CRUSTDATA_FIELDS.pastTitle,
      criteria.pastTitles,
    );
    if (pastTitleFilter) {
      conditions.push(pastTitleFilter);
      notes.push(
        `Requiring at least one past title matching: ${criteria.pastTitles.join(", ")} (applied as a real filter, not just a ranking preference).`,
      );
    }
  }

  if (criteria.pastCompanies && criteria.pastCompanies.length > 0) {
    const pastCompanyConditions = criteria.pastCompanies.map((company) => ({
      field: CRUSTDATA_FIELDS.pastCompanyName,
      type: "(.)" as const,
      value: company,
    }));
    conditions.push({ op: "or", conditions: pastCompanyConditions });
    notes.push(
      `Requiring at least one past employer matching: ${criteria.pastCompanies.join(", ")} (applied as a real filter, not just a ranking preference).`,
    );
  }

  // --- Calibration loop: learned criteria, same require_keyword/
  // exclude_keyword mapping as coresignalProvider -- years_experience_min/max
  // already folds into the range above via the same tighten-only rule
  // (handled by the caller before this function runs, mirroring
  // coresignalProvider's effectiveYearsMin/effectiveYearsMax pattern) is NOT
  // duplicated here; only keyword criteria are handled in this function. ---
  if (criteria.learnedCriteria && criteria.learnedCriteria.length > 0) {
    for (const lc of criteria.learnedCriteria) {
      if (lc.criterionType === "require_keyword" && lc.value.keyword) {
        const condition = buildContainsCondition(CRUSTDATA_FIELDS.skills, [
          lc.value.keyword,
        ]);
        if (condition) conditions.push(condition);
      } else if (lc.criterionType === "exclude_keyword" && lc.value.keyword) {
        conditions.push(
          buildExcludeCondition(
            CRUSTDATA_FIELDS.currentTitle,
            lc.value.keyword,
          ),
        );
        conditions.push(
          buildExcludeCondition(CRUSTDATA_FIELDS.skills, lc.value.keyword),
        );
      }
      if (
        lc.criterionType === "require_keyword" ||
        lc.criterionType === "exclude_keyword"
      ) {
        notes.push(
          `Learned criterion applied (from calibration feedback): ${lc.label}`,
        );
      }
    }
  }

  if (conditions.length === 0) {
    return { filters: null, notes };
  }

  return { filters: { op: "and", conditions }, notes };
}
