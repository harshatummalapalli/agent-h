// Minimal Crustdata client shared between source-candidates-discovery and
// calibration-session.  Only the subset actually needed for a role-brief
// based candidate search: filter building, HTTP call, normalisation.
//
// The full query-builder (crustdataQueryBuilder.ts in
// source-candidates-discovery/) owns the advanced criteria: learned
// criteria, past titles/companies, company-size bands, seniority term
// mapping, shingle decomposition.  Here we cover the common path:
// title OR (or) title keywords, location, seniority containment,
// required-skill OR-groups and experience-year bounds.
//
// API: POST https://api.crustdata.com/person/search
// Header: Authorization: Bearer <key>, x-api-version: 2025-11-01
// Body: { filters: Condition | Group, limit }

export const CRUSTDATA_SEARCH_URL = "https://api.crustdata.com/person/search";
export const CRUSTDATA_API_VERSION = "2025-11-01";

// ── Field paths (from Crustdata PersonSearchCondition enum) ──────────────

const F = {
  currentTitle: "experience.employment_details.current.title",
  currentSeniority: "experience.employment_details.current.seniority_level",
  locationCity: "basic_profile.location.city",
  locationCountry: "basic_profile.location.country",
  yearsOfExperience: "years_of_experience",
  currentSkills: "skills.professional_network_skills",
} as const;

// ── Country alias map ─────────────────────────────────────────────────────
// Maps common aliases (lowercase) → Crustdata's canonical full country name.
// Used by classifyPlace() to route known countries to the country field with
// an exact "=" match instead of the city contains "(.)".

export const COUNTRY_ALIASES: Record<string, string> = {
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

/**
 * Classify a geographic place as either a Crustdata country filter (exact "=")
 * or a city filter (contains "(.)").  Exported so the discovery query-builder
 * can reuse the same logic without re-implementing the alias map.
 *
 * Examples:
 *   classifyPlace("India")      → { field: locationCountry, type: "=", value: "India" }
 *   classifyPlace("US")         → { field: locationCountry, type: "=", value: "United States" }
 *   classifyPlace("Bangalore")  → { field: locationCity,   type: "(.)"}
 */
export function classifyPlace(place: string): {
  field: string;
  type: "=" | "(.)";
  value: string;
} {
  const canonical = COUNTRY_ALIASES[place.toLowerCase().trim()];
  if (canonical) {
    return { field: F.locationCountry, type: "=", value: canonical };
  }
  return { field: F.locationCity, type: "(.)", value: place };
}

// ── Filter types (minimal subset) ────────────────────────────────────────

type Condition = {
  field: string;
  type: "(.)" | "=>" | "=<" | "in" | "=";
  value: string | number | string[];
};
type Group = { op: "and" | "or"; conditions: Array<Condition | Group> };
type Filters = Condition | Group;

// ── Seniority mapping ────────────────────────────────────────────────────

const SENIORITY_TERMS: Record<string, string | null> = {
  intern: "Intern",
  entry_level: "Junior",
  senior: "Senior",
  staff: "Staff",
  principal: "Principal",
  manager: "Manager",
  director: "Director",
  executive: "VP",
};

// ── Location parsing ─────────────────────────────────────────────────────

// Tokens that, on their own, mean "remote-only" — no geographic place.
const REMOTE_ONLY_RE =
  /^(remote[\s-]*(only|ok|friendly|first|work)?|work\s+remote(ly)?)$/i;

// Tokens to strip before extracting the geographic place.
// Order matters: more specific multi-word phrases must precede bare "remote".
const REMOTE_STRIP_RE =
  /\b(remote\s+people\s+based\s+in|remote[\s-]*(only|ok|friendly|first|work)?|work\s+remote(ly)?|based\s+in|remote)\b[,\s-]*/gi;

/**
 * Split a free-text location into an optional geographic place and a boolean
 * indicating whether "remote" was mentioned.
 *
 * Examples:
 *   "Remote, India"          → { place: "India", remoteOnly: false }
 *   "Remote - India"         → { place: "India", remoteOnly: false }
 *   "India (Remote)"         → { place: "India", remoteOnly: false }
 *   "Hyderabad (India)"      → { place: "Hyderabad, India", remoteOnly: false }
 *   "Remote people based in India" → { place: "India", remoteOnly: false }
 *   "based in India, remote OK"    → { place: "India", remoteOnly: false }
 *   "Remote"                 → { place: null, remoteOnly: true }
 *   "Remote only"            → { place: null, remoteOnly: true }
 *   "Bangalore"              → { place: "Bangalore", remoteOnly: false }
 */
export function parseLocationForFilter(location: string): {
  place: string | null;
  remoteOnly: boolean;
} {
  const trimmed = location.trim();
  if (!trimmed) return { place: null, remoteOnly: false };

  const hasRemote = /remote/i.test(trimmed);

  if (REMOTE_ONLY_RE.test(trimmed)) {
    return { place: null, remoteOnly: true };
  }

  // Normalise parenthetical annotations:
  //   "(Remote)"  → drop (remote marker)
  //   "(India)"   → convert to ", India" so comma-segment country detection works
  //   other parens → drop (unknown annotation, keep result clean)
  const withParenNorm = trimmed.replace(/\(\s*([^)]+)\s*\)/g, (_, inner) => {
    const innerTrim = inner.trim();
    if (/remote/i.test(innerTrim)) return ""; // remote marker — drop
    if (COUNTRY_ALIASES[innerTrim.toLowerCase()]) return `, ${innerTrim}`; // known country — comma form
    return ""; // unknown paren — drop
  });

  const place = withParenNorm
    .replace(REMOTE_STRIP_RE, " ")
    .replace(/[,\s-]+$/, "")
    .replace(/^[,\s-]+/, "")
    .trim();

  return { place: place || null, remoteOnly: hasRemote && !place };
}

// ── Role-brief → filters ─────────────────────────────────────────────────

export type CalibrationRoleBrief = {
  name?: unknown;
  seniority?: unknown;
  location?: unknown;
  required_skills?: unknown;
  must_have_keywords?: unknown;
  years_experience_min?: unknown;
  years_experience_max?: unknown;
};

/** Build Crustdata filters from a role-brief snapshot.  Returns null when
 *  there is not enough information to form a useful query (no title, no
 *  skills). */
export function buildCalibrationFilters(
  brief: CalibrationRoleBrief,
): Filters | null {
  const conditions: Array<Condition | Group> = [];

  // Title: use the role name as a contains match.
  const title = typeof brief.name === "string" ? brief.name.trim() : null;
  if (title) {
    conditions.push({ field: F.currentTitle, type: "(.)", value: title });
  }

  // Location — extract the geographic place even when "remote" is mentioned,
  // then route to country (exact "=") or city (contains "(.)")  so that
  // "India" queries the country field rather than the city field.
  const location =
    typeof brief.location === "string" ? brief.location.trim() : null;
  const { place } = location
    ? parseLocationForFilter(location)
    : { place: null };
  if (place) {
    const classified = classifyPlace(place);
    if (classified.type === "=") {
      // Already a known country — use as-is.
      conditions.push(classified);
    } else {
      // City filter: Crustdata city fields store only the bare city name.
      // Take the first comma-segment so "Hyderabad, India" → "Hyderabad".
      // Optional: if the last comma-segment is a known country, prefer the
      // broader country exact filter (e.g. "Hyderabad, India" → country India).
      const segments = place.split(",").map((s) => s.trim());
      const lastSegment = segments[segments.length - 1].toLowerCase();
      const countryCanonical =
        segments.length > 1 ? COUNTRY_ALIASES[lastSegment] : undefined;
      if (countryCanonical) {
        conditions.push({
          field: F.locationCountry,
          type: "=",
          value: countryCanonical,
        });
      } else {
        conditions.push({
          field: classified.field,
          type: "(.)",
          value: segments[0],
        });
      }
    }
  }

  // Seniority
  const seniority =
    typeof brief.seniority === "string" ? brief.seniority.toLowerCase() : null;
  if (seniority && SENIORITY_TERMS[seniority]) {
    conditions.push({
      field: F.currentSeniority,
      type: "(.)",
      value: SENIORITY_TERMS[seniority]!,
    });
  }

  // Years-of-experience bounds
  const yoeMin =
    typeof brief.years_experience_min === "number"
      ? brief.years_experience_min
      : null;
  const yoeMax =
    typeof brief.years_experience_max === "number"
      ? brief.years_experience_max
      : null;
  if (yoeMin != null) {
    conditions.push({ field: F.yearsOfExperience, type: "=>", value: yoeMin });
  }
  if (yoeMax != null) {
    conditions.push({ field: F.yearsOfExperience, type: "=<", value: yoeMax });
  }

  // Required skills: at least one must appear (OR group)
  const skills = Array.isArray(brief.required_skills)
    ? (brief.required_skills as unknown[])
        .filter(
          (s): s is string => typeof s === "string" && s.trim().length > 0,
        )
        .slice(0, 5)
    : [];
  if (skills.length > 0) {
    const skillConds: Condition[] = skills.map((s) => ({
      field: F.currentSkills,
      type: "(.)",
      value: s.trim(),
    }));
    conditions.push(
      skillConds.length === 1
        ? skillConds[0]
        : { op: "or", conditions: skillConds },
    );
  }

  if (conditions.length === 0) return null;
  if (conditions.length === 1) return conditions[0];
  return { op: "and", conditions };
}

// ── Normalise raw Crustdata profile ──────────────────────────────────────

function numericOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && !Number.isNaN(Number(value)))
    return Number(value);
  return null;
}

function crustdataYearsExperience(raw: Record<string, unknown>): number | null {
  const bp = (raw.basic_profile ?? {}) as Record<string, unknown>;
  return (
    numericOrNull(bp.years_of_experience) ??
    numericOrNull(raw.years_of_experience)
  );
}

export type RawCalibrationCandidate = {
  id: string;
  full_name: string | null;
  job_title: string | null;
  job_company_name: string | null;
  location_name: string | null;
  skills: string[];
  linkedin_url: string | null;
  years_experience: number | null;
  _source_vendor: "crustdata";
};

export function normalizeCrustdataProfile(
  raw: Record<string, unknown>,
): RawCalibrationCandidate {
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
  const pni = (socialHandles.professional_network_identifier ?? {}) as Record<
    string,
    unknown
  >;
  // Prefer social_handles.professional_network_identifier.profile_url; fall
  // back to pni.public_identifier slug, then any top-level linkedin_url field.
  const rawLinkedin =
    (typeof pni.profile_url === "string" && pni.profile_url
      ? pni.profile_url
      : null) ??
    (typeof pni.public_identifier === "string" && pni.public_identifier
      ? `linkedin.com/in/${pni.public_identifier}`
      : null) ??
    (typeof raw.linkedin_url === "string" ? raw.linkedin_url : null);

  const personId =
    typeof raw.crustdata_person_id === "number" ||
    typeof raw.crustdata_person_id === "string"
      ? String(raw.crustdata_person_id)
      : "";

  return {
    id: personId,
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
    skills: [],
    linkedin_url: rawLinkedin ? rawLinkedin.replace(/^https?:\/\//i, "") : null,
    years_experience: crustdataYearsExperience(raw),
    _source_vendor: "crustdata",
  };
}

// ── Soft country safety net ───────────────────────────────────────────────

// Per-country patterns that location_name must contain at least one of.
// Only applied when the place is a known country (COUNTRY_ALIASES hit).
const COUNTRY_LOCATION_PATTERNS: Record<string, RegExp> = {
  India:
    /\b(india|IN|bengaluru|bangalore|mumbai|delhi|hyderabad|chennai|pune|kolkata|calcutta|ahmedabad|jaipur|surat|lucknow|kanpur|nagpur|visakhapatnam|indore|thane|bhopal|patna|vadodara|ghaziabad|ludhiana|agra|nashik|faridabad|meerut|rajkot|kalyan|vasai|srinagar|aurangabad|dhanbad|amritsar|navi mumbai)\b/i,
  "United States":
    /\b(united states|usa|us\b|new york|los angeles|san francisco|chicago|houston|phoenix|philadelphia|san antonio|san diego|dallas|san jose|austin|jacksonville|fort worth|columbus|charlotte|indianapolis|seattle|denver|boston|el paso|detroit|nashville|portland|las vegas|memphis|louisville|baltimore|milwaukee|albuquerque|tucson|fresno|sacramento|mesa|kansas city|atlanta|omaha|colorado springs|raleigh|long beach|virginia beach|minneapolis|tampa|new orleans|arlington|wichita|bakersfield|aurora|anaheim|santa ana|corpus christi|riverside|st louis|lexington|pittsburgh|anchorage|stockton|cincinnati|st paul|toledo|greensboro|newark|plano|henderson|lincoln|buffalo|fort wayne|jersey city|chula vista|orlando|st petersburg|norfolk|chandler|laredo|madison|durham|lubbock|winston|garland|glendale|hialeah|reno|baton rouge|irvine|chesapeake|scottsdale|north las vegas|fremont|gilbert|san bernardino|birmingham|rochester|richmond|spokane|des moines|montgomery|modesto|fayetteville|tacoma|shreveport|san jose|akron|salt lake city|huntsville|grand rapids|tallahassee|worcester|knoxville|newport news|brownsville|santa clarita|providence|garden grove|oceanside|fort lauderdale|rancho cucamonga|tempe|ontario|springfield|cape coral|sioux falls|peoria|elk grove|pembroke pines|corona|eugene|cary|fort collins|jackson|alexandria|hayward|lancaster|salinas|palmdale|sunnyvale|pomona|escondido|surprise|roseville|kansas city|savannah|clarksville|paterson|torrance|bridgeport|mcallen|joliet|syracuse|pasadena|rockford|hollywood|macon|kansas city|fontana|moreno valley|glendale|akron|yonkers|amarillo|worcester|aurora|little rock|columbus|huntington beach|tallahassee|grand prairie|overland park|columbus|olympia)\b/i,
  "United Kingdom":
    /\b(united kingdom|uk\b|england|wales|scotland|northern ireland|london|manchester|birmingham|leeds|glasgow|sheffield|bradford|edinburgh|liverpool|bristol|cardiff|belfast|leicester|wakefield|coventry|nottingham|newcastle|sunderland|brighton|hull|plymouth|stoke|wolverhampton|derby|swansea|southampton|salford|aberdeen|westminster|portsmouth|york|peterborough|dundee|lancaster|oxford|cambridge|bath|exeter|chester|gloucester|cheltenham|northampton|milton keynes|reading|slough|swindon|ipswich|norwich|luton|bolton|stockport|blackpool|oldham|rotherham|middlesbrough|telford|worthing|huddersfield|poole|eastbourne)\b/i,
};

// Fallback for countries not in COUNTRY_LOCATION_PATTERNS: require location_name
// to contain the canonical country name.
function locationMatchesCountry(
  locationName: string | null,
  canonicalCountry: string,
): boolean {
  // Null/empty location is REJECTED when a country constraint is active.
  // Better to surface fewer candidates than to show the wrong geography.
  if (!locationName) return false;
  const pattern = COUNTRY_LOCATION_PATTERNS[canonicalCountry];
  if (pattern) return pattern.test(locationName);
  // Generic fallback: case-insensitive substring match on country name.
  return locationName.toLowerCase().includes(canonicalCountry.toLowerCase());
}

/** Drop profiles whose location_name clearly contradicts the expected country.
 *  Only active when place resolved to a known country (COUNTRY_ALIASES hit). */
export function filterByCountry(
  candidates: RawCalibrationCandidate[],
  canonicalCountry: string,
): RawCalibrationCandidate[] {
  return candidates.filter((c) =>
    locationMatchesCountry(c.location_name, canonicalCountry),
  );
}

// ── Country extraction helper ─────────────────────────────────────────────

/**
 * Extract a canonical country name from a place string for use as a
 * post-filter. Arms for:
 *   "India"           → "India"          (bare country alias)
 *   "Hyderabad, India" → "India"          (last comma-segment is a known country)
 *   "Seattle, WA"     → null             (WA is not a COUNTRY_ALIASES key)
 *   "Bangalore"       → null             (city-only, no country)
 */
export function extractCanonicalCountry(place: string): string | null {
  if (!place) return null;
  // Bare country alias
  const direct = COUNTRY_ALIASES[place.toLowerCase().trim()];
  if (direct) return direct;
  // Last comma-segment might be a country (e.g. "Hyderabad, India")
  const segments = place.split(",").map((s) => s.trim());
  if (segments.length > 1) {
    const lastAlias =
      COUNTRY_ALIASES[segments[segments.length - 1].toLowerCase()];
    if (lastAlias) return lastAlias;
  }
  return null;
}

// ── HTTP search ───────────────────────────────────────────────────────────

/** Search Crustdata for candidates matching a role brief.
 *  Returns an empty array on any error (non-fatal for calibration gate). */
export async function searchCrustdataForRoleBrief(
  roleBrief: CalibrationRoleBrief,
  limit: number,
  apiKey: string,
): Promise<RawCalibrationCandidate[]> {
  const filters = buildCalibrationFilters(roleBrief);
  if (!filters) return [];

  // Determine canonical country for the post-filter.
  // Arms for bare countries ("India"), City,Country ("Hyderabad, India"),
  // and paren forms ("Hyderabad (India)") — the latter is normalised to
  // "Hyderabad, India" by parseLocationForFilter before we reach here.
  const location =
    typeof roleBrief.location === "string" ? roleBrief.location.trim() : null;
  const { place } = location
    ? parseLocationForFilter(location)
    : { place: null };
  const canonicalCountry = place ? extractCanonicalCountry(place) : null;

  try {
    const response = await fetch(CRUSTDATA_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "x-api-version": CRUSTDATA_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filters, limit }),
    });
    if (!response.ok) {
      let bodySnippet = "";
      try {
        bodySnippet = (await response.text()).slice(0, 200);
      } catch {
        // ignore read error
      }
      console.error(
        `crustdata HTTP error ${response.status}:`,
        bodySnippet || "(no body)",
      );
      return [];
    }
    const result = (await response.json()) as {
      profiles?: Array<Record<string, unknown>>;
    };
    const normalized = (result.profiles ?? []).map(normalizeCrustdataProfile);
    return canonicalCountry
      ? filterByCountry(normalized, canonicalCountry)
      : normalized;
  } catch (err) {
    console.error("crustdata fetch error:", err);
    return [];
  }
}
