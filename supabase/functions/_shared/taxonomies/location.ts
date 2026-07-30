// Location taxonomy — replaces word-count heuristic with reference lookups.
//
// No Deno-specific imports — Vitest-compatible.
//
// Design (2026-07-30):
// - Countries: seeded from ISO 3166-1 alpha-2/alpha-3 + common aliases.
//   Growing list, not GeoNames import, for v1.
// - Cities: seeded from JD corpus + Crustdata autocomplete results.
//   Grows via live usage — a city seen in autocomplete gets added as a row.
// - Unknown: routed to unenforceable_constraints, never sent as broken filter.

export type ResolvedLocation =
  | { kind: "country"; canonical: string }
  | { kind: "city"; canonical: string; country?: string }
  | { kind: "unknown"; raw: string };

// ─── Country reference ────────────────────────────────────────────────────────
//
// Maps alias → canonical country name (the value used in the Crustdata
// country filter). Populated from ISO 3166-1 + common English aliases.
// Add rows here; never add compiler if-branches.
const COUNTRY_ALIASES: Record<string, string> = {
  // United States
  "united states": "United States",
  "united states of america": "United States",
  usa: "United States",
  us: "United States",
  "u.s.": "United States",
  "u.s.a.": "United States",
  america: "United States",
  american: "United States",

  // United Kingdom
  "united kingdom": "United Kingdom",
  uk: "United Kingdom",
  "u.k.": "United Kingdom",
  britain: "United Kingdom",
  "great britain": "United Kingdom",
  england: "United Kingdom",

  // Canada
  canada: "Canada",
  ca: "Canada",

  // India
  india: "India",
  in: "India",

  // Germany
  germany: "Germany",
  deutschland: "Germany",
  de: "Germany",

  // France
  france: "France",
  fr: "France",

  // Australia
  australia: "Australia",
  au: "Australia",
  oz: "Australia",

  // Singapore
  singapore: "Singapore",
  sg: "Singapore",

  // Netherlands
  netherlands: "Netherlands",
  "the netherlands": "Netherlands",
  holland: "Netherlands",
  nl: "Netherlands",

  // Brazil
  brazil: "Brazil",
  brasil: "Brazil",
  br: "Brazil",

  // Japan
  japan: "Japan",
  jp: "Japan",

  // China
  china: "China",
  cn: "China",
  "people's republic of china": "China",
  prc: "China",

  // Israel
  israel: "Israel",
  il: "Israel",

  // Ireland
  ireland: "Ireland",
  ie: "Ireland",

  // Sweden
  sweden: "Sweden",
  se: "Sweden",

  // Denmark
  denmark: "Denmark",
  dk: "Denmark",

  // Norway
  norway: "Norway",
  no: "Norway",

  // Finland
  finland: "Finland",
  fi: "Finland",

  // Switzerland
  switzerland: "Switzerland",
  ch: "Switzerland",

  // Poland
  poland: "Poland",
  pl: "Poland",

  // Spain
  spain: "Spain",
  es: "Spain",

  // Italy
  italy: "Italy",
  it: "Italy",

  // Mexico
  mexico: "Mexico",
  mx: "Mexico",

  // South Korea
  "south korea": "South Korea",
  korea: "South Korea",
  kr: "South Korea",

  // Pakistan
  pakistan: "Pakistan",
  pk: "Pakistan",

  // Bangladesh
  bangladesh: "Bangladesh",
  bd: "Bangladesh",

  // Nigeria
  nigeria: "Nigeria",
  ng: "Nigeria",

  // South Africa
  "south africa": "South Africa",
  za: "South Africa",

  // UAE
  "united arab emirates": "United Arab Emirates",
  uae: "United Arab Emirates",
  "u.a.e.": "United Arab Emirates",

  // New Zealand
  "new zealand": "New Zealand",
  nz: "New Zealand",

  // Philippines
  philippines: "Philippines",
  ph: "Philippines",

  // Vietnam
  vietnam: "Vietnam",
  vn: "Vietnam",

  // Indonesia
  indonesia: "Indonesia",
  id: "Indonesia",

  // Remote (special case — not a location but frequently appears as location)
  remote: "Remote",
  "fully remote": "Remote",
  "100% remote": "Remote",
};

// ─── City reference ────────────────────────────────────────────────────────────
//
// Maps city alias → { canonical, country }.
// Seeded from JD corpus. Grows via Crustdata autocomplete results.
// Format: "city name (lowercase)" → { canonical: "City Name", country: "Country" }
const CITY_ALIASES: Record<string, { canonical: string; country: string }> = {
  // United States — major tech hubs
  "san francisco": { canonical: "San Francisco", country: "United States" },
  sf: { canonical: "San Francisco", country: "United States" },
  "san francisco, ca": { canonical: "San Francisco", country: "United States" },
  "new york": { canonical: "New York", country: "United States" },
  "new york city": { canonical: "New York", country: "United States" },
  nyc: { canonical: "New York", country: "United States" },
  ny: { canonical: "New York", country: "United States" },
  seattle: { canonical: "Seattle", country: "United States" },
  "seattle, wa": { canonical: "Seattle", country: "United States" },
  austin: { canonical: "Austin", country: "United States" },
  "austin, tx": { canonical: "Austin", country: "United States" },
  "los angeles": { canonical: "Los Angeles", country: "United States" },
  la: { canonical: "Los Angeles", country: "United States" },
  boston: { canonical: "Boston", country: "United States" },
  chicago: { canonical: "Chicago", country: "United States" },
  denver: { canonical: "Denver", country: "United States" },
  "new york, ny": { canonical: "New York", country: "United States" },
  "san jose": { canonical: "San Jose", country: "United States" },
  "silicon valley": { canonical: "San Jose", country: "United States" },
  "washington dc": { canonical: "Washington DC", country: "United States" },
  "washington, dc": { canonical: "Washington DC", country: "United States" },
  "washington d.c.": { canonical: "Washington DC", country: "United States" },
  atlanta: { canonical: "Atlanta", country: "United States" },
  raleigh: { canonical: "Raleigh", country: "United States" },
  "raleigh, nc": { canonical: "Raleigh", country: "United States" },
  "san diego": { canonical: "San Diego", country: "United States" },
  dallas: { canonical: "Dallas", country: "United States" },
  houston: { canonical: "Houston", country: "United States" },
  phoenix: { canonical: "Phoenix", country: "United States" },
  miami: { canonical: "Miami", country: "United States" },
  minneapolis: { canonical: "Minneapolis", country: "United States" },
  portland: { canonical: "Portland", country: "United States" },
  "salt lake city": { canonical: "Salt Lake City", country: "United States" },
  slc: { canonical: "Salt Lake City", country: "United States" },

  // Canada
  toronto: { canonical: "Toronto", country: "Canada" },
  "toronto, on": { canonical: "Toronto", country: "Canada" },
  vancouver: { canonical: "Vancouver", country: "Canada" },
  "vancouver, bc": { canonical: "Vancouver", country: "Canada" },
  montreal: { canonical: "Montreal", country: "Canada" },
  ottawa: { canonical: "Ottawa", country: "Canada" },
  calgary: { canonical: "Calgary", country: "Canada" },

  // United Kingdom
  london: { canonical: "London", country: "United Kingdom" },
  "london, uk": { canonical: "London", country: "United Kingdom" },
  manchester: { canonical: "Manchester", country: "United Kingdom" },
  edinburgh: { canonical: "Edinburgh", country: "United Kingdom" },
  cambridge: { canonical: "Cambridge", country: "United Kingdom" },

  // Germany
  berlin: { canonical: "Berlin", country: "Germany" },
  munich: { canonical: "Munich", country: "Germany" },
  münchen: { canonical: "Munich", country: "Germany" },
  hamburg: { canonical: "Hamburg", country: "Germany" },
  frankfurt: { canonical: "Frankfurt", country: "Germany" },

  // India
  bangalore: { canonical: "Bangalore", country: "India" },
  bengaluru: { canonical: "Bangalore", country: "India" },
  mumbai: { canonical: "Mumbai", country: "India" },
  delhi: { canonical: "Delhi", country: "India" },
  "new delhi": { canonical: "New Delhi", country: "India" },
  hyderabad: { canonical: "Hyderabad", country: "India" },
  chennai: { canonical: "Chennai", country: "India" },
  pune: { canonical: "Pune", country: "India" },

  // Singapore
  singapore: { canonical: "Singapore", country: "Singapore" },

  // Australia
  sydney: { canonical: "Sydney", country: "Australia" },
  melbourne: { canonical: "Melbourne", country: "Australia" },

  // Netherlands
  amsterdam: { canonical: "Amsterdam", country: "Netherlands" },

  // Israel
  "tel aviv": { canonical: "Tel Aviv", country: "Israel" },
  "tel aviv-yafo": { canonical: "Tel Aviv", country: "Israel" },

  // Ireland
  dublin: { canonical: "Dublin", country: "Ireland" },

  // Sweden
  stockholm: { canonical: "Stockholm", country: "Sweden" },

  // UAE
  dubai: { canonical: "Dubai", country: "United Arab Emirates" },

  // Japan
  tokyo: { canonical: "Tokyo", country: "Japan" },

  // China
  beijing: { canonical: "Beijing", country: "China" },
  shanghai: { canonical: "Shanghai", country: "China" },
  shenzhen: { canonical: "Shenzhen", country: "China" },

  // France
  paris: { canonical: "Paris", country: "France" },

  // Switzerland
  zurich: { canonical: "Zurich", country: "Switzerland" },
  zürich: { canonical: "Zurich", country: "Switzerland" },
  geneva: { canonical: "Geneva", country: "Switzerland" },
};

// ─── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve a raw location string to a typed location result.
 *
 * Priority: country aliases → city aliases → unknown.
 * Also handles "City, Country" format by trying to resolve the city portion.
 */
export function resolveLocation(raw: string): ResolvedLocation {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  // 1. Try country lookup first (countries before cities to avoid "Singapore"
  //    city matching a country, which is the same name — country wins).
  const countryMatch = COUNTRY_ALIASES[lower];
  if (countryMatch) {
    return { kind: "country", canonical: countryMatch };
  }

  // 2. Try city lookup.
  const cityMatch = CITY_ALIASES[lower];
  if (cityMatch) {
    return {
      kind: "city",
      canonical: cityMatch.canonical,
      country: cityMatch.country,
    };
  }

  // 3. Handle "City, Country" or "City, State" format — extract city part.
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx > 0) {
    const cityPart = trimmed.slice(0, commaIdx).trim().toLowerCase();
    const cityFromComma = CITY_ALIASES[cityPart];
    if (cityFromComma) {
      return {
        kind: "city",
        canonical: cityFromComma.canonical,
        country: cityFromComma.country,
      };
    }
    // Try country part too (e.g. "Bengaluru, India" — Bengaluru not in table but India is)
    const countryPart = trimmed
      .slice(commaIdx + 1)
      .trim()
      .toLowerCase();
    const countryFromComma = COUNTRY_ALIASES[countryPart];
    if (countryFromComma) {
      // Partial match: city unknown but country known — resolve as unknown
      // with country context for logging
      return { kind: "unknown", raw: trimmed };
    }
  }

  // 4. Unknown — caller logs this to unresolved_taxonomy_terms.
  return { kind: "unknown", raw: trimmed };
}
