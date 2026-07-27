import { describe, it, expect } from "vitest";
import {
  classifyPlace,
  parseLocationForFilter,
  buildCalibrationFilters,
  filterByCountry,
  COUNTRY_ALIASES,
  type RawCalibrationCandidate,
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

const makeCandidate = (
  location_name: string | null,
): RawCalibrationCandidate => ({
  id: "1",
  full_name: "Test Person",
  job_title: "Engineer",
  job_company_name: "Corp",
  location_name,
  skills: [],
  linkedin_url: null,
  years_experience: null,
  _source_vendor: "crustdata",
});

describe("filterByCountry", () => {
  it("keeps a candidate with null location_name (API already filtered)", () => {
    const candidates = [makeCandidate(null)];
    expect(filterByCountry(candidates, "India")).toHaveLength(1);
  });

  it("keeps a candidate with empty string location", () => {
    const candidates = [makeCandidate("")];
    expect(filterByCountry(candidates, "India")).toHaveLength(1);
  });

  it("keeps a candidate whose location matches India", () => {
    const candidates = [makeCandidate("Bangalore, India")];
    expect(filterByCountry(candidates, "India")).toHaveLength(1);
  });

  it("keeps a candidate with ambiguous location not matching any known country", () => {
    const candidates = [makeCandidate("Hyderabad")]; // city name only, no country
    expect(filterByCountry(candidates, "India")).toHaveLength(1);
  });

  it("rejects a candidate whose location clearly belongs to United States (India requested)", () => {
    const candidates = [
      makeCandidate("San Francisco, California, United States"),
    ];
    expect(filterByCountry(candidates, "India")).toHaveLength(0);
  });

  it("rejects a candidate whose location is 'New York, NY' (India requested)", () => {
    const candidates = [makeCandidate("New York, NY")];
    expect(filterByCountry(candidates, "India")).toHaveLength(0);
  });

  it("rejects a candidate whose location is 'London, United Kingdom' (India requested)", () => {
    const candidates = [makeCandidate("London, United Kingdom")];
    expect(filterByCountry(candidates, "India")).toHaveLength(0);
  });
});

describe("buildCalibrationFilters", () => {
  it("emits at most one skill condition even with 5 required skills", () => {
    const filters = buildCalibrationFilters({
      name: "Backend Engineer",
      location: "India",
      required_skills: ["Python", "Django", "PostgreSQL", "Redis", "Docker"],
    });
    expect(filters).not.toBeNull();
    // Walk the AND conditions and count skill field occurrences
    const countSkillConditions = (f: unknown): number => {
      if (!f || typeof f !== "object") return 0;
      const obj = f as Record<string, unknown>;
      if (obj.field === "skills.professional_network_skills") return 1;
      if (obj.op && Array.isArray(obj.conditions)) {
        return (obj.conditions as unknown[]).reduce(
          (sum: number, c) => sum + countSkillConditions(c),
          0,
        );
      }
      return 0;
    };
    expect(countSkillConditions(filters)).toBe(1);
  });

  it("produces an OR group for a title with more than 2 words", () => {
    const filters = buildCalibrationFilters({
      name: "Senior AI Engineer",
    });
    expect(filters).not.toBeNull();
    // The filter (or one of the AND conditions) should be an OR group for the title
    const findTitleOrGroup = (f: unknown): boolean => {
      if (!f || typeof f !== "object") return false;
      const obj = f as Record<string, unknown>;
      if (
        obj.op === "or" &&
        Array.isArray(obj.conditions) &&
        (obj.conditions as unknown[]).some(
          (c) =>
            typeof c === "object" &&
            c !== null &&
            (c as Record<string, unknown>).field ===
              "experience.employment_details.current.title",
        )
      ) {
        return true;
      }
      if (Array.isArray(obj.conditions)) {
        return (obj.conditions as unknown[]).some(findTitleOrGroup);
      }
      return false;
    };
    expect(findTitleOrGroup(filters)).toBe(true);
  });

  it("does not emit an OR group for a title with 2 or fewer words", () => {
    const filters = buildCalibrationFilters({ name: "Engineer" });
    const obj = filters as Record<string, unknown>;
    // Single-word title → direct contains condition, not an OR group
    expect(obj?.op).not.toBe("or");
    expect(obj?.field).toBe("experience.employment_details.current.title");
  });

  it("skips seniority when mid_level (maps to null)", () => {
    const filters = buildCalibrationFilters({
      name: "Engineer",
      seniority: "mid_level",
    });
    const hasSeniority = JSON.stringify(filters).includes(
      "experience.employment_details.current.seniority_level",
    );
    expect(hasSeniority).toBe(false);
  });

  it("returns null when brief has no title and no skills", () => {
    expect(buildCalibrationFilters({})).toBeNull();
  });
});
