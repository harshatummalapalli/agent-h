/* eslint-disable @typescript-eslint/no-unused-vars */
// =============================================================================
// MCP-DEPLOY BUNDLE — source-candidates-discovery
// Self-contained single file for Supabase MCP deploy (no relative imports).
// Generated for paste into MCP deploy tools that cannot resolve ../_shared/.
// Inlined: crustdataClient (subset), crustdataQueryBuilder, candidateDisplayFields,
// discoverySourceAttribution (used subset), then the original index.ts body.
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";

// ── Inlined from _shared/crustdataClient.ts (subset) ───────────────────────
// Only classifyPlace + parseLocationForFilter and their dependencies.
// Does not inline the private crustdataYearsExperience from crustdataClient
// (candidateDisplayFields owns the exported crustdataYearsExperience used here).

const LOCATION_FIELD = {
  locationCity: "basic_profile.location.city",
  locationCountry: "basic_profile.location.country",
} as const;

const COUNTRY_ALIASES: Record<string, string> = {
  india: "India",
  "united states": "United States",
  us: "United States",
  usa: "United States",
  america: "United States",
  "united kingdom": "United Kingdom",
  uk: "United Kingdom",
  britain: "United Kingdom",
  "great britain": "United Kingdom",
  england: "United Kingdom",
  canada: "Canada",
  germany: "Germany",
  deutschland: "Germany",
  singapore: "Singapore",
  australia: "Australia",
  "united arab emirates": "United Arab Emirates",
  uae: "United Arab Emirates",
  dubai: "United Arab Emirates",
  france: "France",
  netherlands: "Netherlands",
  holland: "Netherlands",
  brazil: "Brazil",
  japan: "Japan",
  "south korea": "South Korea",
  korea: "South Korea",
  china: "China",
  israel: "Israel",
  ireland: "Ireland",
  sweden: "Sweden",
  norway: "Norway",
  denmark: "Denmark",
  finland: "Finland",
  switzerland: "Switzerland",
  poland: "Poland",
  spain: "Spain",
  portugal: "Portugal",
  italy: "Italy",
  mexico: "Mexico",
  colombia: "Colombia",
  argentina: "Argentina",
  nigeria: "Nigeria",
  kenya: "Kenya",
  "south africa": "South Africa",
  indonesia: "Indonesia",
  malaysia: "Malaysia",
  philippines: "Philippines",
  vietnam: "Vietnam",
  pakistan: "Pakistan",
  bangladesh: "Bangladesh",
  "new zealand": "New Zealand",
};

function classifyPlace(place: string): {
  field: string;
  type: "=" | "(.)";
  value: string;
} {
  const canonical = COUNTRY_ALIASES[place.toLowerCase().trim()];
  if (canonical) {
    return {
      field: LOCATION_FIELD.locationCountry,
      type: "=",
      value: canonical,
    };
  }
  return { field: LOCATION_FIELD.locationCity, type: "(.)", value: place };
}

const REMOTE_ONLY_RE =
  /^(remote[\s-]*(only|ok|friendly|first|work)?|work\s+remote(ly)?)$/i;

const REMOTE_STRIP_RE =
  /\b(remote\s+people\s+based\s+in|remote[\s-]*(only|ok|friendly|first|work)?|work\s+remote(ly)?|based\s+in|remote)\b[,\s-]*/gi;

function parseLocationForFilter(location: string): {
  place: string | null;
  remoteOnly: boolean;
} {
  const trimmed = location.trim();
  if (!trimmed) return { place: null, remoteOnly: false };

  const hasRemote = /remote/i.test(trimmed);

  if (REMOTE_ONLY_RE.test(trimmed)) {
    return { place: null, remoteOnly: true };
  }

  const withoutParens = trimmed.replace(/\(\s*remote[^)]*\)/gi, "");
  const place = withoutParens
    .replace(REMOTE_STRIP_RE, " ")
    .replace(/[,\s-]+$/, "")
    .replace(/^[,\s-]+/, "")
    .trim();

  return { place: place || null, remoteOnly: hasRemote && !place };
}

// ── Inlined from crustdataQueryBuilder.ts ───────────────────────────────
// Crustdata query-builder (pure, no I/O, no Deno-specific imports) -- kept in
// its own file, separate from crustdataProvider's HTTP call in index.ts, so
// this mapping logic can be unit-tested directly under Vitest without
// dragging in index.ts's "jsr:@panva/jose@6" / edge-runtime imports (Deno-
// only, not resolvable under Node/Vitest). See crustdataQueryBuilder.test.ts.
//
// parseLocationForFilter + classifyPlace are inlined above from crustdataClient.
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
type CrustdataFilterOperator =
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

type CrustdataFilterCondition = {
  field: string;
  type: CrustdataFilterOperator;
  value: string | number | Array<string | number>;
};

type CrustdataFilterGroup = {
  op: "and" | "or";
  conditions: Array<CrustdataFilterCondition | CrustdataFilterGroup>;
};

type _CrustdataFilters = CrustdataFilterCondition | CrustdataFilterGroup;

// Field paths below are taken directly from Crustdata's PersonSearchCondition
// enum (the live-fetched spec's field list), not guessed. Only the subset
// this query-builder actually maps criteria onto is named here.
const CRUSTDATA_FIELDS = {
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
type CrustdataLearnedCriterion = {
  criterionType:
    | "require_keyword"
    | "exclude_keyword"
    | "years_experience_min"
    | "years_experience_max";
  value: { keyword?: string; years?: number };
  label: string;
};

type CrustdataSearchCriteria = {
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

// CRUSTDATA_QB_REMOTE_PATTERN kept for the "log a note when skipping" branch only; location
// routing now goes through parseLocationForFilter + classifyPlace (imported above)
// so Remote+India correctly applies a country filter rather than being skipped.
const CRUSTDATA_QB_REMOTE_PATTERN = /remote/i;

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
const SENIORITY_TO_CRUSTDATA_TERMS: Record<string, string[] | null> = {
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
function decomposeSearchPhrase(
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
function buildContainsOrGroupFromPhrases(
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
function buildContainsCondition(
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

type BuildCrustdataFiltersResult = {
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
function buildCrustdataFilters(
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

  // --- Location: extract the geographic place even when "remote" appears
  // (e.g. "Remote, India" → place="India"), then route to the country field
  // (exact "=") for known countries or the city field ("(.)") for cities.
  // This supersedes the old "skip if remote" convention: "Remote, India" must
  // still filter to India, not return worldwide results. ---
  if (criteria.location) {
    const { place, remoteOnly } = parseLocationForFilter(criteria.location);
    if (place) {
      const classified = classifyPlace(place);
      // City comes through decomposeSearchPhrase for better literal matching;
      // country uses an exact "=" so skip decomposition.
      let condition: CrustdataFilterCondition | CrustdataFilterGroup | null =
        null;
      if (classified.type === "=") {
        condition = {
          field: classified.field,
          type: "=",
          value: classified.value,
        };
        notes.push(
          `Requiring location country "${classified.value}" (matched against the country field with exact "=").`,
        );
      } else {
        // For city filtering, take only the first comma-separated token so
        // "Hyderabad, Telangana, India" → "Hyderabad" (avoids pipe-joining
        // the state/country parts which have no meaning in the city field).
        const cityToken = place.split(",")[0].trim();
        condition = buildContainsCondition(classified.field, [cityToken]);
        notes.push(
          `Requiring location "${cityToken}" (matched against the city field).`,
        );
      }
      if (condition) conditions.push(condition);
    } else if (
      remoteOnly ||
      CRUSTDATA_QB_REMOTE_PATTERN.test(criteria.location)
    ) {
      notes.push(
        "Role marked remote/location-flexible -- no location constraint applied.",
      );
    }
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

// ── Inlined from candidateDisplayFields.ts ──────────────────────────────
// Per-candidate display fields extracted from vendor-specific discovery
// payloads for opt-in sorting on SourceCandidatesPage.

function numericOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    !Number.isNaN(Number(value))
  ) {
    return Number(value);
  }
  return null;
}

function monthsToYears(months: unknown): number | null {
  const numeric = numericOrNull(months);
  if (numeric == null) return null;
  return Math.round((numeric / 12) * 10) / 10;
}

function coresignalYearsExperience(
  raw: Record<string, unknown>,
): number | null {
  return monthsToYears(raw.total_experience_duration_months);
}

function coresignalCompanySize(raw: Record<string, unknown>): number | null {
  return (
    numericOrNull(raw.experience_company_employees_count) ??
    numericOrNull(raw.company_employees_count) ??
    numericOrNull(raw.active_experience_company_employees_count)
  );
}

function crustdataYearsExperience(raw: Record<string, unknown>): number | null {
  const basicProfile = (raw.basic_profile ?? {}) as Record<string, unknown>;
  return (
    numericOrNull(basicProfile.years_of_experience) ??
    numericOrNull(raw.years_of_experience)
  );
}

function crustdataCompanySize(raw: Record<string, unknown>): number | null {
  const experience = (raw.experience ?? {}) as Record<string, unknown>;
  const employmentDetails = (experience.employment_details ?? {}) as Record<
    string,
    unknown
  >;
  const currentPositions = Array.isArray(employmentDetails.current)
    ? (employmentDetails.current as Array<Record<string, unknown>>)
    : [];
  const currentPosition = currentPositions[0] ?? {};
  return numericOrNull(currentPosition.company_headcount_latest);
}

function apolloYearsExperience(raw: Record<string, unknown>): number | null {
  return numericOrNull(raw.years_of_experience);
}

function apolloCompanySize(raw: Record<string, unknown>): number | null {
  const org = (raw.organization ?? {}) as Record<string, unknown>;
  return (
    numericOrNull(org.estimated_num_employees) ??
    numericOrNull(org.num_employees)
  );
}

// ── Inlined from _shared/discoverySourceAttribution.ts (used subset) ──────

type DiscoveryAttributionRow = {
  deal_id: number;
  source_id: string;
  vendor: string;
  expires_at: string;
};

function isDiscoverySearchContinuation(params: {
  scrollToken?: string;
  isPreview: boolean;
  cachedScrollQuery: string | null;
  cachedScrollToken: string | null;
  queryText: string;
}): boolean {
  if (params.isPreview) return false;
  if (params.scrollToken) return true;
  return (
    params.cachedScrollQuery === params.queryText &&
    Boolean(params.cachedScrollToken)
  );
}

function buildDiscoveryAttributionRows(
  dealId: number,
  vendor: string,
  candidates: Array<Record<string, unknown>>,
  now: Date = new Date(),
): DiscoveryAttributionRow[] {
  const expiresAt = new Date(
    now.getTime() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rows: DiscoveryAttributionRow[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const sourceId =
      typeof candidate.id === "string" && candidate.id.length > 0
        ? candidate.id
        : null;
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    rows.push({
      deal_id: dealId,
      source_id: sourceId,
      vendor,
      expires_at: expiresAt,
    });
  }

  return rows;
}

function stripVendorFieldsForClient(
  candidate: Record<string, unknown>,
): Record<string, unknown> {
  const { _source_vendor: _omit, ...clientCandidate } = candidate;
  return clientCandidate;
}

// ── Original source-candidates-discovery/index.ts body ───────────────────
// Agent H Stage 3, checkpoint 3a: pure PDL (People Data Labs) discovery.
//
// Scope, deliberately narrow: given a role brief (a public.deals row, see
// supabase/schemas/10_agent_h_role_briefs_and_assignments.sql and
// 15_agent_h_structured_role_brief_fields.sql for its fields), build a PDL
// Person Search query from that role brief's structured fields, call PDL's
// real API, and return whatever candidates come back.
//
// Checkpoint 3c addition: each returned candidate is now annotated with
// "_match_score" (a 0-1 semantic similarity between this candidate and the
// role brief, via Voyage AI embeddings), and the candidates array is sorted
// best-match-first before being returned. Nothing is hidden or filtered out
// by score -- Harsha's explicit call, same principle as 3b's "the batch is
// never pre-filtered": every candidate PDL returned is still in the
// response, just reordered, with the score shown so the recruiter can judge
// for themselves rather than trusting an invisible cutoff. See
// scoreAndSortCandidates below for the actual scoring logic, and
// supabase/schemas/17_agent_h_semantic_matching.sql for why this doesn't use
// pgvector or a separate vector database.
//
// Scoring is best-effort and non-fatal: if VOYAGE_API_KEY isn't set, or the
// Voyage call fails for any reason (rate limit, bad key, network blip), the
// search still returns PDL's results in their original order with a note
// explaining why no scores are showing, rather than failing the whole
// search. A recruiter shouldn't lose sourcing entirely because a ranking
// feature had a bad moment.
//
// What this function deliberately does NOT do (later checkpoints, per
// kharta-sourcing-engine-architecture.md's 5-layer pipeline):
//   - no GitHub enrichment (3d)
//   - still writes nothing to the database itself -- this function only
//     ever returns PDL's raw hits for inspection. Saving a specific result
//     as a real candidate record now happens in a separate function,
//     save-sourced-candidate, fired only when a recruiter explicitly clicks
//     "Add to pipeline" (checkpoint 3b -- Harsha's call: an unreviewed PDL
//     hit isn't the same thing as a candidate someone decided to track, so
//     nothing is auto-saved here).
//   - checkpoint 3b addition: each returned candidate IS now annotated with
//     "_already_saved" / "_candidate_id" (see annotateAlreadySaved below),
//     so the recruiter can see who they've already added without needing to
//     click into every card -- this is a read-only display convenience,
//     the actual dedup guarantee lives in save-sourced-candidate's insert
//     logic, not here.
//   - "probe + rank-the-batch + search-wider" addition: no backend change
//     was needed for the "probe" (a recruiter-side call with size=1 already
//     works -- PDL returns the accurate `total` regardless of size, for the
//     minimum 1-credit charge) or "rank the batch" (this function already
//     returns every candidate it fetched, nothing is hidden). What DID need
//     a real change is "search wider": accepts an optional `scroll_token` in
//     the request body now, and always returns the `scroll_token` PDL gives
//     back. PDL's own docs (docs.peopledatalabs.com/docs/reference-person-
//     search-api) confirm the contract precisely: re-send the SAME query
//     (not a different/looser one) plus the scroll_token from the previous
//     response, and PDL returns the next `size` records further down the
//     same matched set -- explicitly NOT the legacy `from` offset param,
//     which PDL's docs say not to rely on long-term and which cannot be
//     combined with scroll_token in the same request. This is why "search
//     wider" here means "go deeper into the same 315 matches," not "loosen
//     the criteria" -- confirmed as the intended behavior, not assumed.
//
// PDL API shape confirmed directly against PDL's current docs
// (docs.peopledatalabs.com) before writing this, not assumed from memory:
//   GET https://api.peopledatalabs.com/v5/person/search
//   ?query=<URL-encoded JSON Elasticsearch-DSL query>&size=<n>&scroll_token=<token, optional>
//   Header: X-Api-Key: <PDL_API_KEY>
//   Response JSON: { status, data: [...person records...], total, scroll_token }
// Sent as a GET with the query in the query string (not a POST JSON body)
// because that's the shape PDL's own plain-HTTP (non-SDK) example uses --
// safest bet in a Deno fetch, since GET-with-body support is inconsistent
// across runtimes.
//
// Requires PDL_API_KEY to be set as a Supabase Edge Function secret
// (Project Settings > Edge Functions > Secrets), same manual step as
// ANTHROPIC_API_KEY in Stage 2 -- no MCP tool exists to set secrets.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
// SUPABASE_URL and SUPABASE_ANON_KEY are auto-injected into every Supabase
// Edge Function -- unlike PDL_API_KEY, Harsha does not need to set these
// manually.
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

const PDL_API_KEY = Deno.env.get("PDL_API_KEY");
const PDL_SEARCH_URL = "https://api.peopledatalabs.com/v5/person/search";

// Taxonomy/boolean-logic test (post-checkpoint-3d): Harsha's direct call,
// prompted by real calibration feedback showing PDL profiles are frequently
// stale ("this PDL is not really giving the insights a recruiter would
// need... same may be the case with all data vendors"). Rather than keep
// tightening PDL's query (a ceiling we already hit -- see the
// candidate-narrowing header note further down), Apollo and Coresignal are
// now run side by side against the same role briefs PDL was tested on,
// with PDL itself DISABLED (removed from DISCOVERY_PROVIDERS below) until
// that comparison is done -- see the vendor abstraction section for
// exactly how, and for what each vendor's own query taxonomy actually
// looks like (confirmed directly against their docs before writing this,
// same discipline as the PDL section above):
//
// Apollo (docs.apollo.io/reference/people-api-search, confirmed directly):
//   POST https://api.apollo.io/api/v1/mixed_people/api_search
//   Header: X-Api-Key: <APOLLO_API_KEY>
//   person_titles[] / person_locations[] / person_seniorities[] are arrays
//   with OR semantics WITHIN each array (matching any one is enough,
//   confirmed by Apollo's own doc wording: "they only need to match 1 of
//   the job titles you add"), and the different filter types are ANDed
//   together (Apollo's own worked example narrows Sales Directors AND
//   California/Oregon/Washington together). person_seniorities[] enum:
//   owner, founder, c_suite, partner, vp, head, director, manager, senior,
//   entry, intern -- see SENIORITY_TO_APOLLO_LEVELS below for our mapping.
//   Real taxonomy gap found: there is NO structured skills field in this
//   API at all -- only a vague free-text q_keywords blob. PDL and
//   Coresignal both have a real skills field; Apollo structurally doesn't,
//   which matters a lot for a role brief whose top requirement is a
//   specific technology.
//   This endpoint costs zero Apollo credits to call (confirmed in Apollo's
//   own docs), but the response is deliberately obfuscated -- last names
//   come back masked ("Po***r") and location is reduced to booleans
//   (has_city: true) rather than real text. Getting real, useable candidate
//   data requires a second call to people/bulk_match (People Enrichment),
//   which DOES spend credits (roughly 1 credit per person on the free
//   tier's Basic enrichment) -- Harsha's explicit call: spend ~1 credit per
//   candidate returned (so ~10 for a size=10 pull) to de-obfuscate results
//   for a real comparison, out of the account's ~900 free credits/year,
//   rather than comparing anonymized placeholder data.
//
// Coresignal (docs.coresignal.com, confirmed directly): two Employee API
// tiers exist with a real cost/capability tradeoff -- Base Employee API is
// cheaper but has no seniority field at all in its schema; Multi-source
// Employee API costs 2x the credits per search/collect call but has a real
// `active_experience_management_level` field (enum: C-Level, Director,
// Founder, Head, Intern, Manager, Owner, Partner, President/Vice
// President, Senior, Specialist) -- Harsha's explicit call: use Multi-
// source, since a real seniority filter (closer to PDL's job_title_levels)
// matters more here than the extra credit cost for a comparison test.
//   POST https://api.coresignal.com/cdapi/v2/employee_multi_source/search/es_dsl/preview
//   Header: apikey: <CORESIGNAL_API_KEY> (not a Bearer token -- confirmed
//   directly against their curl examples)
//   Body: a real Elasticsearch bool/must/should query, same DSL shape as
//   PDL's -- Coresignal's docs literally say "Search Preview endpoints
//   accept the same query structure" as their full search endpoints, and
//   confirm nested `bool`/`should`/`must`/`match`/`term`/`query_string`
//   clauses all work as standard Elasticsearch. Unlike PDL, several useful
//   fields are FLAT (not nested under a per-position "experience" array):
//   `active_experience_title` (current title), `active_experience_
//   management_level`, `active_experience_department`, `inferred_skills`.
//   The skills field is free-text (not a curated closed vocabulary like
//   PDL's `skills` enum), so a `match` query with `operator: "and"` can
//   require a full multi-word skill phrase without PDL's brittle exact-
//   term matching -- a real taxonomy advantage worth testing.
//   Known, disclosed gap: the `preview` endpoint (chosen here because it
//   returns already-denormalized fields -- full_name, location_full,
//   active_experience_title, company_name -- without a second per-
//   candidate "collect" call) does not document a total-match-count field
//   the way PDL's `total` does. Notes below disclose this rather than
//   silently showing a wrong or fabricated total.
const APOLLO_API_KEY = Deno.env.get("APOLLO_API_KEY");
const APOLLO_SEARCH_URL =
  "https://api.apollo.io/api/v1/mixed_people/api_search";
const APOLLO_BULK_MATCH_URL = "https://api.apollo.io/api/v1/people/bulk_match";

const CORESIGNAL_API_KEY = Deno.env.get("CORESIGNAL_API_KEY");
const CORESIGNAL_SEARCH_PREVIEW_URL =
  "https://api.coresignal.com/cdapi/v2/employee_multi_source/search/es_dsl/preview";
// Total-match-count fix: the main (non-preview) search endpoint, confirmed
// directly against Coresignal's docs to support `items_per_page` (max 1000)
// and to return real pagination via response headers -- x-total-results,
// x-total-pages, x-next-page-after -- which the preview endpoint does not
// document at all. Used ONLY for a cheap items_per_page=1 call (see
// fetchCoresignalTotal below) purely to read x-total-results; NOT used to
// fetch actual candidate data, since that endpoint only returns bare IDs and
// getting full profiles back out would require a separate paid "collect"
// call per ID -- a bigger, more expensive architecture change than what's
// needed just to show an honest total-match count next to the preview
// results the recruiter already sees.
const CORESIGNAL_SEARCH_URL =
  "https://api.coresignal.com/cdapi/v2/employee_multi_source/search/es_dsl";

// Crustdata (2026-07-23): a second, pluggable candidate-discovery provider
// added alongside Coresignal -- NOT a decision that Crustdata has won any
// vendor comparison, this is deliberately built for optionality: switch
// vendors under a pricing crunch, fall back automatically if Coresignal
// degrades or runs out of credits, or hedge against either vendor's future
// plan/pricing changes. See the DISCOVERY_PROVIDERS header comment below for
// exactly how it's wired in (same "config-driven priority list, one line to
// enable/disable" mechanism already used for pdlProvider/apolloProvider).
//
// API shape confirmed directly against Crustdata's live OpenAPI spec
// (docs.crustdata.com/api-reference/person-apis/search-people-using-filters-
// and-sorting) AND live API testing this session, not docs-only -- see
// crustdataQueryBuilder.ts's header comment for the full confirmation trail,
// including a disclosed operator-set discrepancy between what live testing
// observed and what the current spec documents.
//   POST https://api.crustdata.com/person/search
//   Header: Authorization: Bearer <CRUSTDATA_API_KEY>, x-api-version: 2025-11-01
//   Body: { filters: <condition | condition group>, limit, cursor? }
//   Response: { profiles: [...], next_cursor, total_count }
// No hard result-count cap observed (a broad query returned total_count:
// 1,105,055 during live testing) -- unlike Unipile's LinkedIn-session-based
// 1,000 cap.
//
// Enrichment note (out of scope for this discovery function, flagged for
// whoever builds Crustdata enrichment next): /person/enrich (base profile)
// worked in live testing, but /person/contact/enrich (personal email/phone)
// returned a hard 403 permission_error on the trial key tested -- personal
// contact enrichment appears plan-gated, not something to assume is
// available. Any future Crustdata enrichment integration (mirroring
// enrich-candidate-contact/enrich-candidate-devsignals) should degrade to
// base-profile-only enrichment rather than assume contact data will unlock.
const CRUSTDATA_API_KEY = Deno.env.get("CRUSTDATA_API_KEY");
const CRUSTDATA_SEARCH_URL = "https://api.crustdata.com/person/search";
const CRUSTDATA_API_VERSION = "2025-11-01";

// Checkpoint 3c: Voyage AI embeddings, used to semantically rank the batch
// of PDL hits against the role brief. Confirmed directly against Voyage's
// own docs (docs.voyageai.com) before writing this:
//   POST https://api.voyageai.com/v1/embeddings
//   Header: Authorization: Bearer <VOYAGE_API_KEY>
//   Body: { input: string | string[], model, input_type: "query" | "document" }
//   Response: { data: [{ embedding: number[], index: number }, ...], ... }
// voyage-4-lite specifically: it's in Voyage's 200-million-free-token tier
// (confirmed on Voyage's pricing page) and is their "optimized for latency
// and cost" model -- recruiting text isn't domain-specialized (not code,
// legal, or finance), so there's no reason to pay for a fancier model here.
// Voyage's embeddings are already unit-length (their own quickstart docs say
// so explicitly), so plain dot product IS cosine similarity -- no separate
// normalization step needed.
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY");
const VOYAGE_EMBED_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-4-lite";

// Title-expansion fix (pre-checkpoint-3d): confirmed directly by testing a
// competitor product (noon.ai) side-by-side on the same role brief that it
// expands a single job title into several equivalent titles before
// searching ("Backend Engineer" -> also searches "Backend Developer",
// "Software Engineer", "SWE", "Systems Engineer") rather than relying on one
// literal match_phrase, which was our previous behavior. Reuses the exact
// same Claude call pattern already established in parse-job-description
// (Stage 2) -- same env vars, same forced-tool-use shape -- rather than
// inventing a new one.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// Person Search API calls cost one credit per result returned, so we cap
// how many records a single request can pull back -- 10 by default, 25 max
// -- rather than risk an expensive accidental large pull while we're still
// testing the connection.
const DEFAULT_SIZE = 10;
const MAX_SIZE = 25;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST",
};

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });

// Drops vendor-identifying fields before candidates leave this edge function.
// Implemented in discoverySourceAttribution.ts (Vitest-covered).

async function requireAuth(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing authorization header" }, 401);
  }
  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer" || !token) {
    return jsonResponse({ error: "Invalid authorization header" }, 401);
  }
  try {
    await jose.jwtVerify(token, SUPABASE_JWT_KEYS, {
      issuer: SUPABASE_JWT_ISSUER,
    });
    return null; // authorized
  } catch {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
}

type RoleBrief = {
  id: number;
  name: string | null;
  seniority: string | null;
  location: string | null;
  industry: string | null;
  required_skills: string[] | null;
  // Coresignal query-redesign fix: total years-of-experience is a far more
  // reliably-populated Coresignal field (total_experience_duration_months)
  // than the management_level enum, so it's threaded through as its own
  // criterion rather than only living inside embedding text -- see
  // the coresignalProvider header comment for why this replaced seniority as
  // the primary hard threshold there.
  years_experience_min: number | null;
  // Years-experience-max fix: already captured on deals (parsed at JD intake,
  // editable in JdIntakePage.tsx) but never previously read or applied here --
  // the query builder only ever built a floor (gte), never a ceiling. See the
  // coresignalProvider range-filter section below for the actual lte clause.
  years_experience_max: number | null;
  // Agent H: recruiter-entered sourcing preferences/excludes -- see
  // supabase/schemas/24_agent_h_exclusion_company_size_workhistory_fields.sql.
  // Never LLM-derived from jd_text (unlike industry/required_skills), so
  // there's no "source of truth vs cache" concern for these the way there
  // is for role_brief_title_expansions below.
  excluded_companies: string[] | null;
  exclusion_keywords: string[] | null;
  company_type: string | null;
  company_size_min: number | null;
  company_size_max: number | null;
  // Past-position search fix (2026-07-22 session, migration
  // `deals_past_position_criteria`, applied live to the deals table --
  // no local migration file, this project has no supabase/migrations/
  // directory, schema changes go straight through the Supabase MCP against
  // the live project). Distinct from required_skills/must_have_keywords
  // (current-role-only, matched against the flat active_experience_title
  // field) and excluded_companies (also current-employer-only, see the
  // mustNot nested clause in coresignalProvider below) -- these two
  // instead describe a candidate's WORK HISTORY, verified live-queryable
  // against Coresignal's nested `experience` array (see the AGENT_H_HANDOFF_
  // 2026-07-21.md test log, Query 2: "Java developers currently at
  // Google/Meta/..., previously at Microsoft" -- 2 real matches, a genuine
  // two-nested-clause structure, not a guess). Recruiter-entered, same as
  // excluded_companies/exclusion_keywords above -- never LLM-derived.
  past_titles: string[] | null;
  past_companies: string[] | null;
  // Fields below are read only for building/caching the checkpoint 3c
  // embedding text -- not used by buildPdlQuery.
  jd_text: string | null;
  employment_type: string | null;
  must_have_keywords: string[] | null;
  nice_to_have_keywords: string[] | null;
  role_brief_embedding: number[] | null;
  role_brief_embedding_text: string | null;
  role_brief_embedding_model: string | null;
  // Read/written for the "resume search position" fix -- see
  // supabase/schemas/18_agent_h_search_position_cache.sql.
  role_brief_last_scroll_token: string | null;
  role_brief_last_scroll_query: string | null;
  // Read/written for the title-expansion fix -- see
  // supabase/schemas/19_agent_h_title_expansion_cache.sql.
  role_brief_title_expansions: string[] | null;
  role_brief_title_expansions_source_title: string | null;
};

// Fetches the role brief through PostgREST using the CALLER's own JWT
// (not a service-role key), so this function can only ever see role briefs
// the requesting recruiter's tenant is already allowed to see -- it rides
// on the exact same RLS policies as the rest of the app rather than
// introducing a new, separate access path.
async function fetchRoleBrief(
  roleBriefId: number,
  authHeader: string,
): Promise<RoleBrief | null> {
  const url =
    `${SUPABASE_URL}/rest/v1/deals` +
    `?id=eq.${roleBriefId}` +
    `&select=id,name,seniority,location,industry,required_skills,jd_text,` +
    `employment_type,must_have_keywords,nice_to_have_keywords,years_experience_min,` +
    `years_experience_max,` +
    `excluded_companies,exclusion_keywords,company_type,company_size_min,company_size_max,` +
    `past_titles,past_companies,` +
    `role_brief_embedding,role_brief_embedding_text,role_brief_embedding_model,` +
    `role_brief_last_scroll_token,role_brief_last_scroll_query,` +
    `role_brief_title_expansions,role_brief_title_expansions_source_title`;

  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY ?? "",
      Authorization: authHeader,
    },
  });

  if (!response.ok) {
    console.error(
      "fetchRoleBrief failed",
      response.status,
      await response.text(),
    );
    return null;
  }

  const rows = await response.json();
  return rows?.[0] ?? null;
}

// Checkpoint 3b: annotate each discovery hit with whether it's already been
// saved as a candidate (via the "Add to pipeline" action in
// save-sourced-candidate), so a recruiter re-running the same search
// doesn't have to guess who they already added. Batched into one request
// (source_id=in.(...)) rather than one lookup per result. Best-effort: if
// this lookup fails for any reason, every result is just left un-annotated
// rather than failing the whole search -- dedup-on-save (in
// save-sourced-candidate) is the part that actually prevents duplicates;
// this is a display convenience on top of that.
//
// Vendor-neutral update (2026-07-11 session): this queried candidates.pdl_id
// before the column was renamed to source_id (see migration
// agent_h_stage3_contact_and_devsignal_enrichment) -- same rename reason as
// save-sourced-candidate: Coresignal-sourced candidate ids were already
// being stored in a column named for PDL specifically.
async function annotateAlreadySaved(
  candidates: Array<Record<string, unknown>>,
  authHeader: string,
): Promise<void> {
  const sourceIds = candidates
    .map((c) => c.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (sourceIds.length === 0) return;

  try {
    const idList = sourceIds.map((id) => encodeURIComponent(id)).join(",");
    const url =
      `${SUPABASE_URL}/rest/v1/candidates` +
      `?source_id=in.(${idList})&select=id,source_id`;
    const response = await fetch(url, {
      headers: { apikey: SUPABASE_ANON_KEY ?? "", Authorization: authHeader },
    });
    if (!response.ok) return;

    const rows: Array<{ id: number; source_id: string }> =
      await response.json();
    const savedBySourceId = new Map(rows.map((r) => [r.source_id, r.id]));

    for (const candidate of candidates) {
      const sourceId =
        typeof candidate.id === "string" ? candidate.id : undefined;
      const savedId = sourceId ? savedBySourceId.get(sourceId) : undefined;
      candidate._already_saved = savedId !== undefined;
      candidate._candidate_id = savedId ?? null;
    }
  } catch (error) {
    console.error("annotateAlreadySaved failed (non-fatal)", error);
  }
}

// Server-side vendor attribution (2026-07-24): persist source_id -> vendor
// before stripVendorFieldsForClient removes _source_vendor from the client
// payload. Cleared on a fresh search; merged on scroll continuation. Skipped
// for preview calls. Best-effort -- save-sourced-candidate falls back to
// "manual" if a row is missing.
async function persistDiscoverySourceAttribution(
  dealId: number,
  vendor: string,
  candidates: Array<Record<string, unknown>>,
  authHeader: string,
  isContinuation: boolean,
): Promise<void> {
  const rows = buildDiscoveryAttributionRows(dealId, vendor, candidates);
  if (rows.length === 0) return;

  const headers = {
    apikey: SUPABASE_ANON_KEY ?? "",
    Authorization: authHeader,
    "Content-Type": "application/json",
  };

  try {
    if (!isContinuation) {
      const deleteResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/discovery_source_attribution?deal_id=eq.${dealId}`,
        { method: "DELETE", headers },
      );
      if (!deleteResponse.ok) {
        console.error(
          "discovery source attribution clear failed (non-fatal)",
          deleteResponse.status,
          await deleteResponse.text(),
        );
        return;
      }
    }

    const upsertResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/discovery_source_attribution?on_conflict=tenant_id,deal_id,source_id`,
      {
        method: "POST",
        headers: {
          ...headers,
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify(rows),
      },
    );

    if (!upsertResponse.ok) {
      console.error(
        "discovery source attribution upsert failed (non-fatal)",
        upsertResponse.status,
        await upsertResponse.text(),
      );
    }
  } catch (error) {
    console.error(
      "persistDiscoverySourceAttribution failed (non-fatal)",
      error,
    );
  }
}

// Calibration loop (2026-07-17): a structured search criterion born from a
// recruiter's calibration feedback (or, in future, the natural-language
// steering box), layered on top of a role brief's JD-derived fields -- see
// supabase/schemas/29_agent_h_learned_criteria.sql for the full design
// rationale. Deliberately a small, closed set of kinds: only ones that map
// cleanly onto fields the Coresignal query builder already understands.
type LearnedCriterion = {
  id: number;
  criterionType:
    | "require_keyword"
    | "exclude_keyword"
    | "years_experience_min"
    | "years_experience_max";
  value: { keyword?: string; years?: number };
  label: string;
  status: "active" | "relaxed";
  // Credit-burn fix (2026-07-22): these two columns already existed on
  // role_brief_learned_criteria (written by the best-effort cache write at
  // the bottom of handleCriteriaImpact's per-criterion loop below) but were
  // never read back out by fetchLearnedCriteria -- so every single call to
  // handleCriteriaImpact re-priced EVERY criterion from scratch via a live
  // Coresignal call, with no memory of the previous computation at all.
  // Threading these through is what makes the short-TTL cache in
  // handleCriteriaImpact possible. Both are nullable: a criterion that has
  // never had its impact computed yet (e.g. just created) has neither.
  lastRejectCount: number | null;
  lastRejectCountComputedAt: string | null;
};

// Fetches learned criteria for a role brief through PostgREST using the
// CALLER's own JWT, same access-control discipline as fetchRoleBrief above
// -- a recruiter can only ever see/apply criteria for role briefs their
// tenant already has access to. `statusFilter` narrows to just "active"
// (the normal search path only ever wants to apply active criteria) or
// omits it entirely to fetch the full history (the Control Panel needs to
// show relaxed criteria too, so it can offer "Reapply").
async function fetchLearnedCriteria(
  dealId: number,
  authHeader: string,
  statusFilter?: "active" | "relaxed",
): Promise<LearnedCriterion[]> {
  const url =
    `${SUPABASE_URL}/rest/v1/role_brief_learned_criteria` +
    `?deal_id=eq.${dealId}` +
    (statusFilter ? `&status=eq.${statusFilter}` : "") +
    // Credit-burn fix (2026-07-22): last_reject_count / last_reject_count_computed_at
    // added to the select list so handleCriteriaImpact's short-TTL cache
    // below has something to read -- these already existed on the table
    // (written by the PATCH at the bottom of handleCriteriaImpact) but this
    // select never asked for them back until now.
    `&select=id,criterion_type,value,label,status,last_reject_count,last_reject_count_computed_at&order=created_at.asc`;

  const response = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY ?? "", Authorization: authHeader },
  });

  if (!response.ok) {
    console.error(
      "fetchLearnedCriteria failed",
      response.status,
      await response.text(),
    );
    return [];
  }

  const rows: Array<{
    id: number;
    criterion_type: LearnedCriterion["criterionType"];
    value: LearnedCriterion["value"];
    label: string;
    status: LearnedCriterion["status"];
    last_reject_count: number | null;
    last_reject_count_computed_at: string | null;
  }> = await response.json();

  return rows.map((row) => ({
    id: row.id,
    criterionType: row.criterion_type,
    value: row.value ?? {},
    label: row.label,
    status: row.status,
    lastRejectCount: row.last_reject_count ?? null,
    lastRejectCountComputedAt: row.last_reject_count_computed_at ?? null,
  }));
}

// Checkpoint 3c: builds the descriptive text that gets embedded for the
// role-brief side of the comparison. Combines every structured field that
// carries real semantic signal about what this role needs -- not just the
// title, since jd_text and the keyword lists usually say much more about
// what actually matters for a good match than the title alone does.
function buildRoleBriefEmbeddingText(brief: RoleBrief): string {
  const parts: string[] = [];
  if (brief.name) parts.push(brief.name);
  if (brief.jd_text) parts.push(brief.jd_text);
  if (brief.industry) parts.push(`Industry: ${brief.industry}`);
  if (brief.seniority) parts.push(`Seniority: ${brief.seniority}`);
  if (brief.employment_type)
    parts.push(`Employment type: ${brief.employment_type}`);
  if (brief.required_skills?.length) {
    parts.push(`Required skills: ${brief.required_skills.join(", ")}`);
  }
  if (brief.must_have_keywords?.length) {
    parts.push(`Must-have: ${brief.must_have_keywords.join(", ")}`);
  }
  if (brief.nice_to_have_keywords?.length) {
    parts.push(`Nice to have: ${brief.nice_to_have_keywords.join(", ")}`);
  }
  return parts.join("\n");
}

// Same idea, candidate side: combines the fields from a PDL hit that
// describe who this person is professionally. Deliberately excludes name/
// contact fields (full_name, emails, linkedin_url) -- those identify the
// person but don't carry match-relevant signal, and there's no reason to
// send more personal data to a third-party API than the scoring needs.
function buildCandidateEmbeddingText(
  candidate: Record<string, unknown>,
): string {
  const parts: string[] = [];
  if (typeof candidate.job_title === "string") parts.push(candidate.job_title);
  if (typeof candidate.job_company_name === "string") {
    parts.push(`at ${candidate.job_company_name}`);
  }
  if (typeof candidate.location_name === "string") {
    parts.push(`Location: ${candidate.location_name}`);
  }
  if (Array.isArray(candidate.skills) && candidate.skills.length > 0) {
    parts.push(`Skills: ${candidate.skills.join(", ")}`);
  }
  return parts.join("\n");
}

// Calls Voyage's embeddings endpoint for a batch of texts in ONE request
// (Voyage accepts up to 1,000 strings per call per their docs) -- this is
// why candidates are embedded together rather than one call per candidate,
// same batching discipline as the sourcing engine design doc calls for
// generally. Returns vectors in the same order as the input texts (Voyage
// returns an "index" per item; this sorts by that defensively rather than
// assuming response order always matches request order).
async function embedTexts(
  texts: string[],
  inputType: "query" | "document",
): Promise<number[][]> {
  const response = await fetch(VOYAGE_EMBED_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model: VOYAGE_MODEL,
      input_type: inputType,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Voyage embeddings call failed (${response.status}): ${errorBody}`,
    );
  }

  const result = await response.json();
  const data: Array<{ embedding: number[]; index: number }> =
    result?.data ?? [];
  return data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

// Voyage embeddings are unit-length, so plain dot product IS cosine
// similarity -- confirmed directly against Voyage's own quickstart docs
// ("Voyage embeddings are normalized to length 1, therefore dot-product and
// cosine similarity are the same"), not assumed.
function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

// Returns the role brief's embedding vector, reusing the cached one on the
// deals row when the exact text that would be embedded today matches what
// was embedded last time (and it came from the same Voyage model) --
// otherwise re-embeds and writes the fresh vector back to the cache. This is
// what keeps repeated "search wider" clicks on the same role brief from
// re-paying Voyage for identical role-brief text over and over; only the
// candidates need a fresh embedding each call, since they differ every time.
async function getOrRefreshRoleBriefEmbedding(
  brief: RoleBrief,
  authHeader: string,
): Promise<number[]> {
  const currentText = buildRoleBriefEmbeddingText(brief);

  if (
    brief.role_brief_embedding &&
    brief.role_brief_embedding_text === currentText &&
    brief.role_brief_embedding_model === VOYAGE_MODEL
  ) {
    return brief.role_brief_embedding;
  }

  const [vector] = await embedTexts([currentText], "query");

  // Best-effort cache write: if this PATCH fails for any reason, scoring
  // for THIS request still succeeds (we already have the vector) -- it just
  // means the next call re-embeds the same text again, a cost/latency
  // inconvenience, not a functional failure.
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/deals?id=eq.${brief.id}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_ANON_KEY ?? "",
        Authorization: authHeader,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        role_brief_embedding: vector,
        role_brief_embedding_text: currentText,
        role_brief_embedding_model: VOYAGE_MODEL,
        role_brief_embedding_updated_at: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.error("role brief embedding cache write failed (non-fatal)", error);
  }

  return vector;
}

// Title-expansion fix: asks Claude for a short list of job titles a
// recruiter would consider equivalent to this role brief's title, so PDL
// searches aren't limited to matching one literal title string. Confirmed
// as a real gap by testing a competitor (noon.ai) on the identical role
// brief -- see the header note near ANTHROPIC_API_KEY above. Falls back to
// just the original title (as a one-item list) if ANTHROPIC_API_KEY isn't
// set or the call fails for any reason -- this is a quality improvement,
// not something that should ever break a search that would otherwise work.
async function expandTitle(title: string): Promise<string[]> {
  if (!ANTHROPIC_API_KEY) return [title];

  const EXPANSION_TOOL = {
    name: "expand_job_title",
    description:
      "List job titles a recruiter would consider equivalent or closely interchangeable with the given title, for the purpose of a candidate search.",
    input_schema: {
      type: "object",
      properties: {
        titles: {
          type: "array",
          items: { type: "string" },
          description:
            "3-6 job titles, INCLUDING the original title itself, that a recruiter searching for this role would also consider a match. E.g. for 'Backend Engineer': ['Backend Engineer', 'Backend Developer', 'Software Engineer', 'Software Developer', 'SWE']. Keep titles short (no seniority prefix repeated redundantly if it's already implied).",
        },
      },
      required: ["titles"],
    },
  };

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 512,
      tools: [EXPANSION_TOOL],
      tool_choice: { type: "tool", name: "expand_job_title" },
      messages: [
        {
          role: "user",
          content: `Job title to expand: "${title}"`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
  }

  const result = await response.json();
  const toolUseBlock = result?.content?.find(
    (block: any) => block.type === "tool_use",
  );
  const titles = toolUseBlock?.input?.titles;
  if (!Array.isArray(titles) || titles.length === 0) return [title];
  return titles.filter(
    (t): t is string => typeof t === "string" && t.length > 0,
  );
}

// Cache-or-expand, same pattern as getOrRefreshRoleBriefEmbedding: reuses
// the cached expansion list when the role brief's title text hasn't
// changed since it was last generated, otherwise calls Claude and writes
// the fresh list back. Best-effort cache write -- a failed PATCH just means
// the next search re-expands the same title again, not a broken search.
async function getOrExpandTitles(
  brief: RoleBrief,
  authHeader: string,
): Promise<string[]> {
  if (!brief.name) return [];

  if (
    brief.role_brief_title_expansions &&
    brief.role_brief_title_expansions_source_title === brief.name
  ) {
    return brief.role_brief_title_expansions;
  }

  const titles = await expandTitle(brief.name);

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/deals?id=eq.${brief.id}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_ANON_KEY ?? "",
        Authorization: authHeader,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        role_brief_title_expansions: titles,
        role_brief_title_expansions_source_title: brief.name,
        role_brief_title_expansions_updated_at: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.error("title expansion cache write failed (non-fatal)", error);
  }

  return titles;
}

// Embeds every candidate in the batch in one Voyage call, scores each one
// against the role brief's vector, attaches "_match_score", and returns the
// SAME candidates re-sorted best-match-first. Never removes anyone from the
// array -- Harsha's explicit call (see header comment): ranking reorders,
// it never hides.
async function scoreAndSortCandidates(
  candidates: Array<Record<string, unknown>>,
  roleBriefVector: number[],
): Promise<void> {
  if (candidates.length === 0) return;

  const candidateTexts = candidates.map(buildCandidateEmbeddingText);
  const candidateVectors = await embedTexts(candidateTexts, "document");

  candidates.forEach((candidate, i) => {
    candidate._match_score =
      Math.round(dotProduct(roleBriefVector, candidateVectors[i]) * 1000) /
      1000;
  });

  candidates.sort((a, b) => {
    const scoreA =
      typeof a._match_score === "number" ? a._match_score : -Infinity;
    const scoreB =
      typeof b._match_score === "number" ? b._match_score : -Infinity;
    return scoreB - scoreA;
  });
}

const REMOTE_PATTERN = /remote/i;

// Candidate-narrowing fix (post-checkpoint-3d, prompted directly by a real
// role brief coming back with 7,576 PDL matches -- far more than anyone
// could affordably or usefully pull one credit at a time).
//
// First attempt at this (superseded, keeping the history here since it's
// the reason the current design looks the way it does): required_skills
// was made to require EVERY listed skill (an AND across the array). Tested
// directly against role brief #4 ("Java Developer", 10 required skills)
// and it changed NOTHING -- still 7,576. Investigated why, without
// spending any PDL credits (a database read of the role brief's actual
// data, plus PDL's own schema docs):
//   1. Two of the 10 listed skills were compound strings -- "AWS/Azure/GCP"
//      and "Hibernate/JPA". PDL's `skills` field is a controlled, curated
//      enum vocabulary (confirmed directly: docs.peopledatalabs.com/docs/
//      fields describes it as Array[Enum(String)], normalized single
//      concepts), not free text -- a literal "aws/azure/gcp" is not a real
//      value in that vocabulary and can never match a real candidate.
//   2. Even with clean spelling, requiring a real PDL profile to explicitly
//      tag all 10 fairly specific technologies (down to "Spring Kafka" as
//      a literal skill tag) is unrealistic -- most profiles won't have
//      anywhere near that level of tagging completeness. Swinging from ANY
//      (dominated by whichever skill is most generic -- "Java" alone
//      already nets thousands) to ALL (gated by whichever skill is rarest
//      or worst-phrased) is the worst of both, and PDL structurally can't
//      express "at least K of N" -- minimum_should_match is disallowed
//      outright (confirmed earlier, see the required_skills comment
//      history in buildPdlQuery below).
//
// Current design, confirmed directly with Harsha given that constraint:
// only the FIRST listed required skill (JD skill lists are written most-
// important-first; for role #4 that's "Java") is used as a real PDL
// filter, alongside title/location/seniority. The REST of required_skills
// is deliberately not sent to PDL as a filter at all -- it's already part
// of the role brief's embedding text (see buildRoleBriefEmbeddingText),
// so it still shapes the Voyage semantic re-rank; PDL's boolean engine
// isn't the right tool for "how well does this profile match 9 specific
// technologies", and forcing it to try was the actual bug.
//
// Seniority is separately mapped onto PDL's own canonical job_title_levels
// taxonomy (confirmed directly against PDL's docs,
// docs.peopledatalabs.com/docs/job-title-levels, not assumed: cxo,
// director, entry, manager, owner, partner, senior, training, unpaid, vp)
// and used as a "must" filter when a mapping exists. See
// SENIORITY_TO_PDL_LEVELS below for the mapping and its known gaps. This
// is a real filter (unlike title-expansion, which only ever widened
// matching) -- if it's sparse for a given role brief, pdlProvider.search
// below runs the seniority-tightened query first and falls back to the
// looser version if it returns suspiciously few results, always
// disclosing which mode actually ran via `notes`.
//
// PDL's canonical seniority taxonomy is coarser than ours in the middle:
// it has nothing between "entry" and "senior", so our "mid_level" has no
// honest equivalent and is deliberately left unmapped (null) rather than
// forced into a bucket that would misrepresent it -- guessing wrong here
// would silently exclude good candidates, which is worse than not
// filtering at all. "staff" and "principal" are IC-track levels PDL
// doesn't distinguish from "senior" -- an approximation, disclosed to the
// recruiter via a note whenever it's actually applied to a search, not
// silently assumed to be exact.
const SENIORITY_TO_PDL_LEVELS: Record<string, string[] | null> = {
  intern: ["training"],
  entry_level: ["entry"],
  mid_level: null,
  senior: ["senior"],
  staff: ["senior"],
  principal: ["senior"],
  manager: ["manager"],
  director: ["director"],
  executive: ["vp", "cxo"],
};

// Apollo's own person_seniorities[] enum (confirmed directly against
// docs.apollo.io/reference/people-api-search): owner, founder, c_suite,
// partner, vp, head, director, manager, senior, entry, intern. Same
// honest-gap principle as PDL above -- "mid_level" has no clean equivalent
// in Apollo's taxonomy either (nothing between "entry" and "senior"), so
// it's deliberately left unmapped rather than guessed. "staff"/"principal"
// are IC-track levels Apollo doesn't distinguish from "senior" -- disclosed
// via a note whenever actually applied, not silently assumed exact.
const SENIORITY_TO_APOLLO_LEVELS: Record<string, string[] | null> = {
  intern: ["intern"],
  entry_level: ["entry"],
  mid_level: null,
  senior: ["senior"],
  staff: ["senior"],
  principal: ["senior"],
  manager: ["manager"],
  director: ["director"],
  executive: ["vp", "c_suite"],
};

// Coresignal Multi-source Employee API's `active_experience_management_
// level` enum (confirmed directly against their docs): C-Level, Director,
// Founder, Head, Intern, Manager, Owner, Partner, President/Vice
// President, Senior, Specialist. This taxonomy is skewed toward MANAGEMENT
// responsibility rather than an IC seniority ladder -- there's no "entry"
// level at all, and "Specialist" is Coresignal's generic term for any
// non-management IC, which would just as easily describe a junior IC as a
// senior one. Mapping "entry_level" or "mid_level" to "Specialist" would
// therefore misrepresent both -- left unmapped (null) instead, same
// honest-gap principle as the PDL and Apollo tables above.
const SENIORITY_TO_CORESIGNAL_LEVELS: Record<string, string[] | null> = {
  intern: ["Intern"],
  entry_level: null,
  mid_level: null,
  senior: ["Senior"],
  staff: ["Senior"],
  principal: ["Senior"],
  manager: ["Manager"],
  director: ["Director"],
  executive: ["C-Level", "President/Vice President"],
};

// A seniority-tightened query that comes back with fewer matches than this
// is treated as "too aggressive for this role brief's data" and re-run
// without the seniority filter instead, rather than showing the recruiter
// a misleadingly tiny number. Deliberately a low bar -- this is a safety
// net for sparse PDL tagging, not a normal outcome; most seniority-
// tightened searches should return far more than this.
const TIGHT_QUERY_FALLBACK_THRESHOLD = 3;

// Turns a role brief's structured fields into a PDL Elasticsearch-DSL
// query. Deliberately simple for this first checkpoint:
//   - title -> match_phrase on the candidate's current job_title. This is
//     a heuristic ("find people whose current title matches the role
//     we're hiring for"), not a guarantee of relevance -- refining this is
//     later-checkpoint work, once we can see real results to tune against.
//   - location -> a "term" match on location_locality (just the city, e.g.
//     "hyderabad"), skipped entirely for remote roles. Bugfix: the first
//     version of this used match_phrase on location_name, which holds the
//     FULL "city, region, country" string (e.g. "hyderabad, telangana,
//     india"). location_name turns out to be a non-analyzed field, so a
//     partial match_phrase against just the city silently matched nobody,
//     even for a huge tech hub like Hyderabad. Confirmed via PDL's own API
//     Playground: "software engineer" + location_name match_phrase
//     "hyderabad" = 0 results; the same title + location_locality term
//     "hyderabad" = 34,697 results. location_locality holds just the city
//     ("hyderabad"), which is what a term query needs to match exactly.
//   - required_skills -> only the FIRST listed skill is used as a PDL
//     filter (split on "/" into an OR-group if it's a compound string like
//     "AWS/Azure/GCP"). The rest of the list is deliberately NOT sent to
//     PDL -- see the candidate-narrowing header note above for why forcing
//     PDL's boolean engine to match many specific skills at once doesn't
//     work against their controlled skill vocabulary. The remaining skills
//     still influence ranking via the role brief's embedding text.
//   - seniority -> mapped to PDL's job_title_levels taxonomy and applied
//     as a "must" filter when useSeniority is true and a mapping exists.
function buildPdlQuery(
  criteria: DiscoveryCriteria,
  options: { useSeniority: boolean },
): {
  query: Record<string, unknown>;
  notes: string[];
  usedSeniorityLevels: string[] | null;
} {
  const must: Record<string, unknown>[] = [];
  const notes: string[] = [];
  let usedSeniorityLevels: string[] | null = null;

  if (criteria.titles && criteria.titles.length > 0) {
    // Nested bool with ONLY "should" clauses (no "must"/"filter" inside it)
    // defaults to requiring at least one should clause to match -- standard
    // Elasticsearch bool-query semantics, confirmed deliberately so this
    // does NOT need PDL's disallowed minimum_should_match parameter (see
    // the bugfix note on the required_skills clause below for why that
    // parameter is off the table). This is what lets a candidate match on
    // ANY of the expanded title synonyms, not just the literal title text.
    if (criteria.titles.length === 1) {
      must.push({
        match_phrase: { job_title: criteria.titles[0].toLowerCase() },
      });
    } else {
      must.push({
        bool: {
          should: criteria.titles.map((t) => ({
            match_phrase: { job_title: t.toLowerCase() },
          })),
        },
      });
      notes.push(
        `Searching ${criteria.titles.length} equivalent titles: ${criteria.titles.join(", ")}.`,
      );
    }
  } else {
    notes.push(
      "No role title on this role brief -- title not used in the query.",
    );
  }

  if (criteria.location && !REMOTE_PATTERN.test(criteria.location)) {
    // Role brief location text might be just a city ("Hyderabad") or a
    // fuller "City, Region/Country" string -- take the first comma-
    // separated segment as the city, since that's what location_locality
    // holds. Good enough for this checkpoint; genuinely ambiguous location
    // text (e.g. multi-city regions) is a later-checkpoint refinement.
    const locality = criteria.location.split(",")[0].trim().toLowerCase();
    must.push({ term: { location_locality: locality } });
  } else if (criteria.location) {
    notes.push(
      "Role marked remote/location-flexible -- no location constraint applied.",
    );
  }

  if (criteria.requiredSkills && criteria.requiredSkills.length > 0) {
    // Only the FIRST listed skill becomes a real PDL filter -- see the
    // candidate-narrowing header note above for why trying to filter on
    // many specific skills at once doesn't work against PDL's controlled
    // skill vocabulary. Split on "/" defensively in case the top skill
    // itself is a compound string (e.g. "AWS/Azure/GCP") -- treated as an
    // OR-group (a candidate matching any one counts), same nested-bool
    // pattern as title expansion.
    const topSkill = criteria.requiredSkills[0];
    const subTokens = topSkill
      .split("/")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);

    if (subTokens.length > 1) {
      must.push({
        bool: {
          should: subTokens.map((t) => ({ term: { skills: t } })),
        },
      });
    } else {
      must.push({ term: { skills: subTokens[0] } });
    }

    if (criteria.requiredSkills.length > 1) {
      const remaining = criteria.requiredSkills.slice(1);
      notes.push(
        `Filtering directly on the top required skill ("${topSkill}"). The other ${remaining.length} listed skill(s) (${remaining.join(", ")}) aren't used as a hard PDL filter -- PDL's controlled skill vocabulary makes matching many specific skills at once unreliable -- but they still shape match ranking.`,
      );
    } else {
      notes.push(`Requiring skill: "${topSkill}".`);
    }
  } else {
    notes.push(
      "No required skills on this role brief -- skills not used in the query.",
    );
  }

  if (options.useSeniority && criteria.seniority) {
    const mappedLevels = SENIORITY_TO_PDL_LEVELS[criteria.seniority];
    if (mappedLevels && mappedLevels.length > 0) {
      must.push({ terms: { job_title_levels: mappedLevels } });
      usedSeniorityLevels = mappedLevels;
      notes.push(
        `Requiring seniority level "${criteria.seniority}" (mapped to PDL's ${mappedLevels.map((l) => `"${l}"`).join("/")}).`,
      );
    } else {
      notes.push(
        `Seniority "${criteria.seniority}" doesn't have a clean equivalent in PDL's own taxonomy -- not used as a filter.`,
      );
    }
  } else if (criteria.seniority) {
    notes.push("Seniority not applied for this broader search pass.");
  } else {
    notes.push(
      "No seniority on this role brief -- seniority not used in the query.",
    );
  }

  const bool: Record<string, unknown> = { must };

  return { query: { bool }, notes, usedSeniorityLevels };
}

// --- Vendor abstraction layer (architecture doc, Section 2) ---
//
// Every discovery vendor implements this same shape. Today only PDL is
// configured, so runDiscovery below always resolves to pdlProvider -- but
// adding a second vendor (Coresignal, per checkpoint 3d) means writing one
// more object with this shape and appending it to DISCOVERY_PROVIDERS, not
// touching the handler or any of the caching/scoring logic that follows.
//
// Deliberately NOT a fully vendor-agnostic query object: PDL's Elasticsearch-
// DSL query language and Coresignal's own query format aren't compatible, so
// each provider takes the same vendor-agnostic *criteria* (title, location,
// required skills -- pulled from the role brief) and builds its own query
// internally. This also means each provider owns its own idea of "the same
// query as last time" for the resume-search-position cache (queryText
// below) -- appropriate, since a different vendor's pagination token isn't
// comparable to another's anyway.

type DiscoveryCriteria = {
  // Title-expansion fix: a list of equivalent titles (the original title
  // plus synonyms from getOrExpandTitles), not just the single literal
  // title text -- see the header note near ANTHROPIC_API_KEY above for why.
  // Null/empty when the role brief has no title at all.
  titles: string[] | null;
  location: string | null;
  requiredSkills: string[] | null;
  // Candidate-narrowing fix: the role brief's seniority value (one of the
  // enum values parse-job-description assigns -- see SENIORITY_TO_PDL_LEVELS
  // above for the PDL mapping). Null when the role brief has no seniority set.
  seniority: string | null;
  // Coresignal query-redesign fields (see coresignalProvider header comment).
  // PDL/Apollo don't currently use these -- added here rather than as a
  // Coresignal-only side-channel so any future provider can opt into the
  // same criteria without another plumbing change.
  yearsExperienceMin: number | null;
  // Years-experience-max fix: mirrors yearsExperienceMin -- see the RoleBrief
  // field comment above for why this was missing until now.
  yearsExperienceMax: number | null;
  industry: string | null;
  niceToHaveKeywords: string[] | null;
  // Agent H: recruiter-entered hard excludes. The only fields on this type
  // that ever become a must_not clause -- every other field here is
  // deliberately a should/soft signal (see coresignalProvider header
  // comment). Null/empty when the recruiter didn't set any.
  excludedCompanies: string[] | null;
  exclusionKeywords: string[] | null;
  // Agent H: sourcing-preference soft signals, same "should, never
  // excludes" treatment as industry -- Coresignal's company-size/type
  // taxonomy is coarse enough that hard-filtering on it risks losing real
  // matches, same reasoning as the industry field above.
  companyType: string | null;
  companySizeMin: number | null;
  companySizeMax: number | null;
  // Past-position search fix (see the RoleBrief.past_titles/past_companies
  // field comment above for the full rationale and the live-verified
  // Coresignal test this is based on). Distinct from `titles`/
  // `requiredSkills` (current-role-only signals, matched against the flat
  // active_experience_title field) and `excludedCompanies` (also current-
  // employer-only) -- these describe a candidate's work HISTORY, matched
  // against Coresignal's nested `experience` array without the
  // active_experience:1 restriction those other clauses use. Null/empty
  // when the recruiter hasn't entered any past-position preference.
  pastTitles: string[] | null;
  pastCompanies: string[] | null;
  // Calibration loop: ACTIVE learned criteria for this role brief (already
  // filtered by status -- see fetchLearnedCriteria). Null/empty when none
  // exist yet. Only coresignalProvider currently applies these (see its
  // header comment) -- pdlProvider ignores this field entirely since PDL is
  // dormant for discovery.
  learnedCriteria: LearnedCriterion[] | null;
};

type DiscoverySearchOptions = {
  size: number;
  // Explicit "search wider" token sent by the frontend for an in-session
  // continuation -- takes priority over the cached position below.
  scrollToken?: string;
  // The cheap size=1 "probe" never reads or writes the cache -- see the
  // resume-search-position fix's comments further down.
  isPreview: boolean;
  cachedScrollToken: string | null;
  cachedScrollQuery: string | null;
};

type DiscoverySearchResult = {
  candidates: Array<Record<string, unknown>>;
  total: number;
  scrollToken: string | null;
  // This provider's own serialized query -- cached alongside scrollToken so
  // a later fetch can tell whether the cached token is still valid for the
  // CURRENT query, not just present.
  queryText: string;
  notes: string[];
  // Total-match-count fix: the REAL total number of matches for this query
  // across Coresignal's whole index (from x-total-results on the main
  // search endpoint), distinct from `total` above (which for Coresignal is
  // just "how many candidates came back in this preview page"). Null when
  // a provider doesn't support this (e.g. PDL already has a real `total`,
  // so it never sets this separately) or when the supplementary lookup
  // failed -- best-effort, never blocks the actual candidate results.
  totalMatches?: number | null;
};

interface DiscoveryProvider {
  name: string;
  // Cheap, synchronous: lets runDiscovery skip an unconfigured vendor (e.g.
  // no API key set yet) without treating that as a vendor *failure* worth
  // logging or falling back from noisily.
  isConfigured(): boolean;
  search(
    criteria: DiscoveryCriteria,
    options: DiscoverySearchOptions,
  ): Promise<DiscoverySearchResult>;
}

// Thrown when the ROLE BRIEF doesn't have enough information to search --
// a data problem, not a vendor outage, so runDiscovery below re-throws this
// immediately instead of trying the next provider (trying Coresignal with
// the same too-thin criteria would fail the exact same way).
class DiscoveryConfigError extends Error {}

// Runs one already-built PDL query end to end: resolves which scroll token
// (if any) to send, calls PDL, and normalizes the response. Pulled out of
// pdlProvider.search so the tight-vs-loose fallback logic there can call it
// twice against two different queries without duplicating any of this.
async function executeQuery(
  query: Record<string, unknown>,
  notes: string[],
  options: DiscoverySearchOptions,
): Promise<DiscoverySearchResult> {
  if (
    !(query.bool as Record<string, unknown>).must ||
    ((query.bool as Record<string, unknown>).must as unknown[]).length === 0
  ) {
    throw new DiscoveryConfigError(
      "This role brief doesn't have enough information (title or location) to search PDL yet.",
    );
  }

  const queryText = JSON.stringify(query);

  // "Resume search position" fix: if the frontend didn't explicitly send
  // a scroll_token (a fresh Preview/Fetch click, not an in-session Search
  // wider), and this isn't a preview call, reuse the last scroll_token
  // this role brief left off at -- as long as PDL's query is EXACTLY the
  // same one that token was captured against (a scroll_token is only
  // valid for repeated use with its original query).
  let effectiveScrollToken = options.scrollToken;
  if (!effectiveScrollToken && !options.isPreview) {
    if (options.cachedScrollToken && options.cachedScrollQuery === queryText) {
      effectiveScrollToken = options.cachedScrollToken;
      notes.push(
        "Continuing from where this role brief's search left off last time -- not starting over from the top.",
      );
    }
  }

  // Bugfix carried over from checkpoint 3a: PDL's "dataset" parameter
  // defaults to "resume" if not set explicitly -- a much narrower slice
  // of their data than the full Person Dataset. "all" is required or even
  // common titles come back with zero matches.
  const pdlUrl =
    `${PDL_SEARCH_URL}?query=${encodeURIComponent(
      JSON.stringify(query),
    )}&size=${options.size}&dataset=all` +
    (effectiveScrollToken
      ? `&scroll_token=${encodeURIComponent(effectiveScrollToken)}`
      : "");

  const pdlResponse = await fetch(pdlUrl, {
    method: "GET",
    headers: { "X-Api-Key": PDL_API_KEY! },
  });

  const pdlResult = await pdlResponse.json();

  // PDL's quirk, not a bug in our code: zero matches comes back as an
  // HTTP 404 with { type: "not_found" } -- that's PDL's way of saying
  // "zero results," not a real failure. Treat it as a normal empty result.
  const isZeroResults =
    pdlResponse.status === 404 &&
    (pdlResult?.error?.type === "not_found" || pdlResult?.type === "not_found");

  if (!isZeroResults && (!pdlResponse.ok || pdlResult?.status >= 400)) {
    throw new Error(
      `PDL API error (${pdlResult?.status ?? pdlResponse.status}): ${JSON.stringify(
        pdlResult?.error ?? pdlResult,
      )}`,
    );
  }

  return {
    candidates: pdlResult.data ?? [],
    total: pdlResult.total ?? 0,
    scrollToken: pdlResult.scroll_token ?? null,
    queryText,
    notes,
  };
}

const _pdlProvider: DiscoveryProvider = {
  name: "pdl",
  isConfigured: () => Boolean(PDL_API_KEY),
  async search(criteria, options) {
    // "Search wider" continuation: the frontend is resending a scroll_token
    // from a previous response. PDL requires resending the EXACT same query
    // that token was issued against -- so reuse the query this role brief's
    // last fetch actually used (cached alongside the scroll position, see
    // role_brief_last_scroll_query) rather than re-deciding tight-vs-loose
    // here, which could rebuild a different query and silently break the
    // token/query pairing PDL expects.
    if (options.scrollToken && options.cachedScrollQuery) {
      try {
        const cachedQuery = JSON.parse(options.cachedScrollQuery);
        return await executeQuery(cachedQuery, [], options);
      } catch (error) {
        console.error(
          "Failed to reuse cached query for scroll continuation, falling back to a fresh decision",
          error,
        );
      }
    }

    // Fresh search: try the version of the query with mapped seniority
    // applied first (title, location, and the top required skill are
    // always applied regardless -- see buildPdlQuery). See the
    // candidate-narrowing header note above buildPdlQuery for why
    // seniority specifically still gets this tight-then-fallback
    // treatment while required_skills no longer does.
    const tight = buildPdlQuery(criteria, { useSeniority: true });
    const tightResult = await executeQuery(tight.query, tight.notes, options);
    const wasTightened = (tight.usedSeniorityLevels?.length ?? 0) > 0;

    if (wasTightened && tightResult.total < TIGHT_QUERY_FALLBACK_THRESHOLD) {
      const loose = buildPdlQuery(criteria, { useSeniority: false });
      const looseResult = await executeQuery(loose.query, loose.notes, options);
      looseResult.notes.unshift(
        `Requiring seniority level "${criteria.seniority}" returned only ${tightResult.total} match(es) for this role brief -- broadened automatically to standard matching instead.`,
      );
      return looseResult;
    }

    return tightResult;
  },
};

// Normalizes a vendor's native candidate shape into the same shape PDL
// hits already have (id, full_name, job_title, job_company_name,
// location_name, skills, linkedin_url) -- so annotateAlreadySaved,
// buildCandidateEmbeddingText, the calibration snapshot, and the frontend
// card UI all keep working unmodified regardless of which vendor served a
// given search. `_source_vendor` tags each hit for save-sourced-candidate's
// sourced_via attribution; discoverCandidates strips it at jsonResponse time
// (see stripVendorFieldsForClient) so vendor names never reach the browser.
function normalizeApolloCandidate(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const org = (raw.organization ?? {}) as Record<string, unknown>;
  const firstName = typeof raw.first_name === "string" ? raw.first_name : "";
  // Enriched (bulk_match) responses have a real last_name; un-enriched
  // search results only have last_name_obfuscated (e.g. "Po***r") -- prefer
  // the real one when present.
  const lastName =
    typeof raw.last_name === "string"
      ? raw.last_name
      : typeof raw.last_name_obfuscated === "string"
        ? raw.last_name_obfuscated
        : "";
  const cityLike = [raw.city, raw.state, raw.country]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(", ");
  // Apollo exposes linkedin_url on enriched bulk_match rows; search-only
  // hits often omit it. Same bare-host strip as Coresignal/PDL normalizers.
  const rawLinkedinUrl =
    typeof raw.linkedin_url === "string" ? raw.linkedin_url : null;
  return {
    id: typeof raw.id === "string" ? raw.id : String(raw.id ?? ""),
    full_name:
      typeof raw.name === "string" && raw.name.length > 0
        ? raw.name
        : `${firstName} ${lastName}`.trim(),
    job_title: typeof raw.title === "string" ? raw.title : null,
    job_company_name: typeof org.name === "string" ? org.name : null,
    location_name: cityLike.length > 0 ? cityLike : null,
    // Real taxonomy gap (see header note above): Apollo has no structured
    // skills field, so this is always empty for Apollo candidates -- the
    // recruiter sees an honest blank rather than a fabricated skills list.
    skills: [],
    linkedin_url: rawLinkedinUrl
      ? rawLinkedinUrl.replace(/^https?:\/\//i, "")
      : null,
    years_experience: apolloYearsExperience(raw),
    company_size: apolloCompanySize(raw),
    _source_vendor: "apollo",
  };
}

// Agent H fix (2026-07-15, THIRD and final pass -- verified against a real
// response, not docs): the two prior passes both went off Coresignal's
// PUBLISHED docs (Base Employee API page, then the Multi-source Employee
// API page), and both were wrong, because Coresignal's own docs are
// inaccurate here -- the live `employee_multi_source/search/es_dsl/preview`
// response does NOT use `professional_network_url` at all. Confirmed by
// temporarily writing one full raw candidate record to a debug column and
// reading it back: the real response looks like
//   { id, _score, headline, full_name, company_name, linkedin_url,
//     location_full, company_website, followers_count, company_industry,
//     location_country, connections_count, company_hq_country,
//     company_linkedin_url, active_experience_title,
//     company_hq_full_address, active_experience_department,
//     active_experience_management_level }
// -- i.e. the field is simply `linkedin_url` (not `professional_network_
// url`, and not `profile_url` either -- both prior guesses, both wrong).
// `active_experience_title`, `location_full`, `location_country`, and
// `company_name` WERE already correct in the previous pass (confirmed
// present with expected values in the captured sample), so only the
// LinkedIn field name itself was ever wrong.
//
// `linkedin_url` comes back as a full URL with scheme (e.g.
// "https://www.linkedin.com/in/naga-swetha-kotari"), unlike PDL's bare
// "linkedin.com/in/..." format that the rest of this codebase standardized
// on (see the candidates table, save-sourced-candidate, and the frontend's
// href={`https://${candidate.linkedin_url}`} construction in
// SourceCandidatesPage.tsx, which all assume no scheme is present) -- still
// stripped below so it matches that bare-domain convention.
function normalizeCoresignalCandidate(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const rawLinkedinUrl =
    typeof raw.linkedin_url === "string" ? raw.linkedin_url : null;
  return {
    id: typeof raw.id === "string" ? raw.id : String(raw.id ?? ""),
    full_name: typeof raw.full_name === "string" ? raw.full_name : null,
    job_title:
      typeof raw.active_experience_title === "string"
        ? raw.active_experience_title
        : typeof raw.headline === "string"
          ? raw.headline
          : null,
    job_company_name:
      typeof raw.company_name === "string" ? raw.company_name : null,
    location_name:
      typeof raw.location_full === "string"
        ? raw.location_full
        : typeof raw.location_country === "string"
          ? raw.location_country
          : null,
    // inferred_skills isn't part of the preview response's denormalized
    // field set (see header note) -- left empty rather than guessed here;
    // a later checkpoint could add a follow-up "collect" call per shown
    // candidate if skills display turns out to matter for the comparison.
    skills: [],
    linkedin_url: rawLinkedinUrl
      ? rawLinkedinUrl.replace(/^https?:\/\//i, "")
      : null,
    years_experience: coresignalYearsExperience(raw),
    company_size: coresignalCompanySize(raw),
    _source_vendor: "coresignal",
  };
}

// Apollo provider (taxonomy/boolean-logic test). Two real HTTP calls:
// 1) the free People Search (person_titles/person_locations/person_
//    seniorities), which returns obfuscated results, then
// 2) people/bulk_match on the returned ids, which spends Apollo enrichment
//    credits (Harsha's explicit call, see header note) to get real
//    names/locations back for a genuine side-by-side against PDL.
// Deliberately simpler than pdlProvider for this v1 test: no tight/loose
// seniority fallback yet -- that refinement is worth adding once we can
// see real result counts to tune against, same "start simple, refine from
// real results" approach already used for PDL.
const _apolloProvider: DiscoveryProvider = {
  name: "apollo",
  isConfigured: () => Boolean(APOLLO_API_KEY),
  async search(criteria, options) {
    const notes: string[] = [];
    const body: Record<string, unknown> = { per_page: options.size, page: 1 };

    if (criteria.titles && criteria.titles.length > 0) {
      body.person_titles = criteria.titles;
      if (criteria.titles.length > 1) {
        notes.push(
          `Searching ${criteria.titles.length} equivalent titles: ${criteria.titles.join(", ")}.`,
        );
      }
    } else {
      notes.push(
        "No role title on this role brief -- title not used in the query.",
      );
    }

    if (criteria.location && !REMOTE_PATTERN.test(criteria.location)) {
      body.person_locations = [criteria.location];
    } else if (criteria.location) {
      notes.push(
        "Role marked remote/location-flexible -- no location constraint applied.",
      );
    }

    if (criteria.requiredSkills && criteria.requiredSkills.length > 0) {
      // Real taxonomy gap: Apollo has no structured skills filter, only a
      // vague free-text q_keywords blob -- so the top required skill goes
      // there as a best-effort keyword match, not a real filter the way
      // PDL's/Coresignal's dedicated skills fields are.
      body.q_keywords = criteria.requiredSkills[0];
      notes.push(
        `Apollo has no structured skills field -- using "${criteria.requiredSkills[0]}" as a free-text keyword search only, not a real filter.`,
      );
    }

    if (criteria.seniority) {
      const mapped = SENIORITY_TO_APOLLO_LEVELS[criteria.seniority];
      if (mapped && mapped.length > 0) {
        body.person_seniorities = mapped;
        notes.push(
          `Requiring seniority level "${criteria.seniority}" (mapped to Apollo's ${mapped.map((l) => `"${l}"`).join("/")}).`,
        );
      } else {
        notes.push(
          `Seniority "${criteria.seniority}" doesn't have a clean equivalent in Apollo's own taxonomy -- not used as a filter.`,
        );
      }
    }

    const queryText = JSON.stringify({ ...body, page: undefined });

    const searchResponse = await fetch(APOLLO_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "x-api-key": APOLLO_API_KEY!,
      },
      body: JSON.stringify(body),
    });
    const searchResult = await searchResponse.json();

    if (!searchResponse.ok) {
      throw new Error(
        `Apollo API error (${searchResponse.status}): ${JSON.stringify(searchResult)}`,
      );
    }

    const rawPeople: Array<Record<string, unknown>> =
      searchResult?.people ?? [];
    const total =
      searchResult?.pagination?.total_entries ??
      searchResult?.total_entries ??
      0;

    if (rawPeople.length === 0) {
      return { candidates: [], total, scrollToken: null, queryText, notes };
    }

    // Enrichment step: de-obfuscate the names/locations Harsha approved
    // spending credits on. Best-effort -- if this call fails for any
    // reason, fall back to the obfuscated search results rather than
    // failing the whole search (the recruiter still sees SOMETHING, same
    // "never fail the whole search over a quality add-on" principle used
    // for Voyage scoring and title expansion above).
    let enriched: Array<Record<string, unknown>> = rawPeople;
    try {
      const ids = rawPeople
        .map((p) => p.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      const bulkResponse = await fetch(APOLLO_BULK_MATCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": APOLLO_API_KEY!,
        },
        body: JSON.stringify({ details: ids.map((id) => ({ id })) }),
      });
      const bulkResult = await bulkResponse.json();
      if (bulkResponse.ok) {
        const matches: Array<Record<string, unknown>> =
          bulkResult?.matches ?? bulkResult?.people ?? [];
        if (matches.length > 0) {
          enriched = matches;
        } else {
          notes.push(
            "Apollo enrichment returned no matches -- showing obfuscated search results instead.",
          );
        }
      } else {
        notes.push(
          "Apollo enrichment call failed -- showing obfuscated search results instead (names/locations masked).",
        );
      }
    } catch (error) {
      console.error("Apollo bulk_match enrichment failed (non-fatal)", error);
      notes.push(
        "Apollo enrichment call failed -- showing obfuscated search results instead (names/locations masked).",
      );
    }

    return {
      candidates: enriched.map(normalizeApolloCandidate),
      total,
      // Apollo paginates with a plain page number, not an opaque token --
      // encode the next page as our own token so "search wider" can reuse
      // the resume-search-position plumbing already built for PDL.
      scrollToken: rawPeople.length > 0 ? JSON.stringify({ page: 2 }) : null,
      queryText,
      notes,
    };
  },
};

// Coresignal provider (taxonomy/boolean-logic test, Multi-source Employee
// API tier -- see header note for why Multi-source over Base).
//
// Query redesign (post-native-UI test): the v1 version of this query
// returned ZERO candidates for every real role brief tested, despite
// Coresignal's own AI-chat "Data search" tool proving thousands of real
// matches exist for the identical title+location combination. Root cause,
// confirmed directly against Coresignal's PUBLISHED Elasticsearch mapping
// (docs.coresignal.com/employee-api/multi-source-employee-api/
// elasticsearch-dsl -- the actual index schema, not a guess): the v1 query
// filtered on `experience.is_current`, a field that DOES NOT EXIST anywhere
// in Coresignal's real schema. The nested `experience` array's boolean flag
// for "this is the person's current position" is actually named
// `experience.active_experience` (byte, 1/0). Querying a field the index
// doesn't have doesn't error in Elasticsearch -- it just silently matches
// nothing -- and since that clause sat inside the outer `bool.must` array,
// one permanently-empty clause zeroed out every search regardless of how
// good the rest of the query was. That's the whole bug.
//
// Fixing the typo alone would have been enough to stop returning zero, but
// Harsha's instruction after seeing the native-UI results was explicit:
// think deeper than a one-line fix, and design the query logic properly.
// Two real design problems existed beyond the typo, both confirmed against
// the same published schema:
//   1. Location was being queried through a `nested` clause on
//      `experience.location` for no real reason -- Coresignal's schema also
//      has flat, ROOT-level `location_city` / `location_full` fields
//      (same level as `active_experience_title`), which is both simpler and
//      more robust: no nested-query/mapping mismatch is possible against a
//      flat field. Switched to those.
//   2. The v1 query used only the SINGLE top-listed required skill as an
//      exact-phrase "must" filter, and separately used the seniority enum
//      (`active_experience_management_level`) as a second independent hard
//      "must" filter. Stacking multiple all-or-nothing hard filters is
//      exactly the failure mode the native-UI test surfaced firsthand:
//      title+location alone returned 127,619 matches (useless, too broad),
//      while adding several fully-required constraints in one shot risks
//      overcorrecting to zero again -- the same shape of bug as the typo,
//      just from over-filtering instead of a wrong field name. The
//      native-UI test that actually worked well (14 precise, genuinely
//      relevant matches: Nike, Gap, Maersk, DSV, Wayfair) combined title +
//      location + experience threshold + a few named skills + industry all
//      at once, but as a single well-specified natural-language ask, not as
//      independent brittle AND filters.
//
// The design below reproduces that same combination but splits it into two
// honest tiers instead of one flat AND, matching how a recruiter actually
// weighs these signals:
//   - HARD filters (a candidate must satisfy ALL of these to appear at
//     all): title (one of the expanded variants), location, and a
//     MAJORITY (not all) of the top few required skills. Majority-not-all
//     avoids the v1 problem in the other direction PDL already hit (see the
//     candidate-narrowing header note above buildPdlQuery) -- requiring
//     every one of 10 listed skills is unrealistic tagging completeness to
//     expect from any real profile.
//   - A real range filter on `total_experience_duration_months` (confirmed
//     field, root-level, populated in months) when the role brief has
//     years_experience_min set. This is new capability v1 didn't have at
//     all, and it's a materially better seniority proxy than the enum
//     below: Coresignal's own AI-chat tool used exactly this field
//     ("60+ months") to represent "5+ years experience" in the native-UI
//     test that worked, not a management-level bucket.
//   - SOFT signals (influence ranking via Elasticsearch score, never
//     exclude a candidate outright): industry (nested on `experience`,
//     using the CORRECT `experience.active_experience` field this time,
//     matched against `experience.company_industry`) and seniority
//     (`active_experience_management_level`) both move here rather than
//     being hard filters -- industry-taxonomy correspondence isn't exact
//     enough to safely exclude on, and total-experience-months is now the
//     primary seniority signal, so the enum becomes a tie-breaker instead
//     of a second independent gate that could zero out results again.
//     Nice-to-have keywords are also folded in here as light score boosts.
//   - Past-position search fix (2026-07-22 session): a NEW soft signal,
//     also nested on `experience` but deliberately WITHOUT the
//     active_experience:1 restriction the current-employer/current-title
//     clauses above use -- "previously at Microsoft" means ANY entry in
//     the candidate's work history, not specifically their current job.
//     Live-verified against Coresignal's own query assistant (see
//     AGENT_H_HANDOFF_2026-07-21.md, Query 2): "currently at
//     Google/Meta/..., previously at Microsoft" resolved to a genuine
//     two-nested-clause structure and returned 2 real matches -- the
//     company-name half of this is high confidence. The title half
//     (pastTitles, field `experience.position_title`) is confirmed directly
//     against Coresignal's own Multi-source Employee API data dictionary
//     (fetched 2026-07-22) rather than guessed -- see the note pushed below.
const CORESIGNAL_TOP_SKILLS_COUNT = 4;
const CORESIGNAL_TOP_SKILLS_MAJORITY_FRACTION = 0.6;
const CORESIGNAL_NICE_TO_HAVE_BOOST_COUNT = 5;

// A single required skill can be a compound string ("AWS/Azure/GCP",
// "Hibernate/JPA") -- same real-world JD-authoring pattern PDL's query
// builder already has to handle (see buildPdlQuery). Splits on "/" into an
// OR-group (matching any one variant counts as satisfying that skill)
// rather than requiring the literal, never-real compound phrase.
function buildCoresignalSkillClause(skill: string): Record<string, unknown> {
  const variants = skill
    .split("/")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (variants.length > 1) {
    return {
      bool: {
        should: variants.map((v) => ({
          match: { inferred_skills: { query: v, operator: "and" } },
        })),
        minimum_should_match: 1,
      },
    };
  }
  return { match: { inferred_skills: { query: skill, operator: "and" } } };
}

// Total-match-count fix: a single cheap call to the main search endpoint
// with items_per_page=1 (the minimum Coresignal allows), sent purely to read
// the x-total-results response header -- confirmed directly against
// Coresignal's docs to be present on this endpoint (unlike the preview
// endpoint, which documents no total-count field at all). Same query body
// the preview call already built, so the total reflects the exact same
// filters the recruiter is seeing results for. Best-effort: any failure
// (network, auth, unexpected header shape) just means the total is left
// unknown for this call -- it must never block the actual preview results,
// which is the part recruiters are directly waiting on.
async function fetchCoresignalTotal(
  query: Record<string, unknown>,
): Promise<number | null> {
  try {
    const response = await fetch(`${CORESIGNAL_SEARCH_URL}?items_per_page=1`, {
      method: "POST",
      headers: {
        accept: "application/json",
        apikey: CORESIGNAL_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(query),
    });
    if (!response.ok) return null;
    // Consume the body even though we only need the header -- some runtimes
    // otherwise log a warning about an unread response body.
    await response.text();
    const totalHeader = response.headers.get("x-total-results");
    if (!totalHeader) return null;
    const parsed = Number(totalHeader);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (error) {
    console.error("fetchCoresignalTotal failed (non-fatal)", error);
    return null;
  }
}

const _coresignalProvider: DiscoveryProvider = {
  name: "coresignal",
  isConfigured: () => Boolean(CORESIGNAL_API_KEY),
  async search(criteria, options) {
    const must: Record<string, unknown>[] = [];
    const filter: Record<string, unknown>[] = [];
    const should: Record<string, unknown>[] = [];
    const notes: string[] = [];

    // --- Hard filter: title (unchanged from v1 -- active_experience_title
    // is a real root-level flat field, this part was never the bug) ---
    if (criteria.titles && criteria.titles.length > 0) {
      if (criteria.titles.length === 1) {
        must.push({
          match: {
            active_experience_title: {
              query: criteria.titles[0],
              operator: "and",
            },
          },
        });
      } else {
        must.push({
          bool: {
            should: criteria.titles.map((t) => ({
              match: { active_experience_title: { query: t, operator: "and" } },
            })),
            minimum_should_match: 1,
          },
        });
        notes.push(
          `Searching ${criteria.titles.length} equivalent titles: ${criteria.titles.join(", ")}.`,
        );
      }
    } else {
      notes.push(
        "No role title on this role brief -- title not used in the query.",
      );
    }

    // --- Hard filter: location, fixed to use flat root-level fields ---
    if (criteria.location && !REMOTE_PATTERN.test(criteria.location)) {
      const city = criteria.location.split(",")[0].trim();
      must.push({
        bool: {
          should: [
            { match: { location_city: { query: city, operator: "and" } } },
            { match: { location_full: { query: city, operator: "and" } } },
          ],
          minimum_should_match: 1,
        },
      });
      notes.push(
        `Requiring location "${city}" (matched against Coresignal's flat location_city/location_full fields -- fixed from a bug where the query filtered on a nested "experience.is_current" field that doesn't exist in Coresignal's real schema, which silently zeroed out every search).`,
      );
    } else if (criteria.location) {
      notes.push(
        "Role marked remote/location-flexible -- no location constraint applied.",
      );
    }
    // --- Hard filter: majority of the top required skills, not all of
    // them and not just one -- see header comment for why. ---
    //
    // Agent H fix (2026-07-17, small-N ceiling bug): Math.ceil rounds the
    // 60% majority UP to "all of them" whenever only 1-2 required skills
    // exist on the role brief -- e.g. Math.ceil(2 * 0.6) = 2, i.e. BOTH of
    // 2 skills required, even though the surrounding comment (and the v1
    // postmortem it documents) explicitly says this filter must never
    // degrade into requiring every skill. Root-caused against role brief
    // #5 ("QA Tester", required_skills = ["QA Testing", "Speech to Text
    // testing"]): with only 2 skills, minimumMatch computed to 2, and
    // "Speech to Text testing" is an odd compound domain phrase unlikely to
    // appear verbatim in Coresignal's inferred_skills tagging -- so every
    // candidate missing that exact tag was hard-excluded, collapsing the
    // result set to 2 candidates. Confirmed via the cached query on that
    // role brief (role_brief_last_scroll_query), not a guess -- and
    // confirmed as the actual narrowing cause by contrast with Harsha's own
    // manual LinkedIn boolean search (same title/location, no experience
    // filter, OR-based across skill synonyms) returning many results for
    // the identical role. No Coresignal credits were spent diagnosing this;
    // it's a pure query-construction bug, visible from the cached query JSON
    // alone.
    //
    // Fix: cap minimumMatch at (topSkills.length - 1) whenever more than one
    // skill is listed, so the filter can never silently become "require
    // all" again regardless of how few skills a role brief happens to have.
    // Only topSkills.length === 1 is exempt (there is no "majority but not
    // all" of a single item -- matching the one listed skill is the only
    // option, same as before this fix).
    if (criteria.requiredSkills && criteria.requiredSkills.length > 0) {
      const topSkills = criteria.requiredSkills.slice(
        0,
        Math.min(CORESIGNAL_TOP_SKILLS_COUNT, criteria.requiredSkills.length),
      );
      let minimumMatch = Math.max(
        1,
        Math.ceil(topSkills.length * CORESIGNAL_TOP_SKILLS_MAJORITY_FRACTION),
      );
      if (topSkills.length > 1) {
        minimumMatch = Math.min(minimumMatch, topSkills.length - 1);
      }
      must.push({
        bool: {
          should: topSkills.map(buildCoresignalSkillClause),
          minimum_should_match: minimumMatch,
        },
      });
      notes.push(
        `Requiring at least ${minimumMatch} of the top ${topSkills.length} required skills to appear in inferred_skills: ${topSkills.join(", ")}.`,
      );
      const remaining = criteria.requiredSkills.slice(topSkills.length);
      if (remaining.length > 0) {
        notes.push(
          `${remaining.length} lower-priority skill(s) not used as a hard filter (${remaining.join(", ")}), but still shape match ranking.`,
        );
      }
    } else {
      notes.push(
        "No required skills on this role brief -- skills not used in the query.",
      );
    }

    // --- Hard filter (range, not a should): total years of experience.
    // Confirmed field, populated in months, root-level.
    //
    // Years-experience-max fix: this used to only ever build a floor (gte),
    // even though years_experience_max has been captured on the role brief
    // since JD intake (parsed by parse-job-description, editable in
    // JdIntakePage.tsx) -- the recruiter's upper bound (e.g. "5-8 years")
    // was silently dropped, so a search for "5-8 years" behaved identically
    // to "5+ years" with no ceiling. Now builds a real range object with
    // both gte and lte set whenever each bound is present, same
    // Elasticsearch range-query shape, just no longer missing the lte half. ---
    // Calibration-loop fix: a learned years_experience_min/max criterion
    // (schema role_brief_learned_criteria) can TIGHTEN this range further
    // than the JD-derived bounds -- never loosen it. Computed here, before
    // the range clause below is built, so it folds into the same single
    // range object rather than adding a second, conflicting one.
    let effectiveYearsMin = criteria.yearsExperienceMin ?? null;
    let effectiveYearsMax = criteria.yearsExperienceMax ?? null;
    if (criteria.learnedCriteria) {
      for (const lc of criteria.learnedCriteria) {
        if (
          lc.criterionType === "years_experience_min" &&
          typeof lc.value.years === "number"
        ) {
          effectiveYearsMin =
            effectiveYearsMin !== null
              ? Math.max(effectiveYearsMin, lc.value.years)
              : lc.value.years;
        }
        if (
          lc.criterionType === "years_experience_max" &&
          typeof lc.value.years === "number"
        ) {
          effectiveYearsMax =
            effectiveYearsMax !== null
              ? Math.min(effectiveYearsMax, lc.value.years)
              : lc.value.years;
        }
      }
    }

    if (
      (effectiveYearsMin && effectiveYearsMin > 0) ||
      (effectiveYearsMax && effectiveYearsMax > 0)
    ) {
      const range: Record<string, number> = {};
      if (effectiveYearsMin && effectiveYearsMin > 0) {
        range.gte = effectiveYearsMin * 12;
      }
      if (effectiveYearsMax && effectiveYearsMax > 0) {
        range.lte = effectiveYearsMax * 12;
      }
      filter.push({ range: { total_experience_duration_months: range } });
      if (range.gte !== undefined && range.lte !== undefined) {
        notes.push(
          `Requiring ${effectiveYearsMin}-${effectiveYearsMax} years (${range.gte}-${range.lte} months) of total experience (total_experience_duration_months).`,
        );
      } else if (range.gte !== undefined) {
        notes.push(
          `Requiring at least ${effectiveYearsMin} years (${range.gte}+ months) of total experience (total_experience_duration_months).`,
        );
      } else {
        notes.push(
          `Requiring at most ${effectiveYearsMax} years (up to ${range.lte} months) of total experience (total_experience_duration_months).`,
        );
      }
    }

    // --- Soft signal: industry. Nested query, using the CORRECT
    // experience.active_experience field this time (see header comment) --
    // deliberately a "should", not a "must": industry-taxonomy
    // correspondence between a role brief's free-text industry and
    // Coresignal's company_industry values isn't exact enough to safely
    // exclude candidates over, only to rank them. ---
    if (criteria.industry) {
      const industryTerms = criteria.industry
        .split(/[/,]/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      for (const term of industryTerms) {
        should.push({
          nested: {
            path: "experience",
            query: {
              bool: {
                must: [
                  { term: { "experience.active_experience": 1 } },
                  { match: { "experience.company_industry": term } },
                ],
              },
            },
          },
        });
      }
      if (industryTerms.length > 0) {
        notes.push(
          `Boosting (not requiring) candidates whose current company's industry matches: ${industryTerms.join(", ")}. This is a ranking signal, not a hard filter, to avoid excluding good candidates over inexact industry-taxonomy matching.`,
        );
      }
    } else {
      notes.push(
        "No industry on this role brief -- industry not used in the query.",
      );
    }

    // --- Soft signal: seniority. Moved from a hard "must" (v1) to a
    // ranking "should" -- total_experience_duration_months above is now the
    // primary, more-reliably-populated seniority proxy; the management_level
    // enum is a tie-breaker on top of it, not a second independent gate that
    // could zero out results the same way the v1 bug did. ---
    if (criteria.seniority) {
      const mapped = SENIORITY_TO_CORESIGNAL_LEVELS[criteria.seniority];
      if (mapped && mapped.length > 0) {
        should.push({
          bool: {
            should: mapped.map((level) => ({
              term: { "active_experience_management_level.exact": level },
            })),
            minimum_should_match: 1,
          },
        });
        notes.push(
          `Boosting seniority level "${criteria.seniority}" (mapped to Coresignal's ${mapped.map((l) => `"${l}"`).join("/")}) as a ranking signal, not a hard filter.`,
        );
      } else {
        notes.push(
          `Seniority "${criteria.seniority}" doesn't have a clean equivalent in Coresignal's own taxonomy -- not used.`,
        );
      }
    } else {
      notes.push(
        "No seniority on this role brief -- seniority not used in the query.",
      );
    }

    // --- Soft signal: nice-to-have keywords, light score boosts only
    // (no operator:"and" -- these are meant to be loose, unlike the hard
    // required-skills filter above). ---
    if (criteria.niceToHaveKeywords && criteria.niceToHaveKeywords.length > 0) {
      const boosted = criteria.niceToHaveKeywords.slice(
        0,
        CORESIGNAL_NICE_TO_HAVE_BOOST_COUNT,
      );
      for (const keyword of boosted) {
        should.push({ match: { inferred_skills: { query: keyword } } });
      }
      notes.push(
        `Boosting ${boosted.length} nice-to-have signal(s) in ranking, not as a hard filter: ${boosted.join(", ")}.`,
      );
    }

    // --- must_not: recruiter-entered hard excludes. The first must_not
    // this query builder has ever needed -- everything above is
    // deliberately a should/soft signal because Coresignal's taxonomy is
    // too coarse to safely exclude on, but a recruiter naming a specific
    // competitor or a specific disqualifying term is precise by
    // definition, not a taxonomy-matching problem, so a hard exclude is
    // the correct (and safer-to-get-wrong-in-this-direction) behavior. ---
    const mustNot: Record<string, unknown>[] = [];

    if (criteria.excludedCompanies && criteria.excludedCompanies.length > 0) {
      for (const company of criteria.excludedCompanies) {
        // Scoped to the candidate's CURRENT employer (active_experience),
        // matching the same nested-path convention as the industry should
        // above -- a recruiter excluding a company almost always means
        // "don't show me people who work there now", not "has ever worked
        // there at any point in their career".
        mustNot.push({
          nested: {
            path: "experience",
            query: {
              bool: {
                must: [
                  { term: { "experience.active_experience": 1 } },
                  { match: { "experience.company_name": company } },
                ],
              },
            },
          },
        });
      }
      notes.push(
        `Excluding candidates currently at: ${criteria.excludedCompanies.join(", ")}.`,
      );
    }

    if (criteria.exclusionKeywords && criteria.exclusionKeywords.length > 0) {
      for (const keyword of criteria.exclusionKeywords) {
        mustNot.push({ match: { inferred_skills: { query: keyword } } });
        mustNot.push({
          match: { active_experience_title: { query: keyword } },
        });
      }
      notes.push(
        `Excluding candidates matching: ${criteria.exclusionKeywords.join(", ")} (checked against skills and current title).`,
      );
    }

    // --- Calibration loop: learned criteria (schema
    // role_brief_learned_criteria), born from a recruiter's calibration
    // feedback and layered on top of everything above. require_keyword/
    // exclude_keyword map onto the same inferred_skills + active_experience_
    // title fields the JD-derived filters above already use; years_
    // experience_min/max were already folded into the range filter above
    // (see effectiveYearsMin/effectiveYearsMax). Only ACTIVE criteria are
    // ever passed in here -- see fetchLearnedCriteria's status filter, and
    // the discoverCandidates handler below which fetches only "active". ---
    if (criteria.learnedCriteria && criteria.learnedCriteria.length > 0) {
      for (const lc of criteria.learnedCriteria) {
        if (lc.criterionType === "require_keyword" && lc.value.keyword) {
          must.push({
            bool: {
              should: [
                {
                  match: {
                    inferred_skills: {
                      query: lc.value.keyword,
                      operator: "and",
                    },
                  },
                },
                {
                  match: {
                    active_experience_title: {
                      query: lc.value.keyword,
                      operator: "and",
                    },
                  },
                },
              ],
              minimum_should_match: 1,
            },
          });
        } else if (lc.criterionType === "exclude_keyword" && lc.value.keyword) {
          mustNot.push({
            match: { inferred_skills: { query: lc.value.keyword } },
          });
          mustNot.push({
            match: { active_experience_title: { query: lc.value.keyword } },
          });
        }
        notes.push(
          `Learned criterion applied (from calibration feedback): ${lc.label}`,
        );
      }
    }

    // --- should: company type/size, sourcing-preference soft signals.
    // Same "should, never excludes" treatment as industry above --
    // Coresignal has no dedicated company-type field at all (company_type
    // is matched against company_industry as a best-effort proxy, not a
    // real taxonomy correspondence), and company-size buckets are coarse
    // enough that a recruiter's "50-200" shouldn't zero out a genuinely
    // good 210-person-company candidate. The nested field name
    // (experience.company_employees_count) is taken from Coresignal's
    // flat-filter-endpoint field `experience_company_employees_count_gte/lte`
    // (confirmed via their published Base Employee API docs) using the same
    // "strip the experience_ prefix, use dot notation" convention already
    // confirmed working for experience.company_industry -- NOT yet
    // confirmed against a real Coresignal response for this specific field,
    // same disclosed-gap treatment as the preview-endpoint response shape
    // note below. ---
    if (criteria.companyType) {
      should.push({
        nested: {
          path: "experience",
          query: {
            bool: {
              must: [
                { term: { "experience.active_experience": 1 } },
                {
                  match: {
                    "experience.company_industry": criteria.companyType,
                  },
                },
              ],
            },
          },
        },
      });
      notes.push(
        `Boosting (not requiring) candidates whose current company looks like "${criteria.companyType}" -- Coresignal has no dedicated company-type field, so this is matched against company_industry as a best-effort proxy.`,
      );
    }

    if (criteria.companySizeMin || criteria.companySizeMax) {
      const range: Record<string, number> = {};
      if (criteria.companySizeMin) range.gte = criteria.companySizeMin;
      if (criteria.companySizeMax) range.lte = criteria.companySizeMax;
      should.push({
        nested: {
          path: "experience",
          query: {
            bool: {
              must: [
                { term: { "experience.active_experience": 1 } },
                { range: { "experience.company_employees_count": range } },
              ],
            },
          },
        },
      });
      notes.push(
        `Boosting (not requiring) candidates whose current company size is ${criteria.companySizeMin ?? "any"}-${criteria.companySizeMax ?? "any"} employees. Field name not yet confirmed against a live Coresignal response -- if this silently has no effect, that's the first thing to check.`,
      );
    }

    // --- Soft signal: past-position search (2026-07-22 session). See the
    // header comment above and the RoleBrief.past_titles/past_companies
    // field comment for the full rationale/verification trail. Deliberately
    // a "should", not a "must" -- same reasoning as industry/companyType
    // above: this describes a work-history preference the recruiter wants
    // BOOSTED, not a hard requirement that could zero out an otherwise
    // great candidate over an incomplete Coresignal history.
    //
    // pastCompanies: CONFIRMED. Matched against the nested
    // `experience.company_name` field, deliberately WITHOUT the
    // `experience.active_experience: 1` restriction the current-employer
    // clauses above use -- "previously at Microsoft" should match ANY
    // entry in the candidate's history, current or past, since Coresignal's
    // nested array doesn't let us cleanly express "this entry AND it's not
    // the active one" without an extra script/range clause not worth the
    // complexity here. Live-verified two-nested-clause pattern: see
    // AGENT_H_HANDOFF_2026-07-21.md, Query 2 ("currently at
    // Google/Meta/..., previously at Microsoft" -- 2 real matches,
    // Coresignal's own query assistant built exactly this shape).
    if (criteria.pastCompanies && criteria.pastCompanies.length > 0) {
      for (const company of criteria.pastCompanies) {
        should.push({
          nested: {
            path: "experience",
            query: {
              bool: {
                must: [{ match: { "experience.company_name": company } }],
              },
            },
          },
        });
      }
      notes.push(
        `Boosting (not requiring) candidates who have worked at: ${criteria.pastCompanies.join(", ")} at any point in their career (matched against Coresignal's nested experience.company_name field, live-verified via Coresignal's own query assistant -- see AGENT_H_HANDOFF_2026-07-21.md).`,
      );
    }

    // pastTitles: CONFIRMED, fixed 2026-07-22 -- the first draft of this
    // clause used `experience.title`, a guessed field name that was never
    // actually checked against Coresignal's own docs. Confirmed directly
    // against Coresignal's published Multi-source Employee API data
    // dictionary (docs.coresignal.com/employee-api/multi-source-employee-api/
    // data-dictionary-multi-source-employee-api, fetched 2026-07-22): the
    // nested `experience` array's real title field is `position_title`
    // (String), alongside `active_experience` (Integer, 1 = current position,
    // 0 = past) -- which is exactly the flag AGENT_H_HANDOFF_2026-07-21.md's
    // Query 1 test relied on when it manually verified a real candidate's
    // `experience` array had a distinct past position ("Founding Engineer",
    // active_experience: 0) separate from their current one ("AI Engineer",
    // active_experience: 1). Same "should, not must" and "no active_experience
    // restriction" reasoning as pastCompanies above -- a past title should
    // match any point in the candidate's history, not just their immediately
    // prior role.
    if (criteria.pastTitles && criteria.pastTitles.length > 0) {
      for (const title of criteria.pastTitles) {
        should.push({
          nested: {
            path: "experience",
            query: {
              bool: {
                must: [
                  {
                    match: {
                      "experience.position_title": {
                        query: title,
                        operator: "and",
                      },
                    },
                  },
                ],
              },
            },
          },
        });
      }
      notes.push(
        `Boosting (not requiring) candidates who have held a title matching: ${criteria.pastTitles.join(", ")} at any point in their career (matched against Coresignal's nested experience.position_title field, confirmed directly against Coresignal's own data dictionary).`,
      );
    }

    if (must.length === 0) {
      throw new DiscoveryConfigError(
        "This role brief doesn't have enough information (title or location) to search Coresignal yet.",
      );
    }

    const bool: Record<string, unknown> = { must };
    if (filter.length > 0) bool.filter = filter;
    if (mustNot.length > 0) bool.must_not = mustNot;
    if (should.length > 0) {
      bool.should = should;
      // Explicit, not relying on ES's implicit default: with "must" present,
      // "should" clauses are optional and score-only -- exactly the "soft
      // signal, never excludes" behavior this design depends on.
      bool.minimum_should_match = 0;
    }

    const query = { query: { bool } };
    const queryText = JSON.stringify(query);
    const page = options.scrollToken
      ? (JSON.parse(options.scrollToken).page ?? 1)
      : 1;

    const response = await fetch(
      `${CORESIGNAL_SEARCH_PREVIEW_URL}?page=${page}`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          apikey: CORESIGNAL_API_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(query),
      },
    );
    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        `Coresignal API error (${response.status}): ${JSON.stringify(result)}`,
      );
    }

    // Defensive parsing: Coresignal's docs show the preview endpoint
    // returning a bare JSON array of records, but this hasn't been
    // confirmed against a real response yet -- also accept a { data: [...] }
    // or { hits: [...] } wrapper rather than assume and break on the first
    // real call.
    const allRawCandidates: Array<Record<string, unknown>> = Array.isArray(
      result,
    )
      ? result
      : (result?.data ?? result?.hits ?? []);

    // Preview-size fix: the preview endpoint's docs only confirm a `page`
    // param -- no documented `items_per_page` equivalent -- and it was
    // observed returning a fixed-size page (e.g. 20) regardless of the
    // recruiter's requested size (e.g. asking for a 3-candidate preview
    // still returned 20). Rather than depend on an undocumented param
    // Coresignal may or may not honor, slice to the requested size here,
    // in code, so the response always matches what was actually asked for.
    // This does mean a non-preview "search wider" continuation only ever
    // advances a full Coresignal page at a time even when size is smaller
    // than that page -- an accepted tradeoff for now (see the
    // resume-search-position comment elsewhere in this file for the
    // general caching approach), not a regression, since previously the
    // full page was shown unsliced regardless of request.
    const rawCandidates = allRawCandidates.slice(0, options.size);

    // Total-match-count fix: a real total for this exact query, from the
    // main search endpoint's x-total-results header (see fetchCoresignalTotal
    // above) -- best-effort, never blocks returning the preview results
    // themselves if it fails or is skipped.
    const totalMatches = await fetchCoresignalTotal(query);

    if (totalMatches !== null) {
      notes.push(
        `${totalMatches} total candidate(s) match this query across Coresignal's full index -- ${rawCandidates.length} shown here.`,
      );
    } else {
      notes.push(
        "Coresignal's preview endpoint doesn't expose a total match count, and the supplementary total-count lookup didn't return one this time -- the number shown is how many candidates are in this response, not the full match count.",
      );
    }

    return {
      candidates: rawCandidates.map(normalizeCoresignalCandidate),
      total: rawCandidates.length,
      totalMatches,
      scrollToken:
        allRawCandidates.length > 0 ? JSON.stringify({ page: page + 1 }) : null,
      queryText,
      notes,
    };
  },
};

// Normalizes a Crustdata /person/search profile into the same common
// candidate shape every other provider normalizes into (see
// normalizeCoresignalCandidate's header comment for why). Field names below
// come from the live-fetched PersonSearch response schema, not guessed --
// note the response's OWN field names sometimes differ from the FILTER dot-
// paths used to query for them (e.g. the filter path is
// "experience.employment_details.current.company_name" but the response
// object's key for that same value is just "name" -- confirmed directly in
// the fetched schema's PersonEmploymentDetails example: { name: "Retool",
// title: "Founder, CEO", ... }).
function normalizeCrustdataCandidate(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const basicProfile = (raw.basic_profile ?? {}) as Record<string, unknown>;
  const experience = (raw.experience ?? {}) as Record<string, unknown>;
  const employmentDetails = (experience.employment_details ?? {}) as Record<
    string,
    unknown
  >;
  const currentPositions = Array.isArray(employmentDetails.current)
    ? (employmentDetails.current as Array<Record<string, unknown>>)
    : [];
  const currentPosition = currentPositions[0] ?? {};

  const location = (basicProfile.location ?? {}) as Record<string, unknown>;
  const locationName =
    typeof location.raw === "string" && location.raw.length > 0
      ? location.raw
      : [location.city, location.state, location.country]
          .filter((v): v is string => typeof v === "string" && v.length > 0)
          .join(", ") || null;

  const socialHandles = (raw.social_handles ?? {}) as Record<string, unknown>;
  const professionalNetworkIdentifier =
    (socialHandles.professional_network_identifier ?? {}) as Record<
      string,
      unknown
    >;
  const rawLinkedinUrl =
    typeof professionalNetworkIdentifier.profile_url === "string"
      ? professionalNetworkIdentifier.profile_url
      : null;

  return {
    id:
      typeof raw.crustdata_person_id === "number" ||
      typeof raw.crustdata_person_id === "string"
        ? String(raw.crustdata_person_id)
        : "",
    full_name: typeof basicProfile.name === "string" ? basicProfile.name : null,
    job_title:
      typeof basicProfile.current_title === "string"
        ? basicProfile.current_title
        : typeof currentPosition.title === "string"
          ? currentPosition.title
          : null,
    job_company_name:
      typeof currentPosition.name === "string" ? currentPosition.name : null,
    location_name: locationName,
    // skills.professional_network_skills isn't part of the default response
    // field set (the "fields" request param would need to explicitly ask
    // for it) -- left empty rather than guessed, same disclosed-gap
    // treatment as normalizeCoresignalCandidate's skills field above.
    skills: [],
    linkedin_url: rawLinkedinUrl
      ? rawLinkedinUrl.replace(/^https?:\/\//i, "")
      : null,
    years_experience: crustdataYearsExperience(raw),
    company_size: crustdataCompanySize(raw),
    _source_vendor: "crustdata",
  };
}

// Crustdata provider. Query construction (mapping DiscoveryCriteria onto
// Crustdata's filter language) lives in crustdataQueryBuilder.ts, kept
// separate from this HTTP-calling code so it can be unit-tested under
// Vitest without needing Deno -- see that file's header comment for the
// full rationale and the confirmed API-shape/gotcha details. This function
// is the thin HTTP wrapper: build filters, call /person/search, normalize
// the response -- same shape as pdlProvider.search/coresignalProvider.search.
const crustdataProvider: DiscoveryProvider = {
  name: "crustdata",
  isConfigured: () => Boolean(CRUSTDATA_API_KEY),
  async search(criteria, options) {
    const searchCriteria: CrustdataSearchCriteria = {
      titles: criteria.titles,
      location: criteria.location,
      requiredSkills: criteria.requiredSkills,
      seniority: criteria.seniority,
      yearsExperienceMin: criteria.yearsExperienceMin,
      yearsExperienceMax: criteria.yearsExperienceMax,
      excludedCompanies: criteria.excludedCompanies,
      exclusionKeywords: criteria.exclusionKeywords,
      pastTitles: criteria.pastTitles,
      pastCompanies: criteria.pastCompanies,
      companySizeMin: criteria.companySizeMin,
      companySizeMax: criteria.companySizeMax,
      learnedCriteria: criteria.learnedCriteria,
    };

    const { filters, notes } = buildCrustdataFilters(searchCriteria, {
      useSeniority: true,
    });

    if (!filters) {
      throw new DiscoveryConfigError(
        "This role brief doesn't have enough information (title or location) to search yet.",
      );
    }

    const queryText = JSON.stringify(filters);

    // "Resume search position" fix, same pattern as executeQuery (PDL) --
    // reuse the cached cursor only when this role brief's last Crustdata
    // query was byte-for-byte the same one that cursor was issued against.
    let cursor: string | undefined = options.scrollToken;
    if (!cursor && !options.isPreview) {
      if (
        options.cachedScrollToken &&
        options.cachedScrollQuery === queryText
      ) {
        cursor = options.cachedScrollToken;
        notes.push(
          "Continuing from where this role brief's search left off last time -- not starting over from the top.",
        );
      }
    }

    const body: Record<string, unknown> = { filters, limit: options.size };
    if (cursor) body.cursor = cursor;

    const response = await fetch(CRUSTDATA_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CRUSTDATA_API_KEY}`,
        "x-api-version": CRUSTDATA_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        `Crustdata API error (${response.status}): ${JSON.stringify(
          result?.error ?? result,
        )}`,
      );
    }

    const profiles: Array<Record<string, unknown>> = result?.profiles ?? [];
    const totalCount: number | null =
      typeof result?.total_count === "number" ? result.total_count : null;

    if (totalCount !== null) {
      notes.push(
        `${totalCount} total candidate(s) match this query across the full index.`,
      );
    }

    return {
      candidates: profiles.map(normalizeCrustdataCandidate),
      total: profiles.length,
      totalMatches: totalCount,
      scrollToken: result?.next_cursor ?? null,
      queryText,
      notes,
    };
  },
};

// Config-driven priority list (architecture doc, Section 2). Order IS
// priority: runDiscovery below tries each configured provider in this order
// and falls through on a genuine vendor failure.
//
// Coresignal-first, as of the 2026-07-11 session (Harsha's explicit call,
// made after a partial PDL-vs-Coresignal side-by-side test -- see
// AGENT_H_HANDOFF_2026-07-11.md for the taxonomy research and test data
// behind this): Coresignal is the primary discovery provider. pdlProvider
// and apolloProvider are DELIBERATELY left out of this list -- their code
// is untouched and still fully functional, so re-enabling either later is a
// one-line change (add the provider back into this array), not a rewrite.
//   - pdlProvider: dormant per Harsha's original instruction (real
//     calibration feedback that PDL profiles run stale). Kept as free
//     optionality if a specific role brief's Coresignal coverage ever
//     turns out thin.
//   - apolloProvider: not used for discovery at all going forward --
//     confirmed no real structured skills field (see the taxonomy header
//     comment above), plus its People Search call has an open, undiagnosed
//     502 bug. Reserved instead for a later, separate contact-enrichment
//     step on candidates already found via Coresignal (task #27).
//   - crustdataProvider: sole ACTIVE discovery provider as of Phase 1 vendor
//     consolidation (2026-07-25, ADR-unipile-linkedin-outreach). Listed
//     alone in DISCOVERY_PROVIDERS — Coresignal is dormant (code kept).
//     isConfigured() gates on CRUSTDATA_API_KEY being set.
const DISCOVERY_PROVIDERS: DiscoveryProvider[] = [crustdataProvider];

function getPrimaryDiscoveryProvider(): DiscoveryProvider {
  const configured = DISCOVERY_PROVIDERS.filter((p) => p.isConfigured());
  if (configured.length === 0) {
    throw new Error(
      "No discovery provider is configured for this project. Add CRUSTDATA_API_KEY under Project Settings > Edge Functions > Secrets.",
    );
  }
  return configured[0];
}

// Tries each configured provider in priority order. A provider that isn't
// configured (no API key set) is skipped silently, not counted as a
// failure. A genuine vendor error (network, auth, rate limit) is logged and
// the next provider is tried; a DiscoveryConfigError (the role brief itself
// doesn't have enough information) is NOT retried against the next
// provider, since a different vendor would fail on the same missing data.
async function runDiscovery(
  criteria: DiscoveryCriteria,
  options: DiscoverySearchOptions,
  // Taxonomy/boolean-logic test addition: an optional forced provider name
  // (e.g. "apollo" or "coresignal"), so the same role brief can be run
  // against ONE specific vendor on demand for a real side-by-side
  // comparison, bypassing the normal priority-fallback behavior. Not sent
  // by the frontend today -- exists for the comparative test itself (and
  // any future "let the recruiter pick a vendor" feature).
  preferredProvider?: string,
): Promise<{ result: DiscoverySearchResult; providerName: string }> {
  const configured = DISCOVERY_PROVIDERS.filter((p) => p.isConfigured());
  if (configured.length === 0) {
    throw new Error(
      "No discovery provider is configured for this project. Add CRUSTDATA_API_KEY under Project Settings > Edge Functions > Secrets (Coresignal/Apollo/PDL are dormant for discovery — see DISCOVERY_PROVIDERS).",
    );
  }

  if (preferredProvider) {
    const forced = configured.find((p) => p.name === preferredProvider);
    if (!forced) {
      throw new DiscoveryConfigError(
        `Requested provider "${preferredProvider}" is not configured for this project.`,
      );
    }
    const result = await forced.search(criteria, options);
    return { result, providerName: forced.name };
  }

  let lastError: unknown;
  for (const provider of configured) {
    try {
      const result = await provider.search(criteria, options);
      return { result, providerName: provider.name };
    } catch (error) {
      if (error instanceof DiscoveryConfigError) throw error;
      console.error(
        `discovery provider "${provider.name}" failed, trying next configured provider`,
        error,
      );
      lastError = error;
    }
  }
  throw lastError ?? new Error("All discovery providers failed");
}

// Calibration loop (2026-07-17): converts a recruiter's "not a fit" reason
// into ZERO OR ONE structured, checkable search criterion (see
// LearnedCriterion above), via the same forced-tool-use Claude pattern as
// parse-job-description and expandTitle. If Claude decides the reason
// doesn't map onto one of the four supported criterion kinds, this returns
// { applicable: false } rather than guessing -- an unmappable reason stays
// exactly what it always was (a candidate_calibration_feedback row, still
// fully visible for reference), it just doesn't ALSO become a query
// criterion.
//
// Also computes the "blast radius" Noon-style: how many candidates this
// role brief's CURRENT search (base JD fields + already-active learned
// criteria) would newly exclude if this criterion were added, using two
// cheap size=1/preview Coresignal calls (the exact same coresignalProvider
// .search path the real search uses, just reused directly rather than
// duplicated) -- so previewing the impact of a criterion costs about the
// same as one search preview, before the recruiter commits to anything.
//
// X-ray match-evidence fix (2026-07-22): when a candidate being rejected
// was surfaced via an X-ray search rather than a normal Coresignal search,
// the frontend already threads that candidate's `_match_evidence` string
// (the platform's own explanation of why it considered this an X-ray match)
// through as `match_evidence` on this endpoint's request body -- but until
// now this handler never read it, so Claude was deciding "does this reason
// imply a checkable criterion?" from the recruiter's raw rejection text
// ALONE, with no visibility into what the system itself thought made this
// candidate a match in the first place. That context matters here: a
// rejection reason like "not actually a match on the thing it flagged" only
// makes sense to a human (or an LLM) that also sees what the platform
// flagged. Optional and best-effort by construction -- omitted entirely
// (empty string) whenever the candidate didn't come from an X-ray search,
// in which case the prompt looks exactly like it did before this fix.
async function handleCalibrationContextualize(
  body: any,
  authHeader: string,
): Promise<Response> {
  const dealId = body?.deal_id;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const matchEvidence =
    typeof body?.match_evidence === "string" ? body.match_evidence.trim() : "";

  if (!dealId || typeof dealId !== "number") {
    return jsonResponse({ error: "deal_id is required" }, 400);
  }
  if (!reason) {
    return jsonResponse({ error: "reason is required" }, 400);
  }
  if (!ANTHROPIC_API_KEY) {
    return jsonResponse(
      {
        error:
          "ANTHROPIC_API_KEY is not set for this project -- required to contextualize calibration feedback.",
      },
      500,
    );
  }
  if (!crustdataProvider.isConfigured()) {
    return jsonResponse(
      {
        error:
          "CRUSTDATA_API_KEY is not set for this project -- required to preview a learned criterion's impact.",
      },
      500,
    );
  }

  const roleBrief = await fetchRoleBrief(dealId, authHeader);
  if (!roleBrief) {
    return jsonResponse(
      { error: "Role brief not found (or you don't have access to it)" },
      404,
    );
  }

  const SUGGEST_TOOL = {
    name: "suggest_criterion",
    description:
      "Decide whether a recruiter's 'not a fit' reason for rejecting a candidate implies a concrete, checkable search criterion, and if so, express it in a small fixed vocabulary.",
    input_schema: {
      type: "object",
      properties: {
        applicable: {
          type: "boolean",
          description:
            "True only if the reason clearly implies one concrete, checkable requirement in one of the four supported kinds below. False if the reason is vague, subjective, or doesn't map onto any of them (e.g. 'didn't seem excited about the role', 'gut feeling wasn't right') -- do not force a fit onto a kind that doesn't really apply.",
        },
        criterion_type: {
          type: ["string", "null"],
          description:
            "One of: require_keyword, exclude_keyword, years_experience_min, years_experience_max. Null if applicable is false.",
        },
        keyword: {
          type: ["string", "null"],
          description:
            "A short skill/technology/keyword phrase, required for require_keyword or exclude_keyword. Null otherwise.",
        },
        years: {
          type: ["integer", "null"],
          description:
            "A whole number of years, required for years_experience_min or years_experience_max. Null otherwise.",
        },
        label: {
          type: ["string", "null"],
          description:
            "A single formal sentence stating the criterion, e.g. 'Must have between 4 and 8 years of experience in software or machine learning engineering.' or 'Must not be missing hands-on production deployment experience.' Null if applicable is false.",
        },
      },
      required: ["applicable"],
    },
  };

  const roleContext = [
    roleBrief.name ? `Role: ${roleBrief.name}` : null,
    roleBrief.years_experience_min || roleBrief.years_experience_max
      ? `Current years-of-experience range: ${roleBrief.years_experience_min ?? "any"}-${roleBrief.years_experience_max ?? "any"}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  // X-ray match-evidence fix (2026-07-22): appended to the prompt, never
  // substituted for the recruiter's own reason -- the reason is still the
  // thing being interpreted, this is just additional context for
  // interpreting it correctly. Empty string (not sent, or the candidate
  // wasn't from an X-ray search) collapses to "" so the prompt is byte-for-
  // byte identical to the pre-fix version in that case.
  const matchEvidenceContext = matchEvidence
    ? `\n\nFor context, this candidate was originally surfaced via an X-ray search, and the platform's own explanation for why it considered them a match was:\n"${matchEvidence}"`
    : "";

  let suggestion: any;
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 512,
        tools: [SUGGEST_TOOL],
        tool_choice: { type: "tool", name: "suggest_criterion" },
        messages: [
          {
            role: "user",
            content: `${roleContext}${matchEvidenceContext}\n\nA recruiter marked a candidate "not a fit" for this role and gave this reason:\n"${reason}"\n\nDecide whether this reason implies a concrete, checkable search criterion.`,
          },
        ],
      }),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
    }
    const result = await response.json();
    const toolUseBlock = result?.content?.find(
      (b: any) => b.type === "tool_use",
    );
    suggestion = toolUseBlock?.input;
  } catch (error) {
    console.error("calibration contextualize (Claude call) failed", error);
    return jsonResponse(
      { error: "Failed to interpret the rejection reason" },
      502,
    );
  }

  if (!suggestion?.applicable) {
    return jsonResponse({ applicable: false });
  }

  const criterionType = suggestion.criterion_type as
    | LearnedCriterion["criterionType"]
    | undefined;
  const validTypes = [
    "require_keyword",
    "exclude_keyword",
    "years_experience_min",
    "years_experience_max",
  ];
  if (
    !criterionType ||
    !validTypes.includes(criterionType) ||
    !suggestion.label
  ) {
    return jsonResponse({ applicable: false });
  }

  const value: LearnedCriterion["value"] = {};
  if (
    criterionType === "require_keyword" ||
    criterionType === "exclude_keyword"
  ) {
    if (typeof suggestion.keyword !== "string" || !suggestion.keyword.trim()) {
      return jsonResponse({ applicable: false });
    }
    value.keyword = suggestion.keyword.trim();
  } else {
    if (typeof suggestion.years !== "number" || suggestion.years <= 0) {
      return jsonResponse({ applicable: false });
    }
    value.years = Math.round(suggestion.years);
  }

  // Blast-radius preview: build the SAME criteria this role brief's real
  // searches use (title expansion + already-active learned criteria), then
  // compare a "before" total against an "after" total with the candidate
  // criterion added on top -- never persisted unless the recruiter clicks
  // Apply.
  let expandedTitles: string[] = roleBrief.name ? [roleBrief.name] : [];
  try {
    expandedTitles = await getOrExpandTitles(roleBrief, authHeader);
  } catch (error) {
    console.error(
      "title expansion failed during calibration preview (non-fatal)",
      error,
    );
  }

  let activeLearnedCriteria: LearnedCriterion[] = [];
  try {
    activeLearnedCriteria = await fetchLearnedCriteria(
      dealId,
      authHeader,
      "active",
    );
  } catch (error) {
    console.error(
      "fetchLearnedCriteria failed during calibration preview (non-fatal)",
      error,
    );
  }

  const baseCriteria: DiscoveryCriteria = {
    titles: expandedTitles,
    location: roleBrief.location,
    requiredSkills: roleBrief.required_skills,
    seniority: roleBrief.seniority,
    yearsExperienceMin: roleBrief.years_experience_min,
    yearsExperienceMax: roleBrief.years_experience_max,
    industry: roleBrief.industry,
    niceToHaveKeywords: roleBrief.nice_to_have_keywords,
    excludedCompanies: roleBrief.excluded_companies,
    exclusionKeywords: roleBrief.exclusion_keywords,
    companyType: roleBrief.company_type,
    companySizeMin: roleBrief.company_size_min,
    companySizeMax: roleBrief.company_size_max,
    pastTitles: roleBrief.past_titles,
    pastCompanies: roleBrief.past_companies,
    learnedCriteria:
      activeLearnedCriteria.length > 0 ? activeLearnedCriteria : null,
  };

  const candidateCriterion: LearnedCriterion = {
    id: -1,
    criterionType,
    value,
    label: suggestion.label,
    status: "active",
    lastRejectCount: null,
    lastRejectCountComputedAt: null,
  };

  const afterCriteria: DiscoveryCriteria = {
    ...baseCriteria,
    learnedCriteria: [
      ...(baseCriteria.learnedCriteria ?? []),
      candidateCriterion,
    ],
  };

  let currentTotal: number | null = null;
  let projectedTotal: number | null = null;
  try {
    const previewOptions: DiscoverySearchOptions = {
      size: 1,
      isPreview: true,
      cachedScrollToken: null,
      cachedScrollQuery: null,
    };
    const [beforeResult, afterResult] = await Promise.all([
      getPrimaryDiscoveryProvider().search(baseCriteria, previewOptions),
      getPrimaryDiscoveryProvider().search(afterCriteria, previewOptions),
    ]);
    currentTotal = beforeResult.totalMatches ?? null;
    projectedTotal = afterResult.totalMatches ?? null;
  } catch (error) {
    console.error("blast-radius preview failed (non-fatal)", error);
  }

  const rejectedCount =
    currentTotal !== null && projectedTotal !== null
      ? Math.max(0, currentTotal - projectedTotal)
      : null;

  return jsonResponse({
    applicable: true,
    criterion: {
      criterion_type: criterionType,
      value,
      label: suggestion.label,
    },
    current_total: currentTotal,
    projected_total: projectedTotal,
    rejected_count: rejectedCount,
  });
}

// Calibration loop: Control Panel data -- for a role brief, returns the
// current total (base JD fields + all ACTIVE learned criteria) plus, for
// EVERY learned criterion (active or relaxed), how many candidates it is
// currently costing (if active) or would newly exclude if reapplied (if
// relaxed) -- Noon's "N rejected" per rule, with Relax/Reapply symmetry.
// Same size=1/preview Coresignal calls as the blast-radius preview above --
// cheap, but genuinely N+1 calls (one baseline plus one per criterion),
// accepted for v1 given a role brief will typically only accumulate a
// handful of these.
//
// Credit-burn fix (2026-07-22): the "N+1 calls, accepted for v1" tradeoff
// above stopped being a safe accepted tradeoff once role briefs started
// accumulating a real double-digit number of learned criteria -- this
// handler is called from SourceCandidatesPage.tsx's Control Panel refresh
// button, from useInboxDecisions.ts (up to 6 open deals per Inbox load),
// and from CanvasPage.tsx (on every mount), and every single one of those
// call sites fans this same uncapped Promise.all out over EVERY criterion,
// active AND relaxed, with zero caching -- one Inbox load could legitimately
// burn 15-21+ live Coresignal credits before a recruiter did anything at
// all. (All three frontend call sites are disabled client-side as an
// emergency kill switch while this fix ships -- not this function's
// concern, but the reason this fix can't just be "add a note", the
// uncapped fan-out itself has to stop.) Two changes below, both scoped to
// this function and its two helpers (fetchLearnedCriteria, LearnedCriterion):
//   1. CRITERIA_IMPACT_PRICING_CAP -- price at most this many criteria with
//      a LIVE Coresignal call per request, not the whole list.
//   2. CRITERIA_IMPACT_CACHE_TTL_MS -- even for a priced criterion, reuse
//      last_reject_count when it was computed inside the TTL window rather
//      than always re-pricing it.
// See the two constants and the per-criterion loop below for exactly how.

// How many learned criteria get a LIVE Coresignal reprice on a single
// handleCriteriaImpact call. Deliberately in the 5-8 range this fix's
// design discussion settled on: high enough that a role brief with a
// normal, healthy number of active calibration rules (most role briefs
// tested so far have 2-4) never even notices the cap, low enough that the
// worst case (a role brief that has accumulated dozens of criteria over a
// long-running search) can no longer burn double-digit credits from one
// page load or one button click. 6 specifically: the midpoint of that
// range, not tuned against real usage data yet -- the first thing to
// revisit if this turns out too tight (criteria feel stale) or too loose
// (credits still climb faster than expected).
const CRITERIA_IMPACT_PRICING_CAP = 6;

// Cache lifetime for a criterion's last_reject_count before it's considered
// stale enough to warrant a fresh live Coresignal call. 1 hour: long enough
// that the normal "recruiter refreshes the Control Panel a few times while
// reviewing the same role brief in one sitting" pattern (and the repeated
// Inbox/Canvas mounts that motivated this fix in the first place) mostly
// hits the cache instead of re-pricing every criterion every time, short
// enough that the displayed "N rejected" number still reflects Coresignal's
// index reasonably closely -- this isn't data that needs to be real-time,
// a rejected-count that's up to an hour stale is a perfectly fine tradeoff
// against burning a live credit on every single load.
const CRITERIA_IMPACT_CACHE_TTL_MS = 60 * 60 * 1000;

async function handleCriteriaImpact(
  body: any,
  authHeader: string,
): Promise<Response> {
  const dealId = body?.deal_id;
  if (!dealId || typeof dealId !== "number") {
    return jsonResponse({ error: "deal_id is required" }, 400);
  }
  if (!crustdataProvider.isConfigured()) {
    return jsonResponse(
      {
        error:
          "CRUSTDATA_API_KEY is not set for this project -- required to compute criteria impact.",
      },
      500,
    );
  }

  const roleBrief = await fetchRoleBrief(dealId, authHeader);
  if (!roleBrief) {
    return jsonResponse(
      { error: "Role brief not found (or you don't have access to it)" },
      404,
    );
  }

  let expandedTitles: string[] = roleBrief.name ? [roleBrief.name] : [];
  try {
    expandedTitles = await getOrExpandTitles(roleBrief, authHeader);
  } catch (error) {
    console.error(
      "title expansion failed during criteria impact (non-fatal)",
      error,
    );
  }

  let allCriteria: LearnedCriterion[] = [];
  try {
    allCriteria = await fetchLearnedCriteria(dealId, authHeader);
  } catch (error) {
    console.error("fetchLearnedCriteria failed during criteria impact", error);
    return jsonResponse({ error: "Failed to load learned criteria" }, 502);
  }

  const activeCriteria = allCriteria.filter((c) => c.status === "active");

  // Credit-burn fix: which criteria get a LIVE reprice this request. Most-
  // recently-added first -- fetchLearnedCriteria orders ascending by
  // created_at, so the tail of the array is the newest criteria. Newest
  // criteria are the ones a recruiter is actively calibrating against right
  // now (that's the whole point of the calibration loop: react to the
  // latest feedback), so they're the ones worth spending a live credit to
  // keep fresh; long-settled older criteria are far more likely to already
  // have a recent cached value anyway, and even when they don't, a slightly
  // stale "N rejected" on a rule nobody's actively tuning is a much smaller
  // cost than starving the criterion someone just added of any number at all.
  const pricedIds = new Set(
    allCriteria.slice(-CRITERIA_IMPACT_PRICING_CAP).map((c) => c.id),
  );

  const baseCriteriaFor = (
    learned: LearnedCriterion[] | null,
  ): DiscoveryCriteria => ({
    titles: expandedTitles,
    location: roleBrief.location,
    requiredSkills: roleBrief.required_skills,
    seniority: roleBrief.seniority,
    yearsExperienceMin: roleBrief.years_experience_min,
    yearsExperienceMax: roleBrief.years_experience_max,
    industry: roleBrief.industry,
    niceToHaveKeywords: roleBrief.nice_to_have_keywords,
    excludedCompanies: roleBrief.excluded_companies,
    exclusionKeywords: roleBrief.exclusion_keywords,
    companyType: roleBrief.company_type,
    companySizeMin: roleBrief.company_size_min,
    companySizeMax: roleBrief.company_size_max,
    pastTitles: roleBrief.past_titles,
    pastCompanies: roleBrief.past_companies,
    learnedCriteria: learned && learned.length > 0 ? learned : null,
  });

  const previewOptions: DiscoverySearchOptions = {
    size: 1,
    isPreview: true,
    cachedScrollToken: null,
    cachedScrollQuery: null,
  };

  let baseTotal: number | null = null;
  try {
    const baseResult = await getPrimaryDiscoveryProvider().search(
      baseCriteriaFor(activeCriteria),
      previewOptions,
    );
    baseTotal = baseResult.totalMatches ?? null;
  } catch (error) {
    console.error("criteria impact baseline search failed", error);
    return jsonResponse(
      { error: "Failed to compute current search totals" },
      502,
    );
  }

  const criteriaWithImpact = await Promise.all(
    allCriteria.map(async (criterion) => {
      // Credit-burn fix: cache check, before deciding whether this
      // criterion even gets considered for a live call at all. A cached
      // value counts as fresh (and is reused as-is, no live call, no
      // PATCH) whenever it was computed inside CRITERIA_IMPACT_CACHE_TTL_MS
      // -- regardless of whether this criterion made the pricing-cap cut
      // this request, since a fresh cache entry makes a live call redundant
      // either way.
      const cachedAgeMs = criterion.lastRejectCountComputedAt
        ? Date.now() - new Date(criterion.lastRejectCountComputedAt).getTime()
        : Infinity;
      const hasFreshCache =
        criterion.lastRejectCount !== null &&
        cachedAgeMs < CRITERIA_IMPACT_CACHE_TTL_MS;

      if (hasFreshCache) {
        return {
          id: criterion.id,
          criterion_type: criterion.criterionType,
          label: criterion.label,
          status: criterion.status,
          rejected_count: criterion.lastRejectCount,
        };
      }

      // Credit-burn fix: criteria outside this request's pricing cap (see
      // CRITERIA_IMPACT_PRICING_CAP above) never reach a live Coresignal
      // call at all -- they fall back to whatever was last cached (however
      // stale), or null if this criterion has never been priced yet. This
      // is the actual cap: without a fresh cache hit above AND without
      // being in the priced set, this criterion costs zero credits this
      // request, full stop.
      if (!pricedIds.has(criterion.id)) {
        return {
          id: criterion.id,
          criterion_type: criterion.criterionType,
          label: criterion.label,
          status: criterion.status,
          rejected_count: criterion.lastRejectCount,
        };
      }

      let rejectedCount: number | null = null;
      try {
        if (criterion.status === "active") {
          const without = activeCriteria.filter((c) => c.id !== criterion.id);
          const result = await getPrimaryDiscoveryProvider().search(
            baseCriteriaFor(without),
            previewOptions,
          );
          const totalWithout = result.totalMatches ?? null;
          rejectedCount =
            baseTotal !== null && totalWithout !== null
              ? Math.max(0, totalWithout - baseTotal)
              : null;
        } else {
          const withThis = [...activeCriteria, criterion];
          const result = await getPrimaryDiscoveryProvider().search(
            baseCriteriaFor(withThis),
            previewOptions,
          );
          const totalWithThis = result.totalMatches ?? null;
          rejectedCount =
            baseTotal !== null && totalWithThis !== null
              ? Math.max(0, baseTotal - totalWithThis)
              : null;
        }
      } catch (error) {
        console.error(
          `criteria impact computation failed for criterion ${criterion.id} (non-fatal)`,
          error,
        );
      }

      // Best-effort cache write -- a failed PATCH just means the cached
      // display value on this row goes stale, never blocks the response.
      try {
        await fetch(
          `${SUPABASE_URL}/rest/v1/role_brief_learned_criteria?id=eq.${criterion.id}`,
          {
            method: "PATCH",
            headers: {
              apikey: SUPABASE_ANON_KEY ?? "",
              Authorization: authHeader,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              last_reject_count: rejectedCount,
              last_reject_count_computed_at: new Date().toISOString(),
            }),
          },
        );
      } catch (error) {
        console.error(
          "learned criterion reject-count cache write failed (non-fatal)",
          error,
        );
      }

      return {
        id: criterion.id,
        criterion_type: criterion.criterionType,
        label: criterion.label,
        status: criterion.status,
        rejected_count: rejectedCount,
      };
    }),
  );

  return jsonResponse({
    base_total: baseTotal,
    criteria: criteriaWithImpact,
  });
}

/** Re-fetch a single Crustdata profile by stored person id (cheap restore). */
async function fetchCrustdataPersonById(
  sourceId: string,
): Promise<Record<string, unknown> | null> {
  if (!CRUSTDATA_API_KEY) return null;
  const numericId = Number(sourceId);
  if (!Number.isFinite(numericId)) return null;

  const response = await fetch(CRUSTDATA_SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CRUSTDATA_API_KEY}`,
      "x-api-version": CRUSTDATA_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filters: {
        field: "crustdata_person_id",
        type: "=",
        value: numericId,
      },
      limit: 1,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Crustdata person lookup failed (${response.status}): ${JSON.stringify(
        (result as Record<string, unknown>)?.error ?? result,
      )}`,
    );
  }

  const profiles = (result as Record<string, unknown>)?.profiles as
    | Array<Record<string, unknown>>
    | undefined;
  if (!profiles?.length) return null;
  return normalizeCrustdataCandidate(profiles[0]) as Record<string, unknown>;
}

// Restore candidates from discovery_source_attribution (written on each
// Fetch / Search wider). Does NOT re-run the full role query — one Crustdata
// lookup per stored person id, so you get the same people back without
// paying for a brand-new search.
async function handleRehydrateFromAttribution(
  body: Record<string, unknown>,
  authHeader: string,
): Promise<Response> {
  const dealId = body?.deal_id;
  if (!dealId || typeof dealId !== "number") {
    return jsonResponse({ error: "deal_id is required" }, 400);
  }
  if (!crustdataProvider.isConfigured()) {
    return jsonResponse(
      {
        error:
          "CRUSTDATA_API_KEY is not set for this project -- required to restore search results.",
      },
      500,
    );
  }

  const roleBrief = await fetchRoleBrief(dealId, authHeader);
  if (!roleBrief) {
    return jsonResponse(
      { error: "Role brief not found (or you don't have access to it)" },
      404,
    );
  }

  const nowIso = new Date().toISOString();
  const attrRes = await fetch(
    `${SUPABASE_URL}/rest/v1/discovery_source_attribution?deal_id=eq.${dealId}&expires_at=gt.${encodeURIComponent(nowIso)}&select=source_id,vendor&order=created_at.asc`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY ?? "",
        Authorization: authHeader,
      },
    },
  );
  if (!attrRes.ok) {
    console.error(
      "rehydrate_from_attribution: attribution fetch failed",
      attrRes.status,
      await attrRes.text(),
    );
    return jsonResponse(
      { error: "Failed to load saved search person ids for this role" },
      502,
    );
  }

  const rows = (await attrRes.json()) as Array<{
    source_id: string;
    vendor: string;
  }>;
  if (!rows.length) {
    return jsonResponse(
      {
        error:
          "No recent search results on file for this role. If you refreshed the page, browser session data may be gone — run Fetch candidates again.",
        rehydrated_count: 0,
      },
      404,
    );
  }

  const notes: string[] = [
    `Restored ${rows.length} candidate id(s) from your last discovery search on this role (one Crustdata lookup each, not a new search).`,
  ];
  const candidates: Array<Record<string, unknown>> = [];
  let lookupFailures = 0;
  let skippedVendor = 0;

  for (const row of rows) {
    if (row.vendor !== "crustdata") {
      skippedVendor += 1;
      continue;
    }
    try {
      const person = await fetchCrustdataPersonById(row.source_id);
      if (person) candidates.push(person);
    } catch (error) {
      lookupFailures += 1;
      console.error(
        "rehydrate_from_attribution: person lookup failed",
        row.source_id,
        error,
      );
    }
  }

  if (skippedVendor > 0) {
    notes.push(
      `${skippedVendor} hit(s) from non-Crustdata sources were skipped (restore supports Crustdata fetch results only).`,
    );
  }
  if (lookupFailures > 0) {
    notes.push(
      `${lookupFailures} profile(s) could not be reloaded from Crustdata.`,
    );
  }
  if (candidates.length === 0) {
    return jsonResponse(
      {
        error:
          "Could not reload any profiles from the saved search ids — they may have expired at Crustdata. Run Fetch candidates again.",
        rehydrated_count: 0,
      },
      404,
    );
  }

  try {
    await annotateAlreadySaved(candidates, authHeader);
  } catch (error) {
    console.error("rehydrate annotateAlreadySaved failed (non-fatal)", error);
  }

  if (VOYAGE_API_KEY) {
    try {
      const roleBriefVector = await getOrRefreshRoleBriefEmbedding(
        roleBrief,
        authHeader,
      );
      await scoreAndSortCandidates(candidates, roleBriefVector);
    } catch (error) {
      console.error("rehydrate scoring failed (non-fatal)", error);
      notes.push(
        "Match scoring unavailable for restored profiles — shown in discovery order.",
      );
    }
  }

  return jsonResponse({
    role_brief: {
      id: roleBrief.id,
      title: roleBrief.name,
      location: roleBrief.location,
    },
    query_used: null,
    notes,
    total: candidates.length,
    total_matches_all: null,
    candidates: candidates.map(stripVendorFieldsForClient),
    scroll_token: roleBrief.role_brief_last_scroll_token ?? null,
    rehydrated_count: candidates.length,
  });
}

// Signature note (2026-07-17 calibration-loop change): this used to parse
// its own request body from a raw Request. Deno.serve below now reads the
// JSON body ONCE (a Request body can only be consumed once) and branches on
// `body.mode` before calling any handler -- so this takes the already-
// parsed body object and authHeader directly, same as the two new
// calibration handlers above it.
const discoverCandidates = async (body: any, authHeader: string) => {
  const roleBriefId = body?.role_brief_id;
  let size = DEFAULT_SIZE;
  let scrollToken: string | undefined;
  let isPreview = false;
  // Taxonomy/boolean-logic test addition: an optional forced vendor name
  // ("apollo" | "coresignal") for the side-by-side comparison -- see
  // runDiscovery's preferredProvider param. Omitted entirely by the normal
  // frontend flow, which just gets whichever configured provider comes
  // first in priority order.
  let preferredProvider: string | undefined;
  if (typeof body?.size === "number") {
    size = Math.max(1, Math.min(MAX_SIZE, Math.floor(body.size)));
  }
  // "Search wider": when the client sends back a scroll_token from a
  // previous response, this call fetches the NEXT batch of the same search
  // rather than starting over from the top -- see header comment.
  if (typeof body?.scroll_token === "string" && body.scroll_token) {
    scrollToken = body.scroll_token;
  }
  // "Resume search position" fix: the cheap size=1 probe never reads or
  // writes the last-scroll-position cache below -- it's just a peek at the
  // total count, not a real review of any candidates, so it shouldn't
  // consume or advance the recruiter's actual place in the results.
  isPreview = body?.is_preview === true;
  if (typeof body?.provider === "string" && body.provider) {
    preferredProvider = body.provider;
  }

  if (!roleBriefId || typeof roleBriefId !== "number") {
    return jsonResponse({ error: "role_brief_id is required" }, 400);
  }

  const roleBrief = await fetchRoleBrief(roleBriefId, authHeader);

  if (!roleBrief) {
    return jsonResponse(
      { error: "Role brief not found (or you don't have access to it)" },
      404,
    );
  }

  // Title-expansion fix: best-effort, non-fatal. If this fails for any
  // reason (Claude call error, ANTHROPIC_API_KEY unset), fall back to just
  // the role brief's literal title as a one-item list -- exactly the old
  // behavior -- rather than failing the whole search over a quality
  // improvement.
  let expandedTitles: string[] = roleBrief.name ? [roleBrief.name] : [];
  try {
    expandedTitles = await getOrExpandTitles(roleBrief, authHeader);
  } catch (error) {
    console.error("title expansion failed (non-fatal)", error);
  }

  // Calibration loop: fold in any ACTIVE learned criteria for this role
  // brief so every future search benefits from calibration feedback, not
  // just the one search that produced it. Best-effort -- a failed fetch
  // here just means this search runs without learned criteria applied, same
  // "a feature having a bad moment shouldn't break search" principle as
  // title expansion and scoring elsewhere in this file.
  let activeLearnedCriteria: LearnedCriterion[] = [];
  try {
    activeLearnedCriteria = await fetchLearnedCriteria(
      roleBriefId,
      authHeader,
      "active",
    );
  } catch (error) {
    console.error("fetchLearnedCriteria failed (non-fatal)", error);
  }

  const criteria: DiscoveryCriteria = {
    titles: expandedTitles,
    location: roleBrief.location,
    requiredSkills: roleBrief.required_skills,
    seniority: roleBrief.seniority,
    yearsExperienceMin: roleBrief.years_experience_min,
    yearsExperienceMax: roleBrief.years_experience_max,
    industry: roleBrief.industry,
    niceToHaveKeywords: roleBrief.nice_to_have_keywords,
    excludedCompanies: roleBrief.excluded_companies,
    exclusionKeywords: roleBrief.exclusion_keywords,
    companyType: roleBrief.company_type,
    companySizeMin: roleBrief.company_size_min,
    companySizeMax: roleBrief.company_size_max,
    pastTitles: roleBrief.past_titles,
    pastCompanies: roleBrief.past_companies,
    learnedCriteria:
      activeLearnedCriteria.length > 0 ? activeLearnedCriteria : null,
  };

  let discovery: { result: DiscoverySearchResult; providerName: string };
  try {
    discovery = await runDiscovery(
      criteria,
      {
        size,
        scrollToken,
        isPreview,
        cachedScrollToken: roleBrief.role_brief_last_scroll_token,
        cachedScrollQuery: roleBrief.role_brief_last_scroll_query,
      },
      preferredProvider,
    );
  } catch (error) {
    if (error instanceof DiscoveryConfigError) {
      return jsonResponse({ error: error.message }, 400);
    }
    console.error(
      "source-candidates-discovery: all discovery providers failed",
      error,
    );
    // Root-caused (2026-07-17): this catch was firing for EVERY search, even
    // role briefs with zero learned criteria -- traced via a temporary
    // debug field on this response (since get_logs only returns gateway-
    // level summaries, not console output) to a genuine Coresignal account
    // issue, not a code bug: "Coresignal API error (402): Billing:
    // Insufficient credits". Nothing in the calibration-loop change caused
    // this -- the account simply ran out of Coresignal credits. Surfacing
    // that specific detail here (still generic enough not to leak internals)
    // rather than a flat "Failed to search" so this is diagnosable from the
    // UI next time without needing another debug redeploy.
    const detail =
      error instanceof Error && /insufficient credits/i.test(error.message)
        ? "Coresignal account is out of credits -- add credits/upgrade the plan before searching again."
        : "Failed to search for candidates";
    return jsonResponse({ error: detail }, 502);
  }

  const { result, providerName } = discovery;
  const notes = [...result.notes];
  if (providerName !== DISCOVERY_PROVIDERS[0]?.name) {
    notes.push(
      "Primary search source was unavailable -- results came from a backup source instead.",
    );
  }

  try {
    const candidates = result.candidates;
    await annotateAlreadySaved(candidates, authHeader);

    // Checkpoint 3c: best-effort, non-fatal semantic scoring. If it fails
    // for any reason, the search still returns the discovery provider's
    // results in their original order -- a ranking feature having a bad
    // moment should never take down sourcing entirely.
    if (!VOYAGE_API_KEY) {
      notes.push(
        "Match scoring unavailable: VOYAGE_API_KEY is not set for this project. Candidates shown in the discovery provider's original order.",
      );
    } else {
      try {
        const roleBriefVector = await getOrRefreshRoleBriefEmbedding(
          roleBrief,
          authHeader,
        );
        await scoreAndSortCandidates(candidates, roleBriefVector);
      } catch (error) {
        console.error("checkpoint 3c scoring failed (non-fatal)", error);
        notes.push(
          "Match scoring failed for this search -- candidates shown in the discovery provider's original order.",
        );
      }
    }

    // "Resume search position" fix, write side: remember where this fetch
    // left off (in THIS provider's own query/token terms) so the NEXT plain
    // "Fetch candidates" click continues from here. Skipped for preview
    // calls. Best-effort: if this PATCH fails, the only consequence is the
    // next fresh fetch restarts at the top again, not a broken search.
    // Simplification worth flagging for later: this assumes one active
    // provider at a time -- if a second provider is ever live
    // simultaneously (not just as a failover), this cache would need to be
    // keyed per-provider, not just per-role-brief.
    if (!isPreview) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/deals?id=eq.${roleBrief.id}`, {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_ANON_KEY ?? "",
            Authorization: authHeader,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            role_brief_last_scroll_token: result.scrollToken,
            role_brief_last_scroll_query: result.queryText,
            role_brief_last_scroll_updated_at: new Date().toISOString(),
          }),
        });
      } catch (error) {
        console.error("scroll position cache write failed (non-fatal)", error);
      }
    }

    if (!isPreview) {
      const isContinuation = isDiscoverySearchContinuation({
        scrollToken,
        isPreview,
        cachedScrollQuery: roleBrief.role_brief_last_scroll_query,
        cachedScrollToken: roleBrief.role_brief_last_scroll_token,
        queryText: result.queryText,
      });
      await persistDiscoverySourceAttribution(
        roleBrief.id,
        providerName,
        candidates,
        authHeader,
        isContinuation,
      );
    }

    return jsonResponse({
      role_brief: {
        id: roleBrief.id,
        title: roleBrief.name,
        location: roleBrief.location,
      },
      query_used: result.queryText,
      notes,
      total: result.total,
      // Total-match-count fix: the real total across the whole index when
      // available (Coresignal today; null for providers that don't supply
      // this separately, e.g. PDL, whose `total` field above is already the
      // real total). Distinct from `total`, which is just "how many
      // candidates are in this response".
      total_matches_all: result.totalMatches ?? null,
      candidates: candidates.map(stripVendorFieldsForClient),
      // Null/absent once the provider has nothing further to page into --
      // the frontend uses this to know whether "Search wider" should still
      // be offered.
      scroll_token: result.scrollToken,
    });
  } catch (error) {
    console.error("source-candidates-discovery failed", error);
    return jsonResponse({ error: "Failed to process candidates" }, 500);
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }
  const authError = await requireAuth(req);
  if (authError) return authError;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const authHeader = req.headers.get("authorization")!;

  // Calibration loop (2026-07-17): two new request modes, dispatched before
  // the normal discovery flow -- see handleCalibrationContextualize /
  // handleCriteriaImpact above. Omitting `mode` entirely (the normal
  // frontend discovery flow) falls through to discoverCandidates unchanged.
  if (body?.mode === "calibration_contextualize") {
    return handleCalibrationContextualize(body, authHeader);
  }
  if (body?.mode === "criteria_impact") {
    return handleCriteriaImpact(body, authHeader);
  }
  if (body?.mode === "rehydrate_from_attribution") {
    return handleRehydrateFromAttribution(body, authHeader);
  }

  return discoverCandidates(body, authHeader);
});
