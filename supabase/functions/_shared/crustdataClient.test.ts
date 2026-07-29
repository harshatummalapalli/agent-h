import { describe, it, expect } from "vitest";
import {
  classifyPlace,
  parseLocationForFilter,
  buildCalibrationFilters,
  extractCanonicalCountry,
  COUNTRY_ALIASES,
} from "./crustdataClient";

// ── helpers ──────────────────────────────────────────────────────────────────

type AnyFilter = { field?: string; type?: string; value?: unknown; op?: string; conditions?: AnyFilter[] };

/** Recursively flatten a nested filter tree into a flat array of leaf conditions. */
function flattenConditions(f: AnyFilter): AnyFilter[] {
  if (f.op && Array.isArray(f.conditions)) {
    return f.conditions.flatMap((c) => flattenConditions(c));
  }
  return [f];
}

describe("parseLocationForFilter", () => {
  it("extracts India from 'Remote, India'", () => {
    expect(parseLocationForFilter("Remote, India")).toEqual({
      place: "India",
      remoteOnly: false,
    });
  });

  it("extracts India from 'Remote - India'", () => {
    expect(parseLocationForFilter("Remote - India")).toEqual({
      place: "India",
      remoteOnly: false,
    });
  });

  it("extracts India from 'India (Remote)'", () => {
    expect(parseLocationForFilter("India (Remote)")).toEqual({
      place: "India",
      remoteOnly: false,
    });
  });

  it("extracts India from 'Remote people based in India'", () => {
    expect(parseLocationForFilter("Remote people based in India")).toEqual({
      place: "India",
      remoteOnly: false,
    });
  });

  it("extracts India from 'based in India, remote OK'", () => {
    expect(parseLocationForFilter("based in India, remote OK")).toEqual({
      place: "India",
      remoteOnly: false,
    });
  });

  it("returns remoteOnly=true for 'Remote'", () => {
    expect(parseLocationForFilter("Remote")).toEqual({
      place: null,
      remoteOnly: true,
    });
  });

  it("returns remoteOnly=true for 'Remote only'", () => {
    expect(parseLocationForFilter("Remote only")).toEqual({
      place: null,
      remoteOnly: true,
    });
  });

  it("returns remoteOnly=true for 'remote ok'", () => {
    expect(parseLocationForFilter("remote ok")).toEqual({
      place: null,
      remoteOnly: true,
    });
  });

  it("passes through a plain city with no remote mention", () => {
    const result = parseLocationForFilter("Bangalore");
    expect(result.place).toBe("Bangalore");
    expect(result.remoteOnly).toBe(false);
  });

  it("returns null place for empty string", () => {
    expect(parseLocationForFilter("")).toEqual({
      place: null,
      remoteOnly: false,
    });
  });
});

describe("classifyPlace", () => {
  it("routes 'India' to the country field with exact match", () => {
    const result = classifyPlace("India");
    expect(result.field).toBe("basic_profile.location.country");
    expect(result.type).toBe("=");
    expect(result.value).toBe("India");
  });

  it("routes 'india' (lowercase) correctly", () => {
    const result = classifyPlace("india");
    expect(result.field).toBe("basic_profile.location.country");
    expect(result.value).toBe("India");
  });

  it("routes 'US' alias to United States on country field", () => {
    const result = classifyPlace("US");
    expect(result.field).toBe("basic_profile.location.country");
    expect(result.type).toBe("=");
    expect(result.value).toBe("United States");
  });

  it("routes 'usa' alias to United States", () => {
    expect(classifyPlace("usa").value).toBe("United States");
  });

  it("routes 'UK' alias to United Kingdom", () => {
    const result = classifyPlace("UK");
    expect(result.field).toBe("basic_profile.location.country");
    expect(result.value).toBe("United Kingdom");
  });

  it("routes 'UAE' to United Arab Emirates", () => {
    expect(classifyPlace("UAE").value).toBe("United Arab Emirates");
  });

  it("routes 'Dubai' to United Arab Emirates", () => {
    expect(classifyPlace("Dubai").value).toBe("United Arab Emirates");
  });

  it("routes 'Bangalore' to the city field with contains match", () => {
    const result = classifyPlace("Bangalore");
    expect(result.field).toBe("basic_profile.location.city");
    expect(result.type).toBe("(.)");
    expect(result.value).toBe("Bangalore");
  });

  it("routes 'New York' to city field", () => {
    const result = classifyPlace("New York");
    expect(result.field).toBe("basic_profile.location.city");
    expect(result.type).toBe("(.)");
  });

  it("routes 'San Francisco' to city field", () => {
    expect(classifyPlace("San Francisco").field).toBe(
      "basic_profile.location.city",
    );
  });

  it("COUNTRY_ALIASES has India entry", () => {
    expect(COUNTRY_ALIASES["india"]).toBe("India");
  });
});

describe("buildCalibrationFilters — location handling", () => {
  it("does NOT produce value 'Hyderabad, India' for location 'Hyderabad, India'", () => {
    const filters = buildCalibrationFilters({
      name: "Engineering Manager",
      location: "Hyderabad, India",
    });
    expect(filters).not.toBeNull();
    // Flatten top-level conditions (AND group or single condition)
    const conds: Array<{ field: string; type: string; value: unknown }> =
      filters && "conditions" in filters
        ? (filters.conditions as Array<{
            field: string;
            type: string;
            value: unknown;
          }>)
        : [filters as { field: string; type: string; value: unknown }];
    const locationCond = conds.find((c) => c.field?.includes("location"));
    expect(locationCond).toBeDefined();
    // The full "City, Country" string must never reach the Crustdata query.
    expect(locationCond!.value).not.toBe("Hyderabad, India");
    // With country-preference enhancement: "India" (exact country match).
    // Without it (city-token fallback): "Hyderabad".
    expect(["Hyderabad", "India"]).toContain(locationCond!.value);
  });

  it("uses country field for 'Hyderabad, India' when country segment is a known alias", () => {
    const filters = buildCalibrationFilters({
      name: "Software Engineer",
      location: "Hyderabad, India",
    });
    expect(filters).not.toBeNull();
    const conds: Array<{ field: string; type: string; value: unknown }> =
      filters && "conditions" in filters
        ? (filters.conditions as Array<{
            field: string;
            type: string;
            value: unknown;
          }>)
        : [filters as { field: string; type: string; value: unknown }];
    const locationCond = conds.find((c) => c.field?.includes("location"));
    // Country enhancement: last comma segment "India" is in COUNTRY_ALIASES
    expect(locationCond!.field).toBe("basic_profile.location.country");
    expect(locationCond!.type).toBe("=");
    expect(locationCond!.value).toBe("India");
  });

  it("uses bare city token for 'Seattle, WA' (no country alias match)", () => {
    const filters = buildCalibrationFilters({
      name: "Product Manager",
      location: "Seattle, WA",
    });
    expect(filters).not.toBeNull();
    const conds: Array<{ field: string; type: string; value: unknown }> =
      filters && "conditions" in filters
        ? (filters.conditions as Array<{
            field: string;
            type: string;
            value: unknown;
          }>)
        : [filters as { field: string; type: string; value: unknown }];
    const locationCond = conds.find((c) => c.field?.includes("location"));
    expect(locationCond!.field).toBe("basic_profile.location.city");
    // First comma segment, not the full "Seattle, WA"
    expect(locationCond!.value).toBe("Seattle");
    expect(locationCond!.value).not.toBe("Seattle, WA");
  });

  it("keeps country exact filter for plain country name 'India'", () => {
    const filters = buildCalibrationFilters({
      name: "Data Scientist",
      location: "India",
    });
    expect(filters).not.toBeNull();
    const conds: Array<{ field: string; type: string; value: unknown }> =
      filters && "conditions" in filters
        ? (filters.conditions as Array<{
            field: string;
            type: string;
            value: unknown;
          }>)
        : [filters as { field: string; type: string; value: unknown }];
    const locationCond = conds.find((c) => c.field?.includes("location"));
    expect(locationCond!.field).toBe("basic_profile.location.country");
    expect(locationCond!.type).toBe("=");
    expect(locationCond!.value).toBe("India");
  });

  it("keeps country exact filter for 'Remote, India' (remote-stripped → India)", () => {
    const filters = buildCalibrationFilters({
      name: "Engineering Manager",
      location: "Remote, India",
    });
    expect(filters).not.toBeNull();
    const conds: Array<{ field: string; type: string; value: unknown }> =
      filters && "conditions" in filters
        ? (filters.conditions as Array<{
            field: string;
            type: string;
            value: unknown;
          }>)
        : [filters as { field: string; type: string; value: unknown }];
    const locationCond = conds.find((c) => c.field?.includes("location"));
    // parseLocationForFilter strips "Remote," → place = "India"
    // classifyPlace("India") → country exact match
    expect(locationCond!.field).toBe("basic_profile.location.country");
    expect(locationCond!.value).toBe("India");
  });
});

// ── NEW: paren-country form in parseLocationForFilter ─────────────────────────

describe("parseLocationForFilter — paren-country form (regression: Hyderabad (India))", () => {
  it("Hyderabad (India) → place='Hyderabad, India', not remoteOnly", () => {
    const r = parseLocationForFilter("Hyderabad (India)");
    expect(r.place).toBe("Hyderabad, India");
    expect(r.remoteOnly).toBe(false);
  });

  it("Hyderabad (india) lowercase paren → same result", () => {
    const r = parseLocationForFilter("Hyderabad (india)");
    expect(r.place).toBe("Hyderabad, india");
    // Still routes to India via classifyPlace downstream
    expect(r.remoteOnly).toBe(false);
  });

  it("Remote, Hyderabad (India) → place includes Hyderabad", () => {
    const r = parseLocationForFilter("Remote, Hyderabad (India)");
    expect(r.place).not.toBeNull();
    expect(r.place).toContain("Hyderabad");
  });

  it("Mumbai (India) → place='Mumbai, India'", () => {
    const r = parseLocationForFilter("Mumbai (India)");
    expect(r.place).toBe("Mumbai, India");
  });

  it("London (UK) → place='London, UK' (UK is a known alias)", () => {
    const r = parseLocationForFilter("London (UK)");
    // UK is in COUNTRY_ALIASES, so (UK) → ", UK"
    expect(r.place).toBe("London, UK");
  });

  it("Bangalore (unknown) → still returns a place (unknown paren dropped)", () => {
    const r = parseLocationForFilter("Bangalore (Tech Hub)");
    // "(Tech Hub)" is not a country — dropped
    expect(r.place).toBe("Bangalore");
    expect(r.remoteOnly).toBe(false);
  });

  // Regression: existing paren-remote forms must still work
  it("India (Remote) still → place='India', remoteOnly=false", () => {
    const r = parseLocationForFilter("India (Remote)");
    expect(r.place).toBe("India");
    expect(r.remoteOnly).toBe(false);
  });
});

// ── NEW: buildCalibrationFilters — all Hyderabad/India variants → India country filter ──

const INDIA_COUNTRY_FIELD = "basic_profile.location.country";
const INDIA_COUNTRY_FILTER = { field: INDIA_COUNTRY_FIELD, type: "=", value: "India" };

const INDIA_LOCATION_VARIANTS: Array<[string, string]> = [
  ["India", "bare country"],
  ["Hyderabad, India", "City,Country comma form"],
  ["Hyderabad (India)", "City(Country) paren form"],
  ["Remote, India", "Remote,Country"],
  ["India (Remote)", "Country(Remote)"],
];

describe("buildCalibrationFilters — India location variants all produce India country filter", () => {
  for (const [loc, label] of INDIA_LOCATION_VARIANTS) {
    it(`'${loc}' (${label}) → country='India' exact filter`, () => {
      const filters = buildCalibrationFilters({ name: "Software Engineer", location: loc });
      expect(filters).not.toBeNull();
      const flat = flattenConditions(filters as AnyFilter);
      expect(flat).toContainEqual(INDIA_COUNTRY_FILTER);
    });
  }
});

// ── NEW: extractCanonicalCountry ──────────────────────────────────────────────

describe("extractCanonicalCountry", () => {
  it("bare 'India' → 'India'", () => {
    expect(extractCanonicalCountry("India")).toBe("India");
  });

  it("bare 'india' (lowercase) → 'India'", () => {
    expect(extractCanonicalCountry("india")).toBe("India");
  });

  it("'Hyderabad, India' → 'India' (last segment)", () => {
    expect(extractCanonicalCountry("Hyderabad, India")).toBe("India");
  });

  it("'Hyderabad, india' lowercase → 'India'", () => {
    expect(extractCanonicalCountry("Hyderabad, india")).toBe("India");
  });

  it("'Seattle, WA' → null (WA is not a country alias)", () => {
    expect(extractCanonicalCountry("Seattle, WA")).toBeNull();
  });

  it("'Bangalore' → null (city only, no country)", () => {
    expect(extractCanonicalCountry("Bangalore")).toBeNull();
  });

  it("'US' → 'United States'", () => {
    expect(extractCanonicalCountry("US")).toBe("United States");
  });

  it("'New York, US' → 'United States'", () => {
    expect(extractCanonicalCountry("New York, US")).toBe("United States");
  });
});

// ── NEW: title shingle decomposition in buildCalibrationFilters ───────────────

describe("buildCalibrationFilters — title shingle decomposition (regression: Cyber Incident)", () => {
  it("'Cyber Incident Review Team Lead' produces shingles, not a lone 'Cyber Incident'", () => {
    const filters = buildCalibrationFilters({
      name: "Cyber Incident Review Team Lead",
      location: "Hyderabad, India",
    });
    expect(filters).not.toBeNull();
    const flat = flattenConditions(filters as AnyFilter);
    const titleTerms = flat
      .filter((c) => c.field === "experience.employment_details.current.title")
      .map((c) => c.value as string);

    // Must include role-specific shingles
    expect(titleTerms).toContain("Review Team");
    expect(titleTerms).toContain("Team Lead");

    // 'Cyber Incident' alone as the only title term is forbidden
    if (titleTerms.length === 1) {
      expect(titleTerms[0]).not.toBe("Cyber Incident");
    }

    // Shingles must not include the raw 5-word full phrase (too long for literal match)
    const hasFiveWordPhrase = titleTerms.some(
      (t) => t.split(/\s+/).length > 2,
    );
    expect(hasFiveWordPhrase).toBe(false);
  });

  it("'Software Engineer' (2 words) stays as a single condition", () => {
    const filters = buildCalibrationFilters({ name: "Software Engineer", location: "India" });
    expect(filters).not.toBeNull();
    const flat = flattenConditions(filters as AnyFilter);
    const titleConds = flat.filter(
      (c) => c.field === "experience.employment_details.current.title",
    );
    expect(titleConds.length).toBe(1);
    expect(titleConds[0].value).toBe("Software Engineer");
  });

  it("'Senior Software Engineer' (3 words) produces 2 shingles: 'Senior Software' + 'Software Engineer'", () => {
    const filters = buildCalibrationFilters({ name: "Senior Software Engineer", location: "India" });
    expect(filters).not.toBeNull();
    const flat = flattenConditions(filters as AnyFilter);
    const titleTerms = flat
      .filter((c) => c.field === "experience.employment_details.current.title")
      .map((c) => c.value as string);
    expect(titleTerms).toContain("Senior Software");
    expect(titleTerms).toContain("Software Engineer");
  });

  it("title shingles are all exactly 2 words (within the 6-term cap)", () => {
    const filters = buildCalibrationFilters({
      name: "Cyber Incident Response Team Lead Manager",
      location: "India",
    });
    expect(filters).not.toBeNull();
    const flat = flattenConditions(filters as AnyFilter);
    const titleTerms = flat
      .filter((c) => c.field === "experience.employment_details.current.title")
      .map((c) => c.value as string);
    for (const term of titleTerms) {
      expect(term.split(/\s+/).length).toBe(2);
    }
    // 6-word title → 5 shingles; cap at 6 so all 5 are present
    expect(titleTerms.length).toBeLessThanOrEqual(6);
    expect(titleTerms.length).toBeGreaterThan(0);
  });
});
