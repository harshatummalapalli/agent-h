import { describe, it, expect } from "vitest";
import { buildScoringTextFromDiscovery } from "./discoveryEvidence";

describe("buildScoringTextFromDiscovery", () => {
  it("builds plain-fields text from a normalized discovery candidate", () => {
    const { text, source } = buildScoringTextFromDiscovery({
      full_name: "Ada Lovelace",
      job_title: "Staff Engineer",
      job_company_name: "Analytical Engines Ltd",
      location_name: "London, UK",
      skills: ["Python", "Distributed systems"],
    });

    expect(source).toBe("plain_fields");
    expect(text).toContain("Ada Lovelace");
    expect(text).toContain("Staff Engineer");
    expect(text).toContain("Analytical Engines Ltd");
    expect(text).toContain("SKILLS: Python, Distributed systems");
  });

  it("returns an empty string when no profile fields are present", () => {
    expect(buildScoringTextFromDiscovery({}).text).toBe("");
  });
});
