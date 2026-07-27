import { describe, it, expect } from "vitest";
import {
  classifyPlace,
  parseLocationForFilter,
  buildCalibrationFilters,
  COUNTRY_ALIASES,
} from "./crustdataClient";

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
