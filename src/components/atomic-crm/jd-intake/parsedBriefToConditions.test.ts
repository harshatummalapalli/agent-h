import { describe, it, expect } from "vitest";
import { parsedBriefToConditions } from "./parsedBriefToConditions";

describe("parsedBriefToConditions", () => {
  it("maps title to title/require", () => {
    const result = parsedBriefToConditions({ title: "Software Engineer" });
    expect(result).toContainEqual({
      category: "title",
      disposition: "require",
      value: "Software Engineer",
    });
  });

  it("maps seniority to seniority/require", () => {
    const result = parsedBriefToConditions({ seniority: "senior" });
    expect(result).toContainEqual({
      category: "seniority",
      disposition: "require",
      value: "senior",
    });
  });

  it("maps location to location/require", () => {
    const result = parsedBriefToConditions({ location: "Bangalore, India" });
    expect(result).toContainEqual({
      category: "location",
      disposition: "require",
      value: "Bangalore, India",
    });
  });

  it("splits multi-city location on ' / '", () => {
    const result = parsedBriefToConditions({ location: "Delhi / Mumbai" });
    const locs = result.filter((c) => c.category === "location");
    expect(locs).toHaveLength(2);
    expect(locs[0].value).toBe("Delhi");
    expect(locs[1].value).toBe("Mumbai");
  });

  it("maps years_experience_min/max range", () => {
    const result = parsedBriefToConditions({
      years_experience_min: 4,
      years_experience_max: 10,
    });
    expect(result).toContainEqual({
      category: "experience_range",
      disposition: "require",
      value: "4-10",
    });
  });

  it("maps min-only YoE", () => {
    const result = parsedBriefToConditions({ years_experience_min: 5 });
    expect(result).toContainEqual({
      category: "experience_range",
      disposition: "require",
      value: "min:5",
    });
  });

  it("maps max-only YoE", () => {
    const result = parsedBriefToConditions({ years_experience_max: 8 });
    expect(result).toContainEqual({
      category: "experience_range",
      disposition: "require",
      value: "max:8",
    });
  });

  it("maps required_skills to skill/require", () => {
    const result = parsedBriefToConditions({
      required_skills: ["React", "TypeScript"],
    });
    const skills = result.filter(
      (c) => c.category === "skill" && c.disposition === "require",
    );
    expect(skills.map((c) => c.value)).toEqual(["React", "TypeScript"]);
  });

  it("deduplicates must_have_keywords against required_skills (case-insensitive)", () => {
    const result = parsedBriefToConditions({
      required_skills: ["React"],
      must_have_keywords: ["react", "Node.js"],
    });
    const skills = result.filter(
      (c) => c.category === "skill" && c.disposition === "require",
    );
    expect(skills.map((c) => c.value)).toEqual(["React", "Node.js"]);
  });

  it("maps nice_to_have_keywords to skill/prefer", () => {
    const result = parsedBriefToConditions({
      nice_to_have_keywords: ["Docker", "Kubernetes"],
    });
    const prefs = result.filter(
      (c) => c.category === "skill" && c.disposition === "prefer",
    );
    expect(prefs.map((c) => c.value)).toEqual(["Docker", "Kubernetes"]);
  });

  it("maps preference_tiers keywords to skill/prefer", () => {
    const result = parsedBriefToConditions({
      preference_tiers: [
        { rank: 1, label: "Primary", keywords: ["AWS", "GCP"] },
      ],
    });
    const prefs = result.filter(
      (c) => c.category === "skill" && c.disposition === "prefer",
    );
    expect(prefs.map((c) => c.value)).toEqual(["AWS", "GCP"]);
  });

  it("deduplicates preference_tiers against nice_to_have_keywords", () => {
    const result = parsedBriefToConditions({
      nice_to_have_keywords: ["AWS"],
      preference_tiers: [{ rank: 1, label: "P", keywords: ["aws", "GCP"] }],
    });
    const prefs = result.filter(
      (c) => c.category === "skill" && c.disposition === "prefer",
    );
    expect(prefs.map((c) => c.value)).toEqual(["AWS", "GCP"]);
  });

  it("maps excluded_companies to company/exclude", () => {
    const result = parsedBriefToConditions({
      excluded_companies: ["Infosys", "TCS"],
    });
    const excls = result.filter(
      (c) => c.category === "company" && c.disposition === "exclude",
    );
    expect(excls.map((c) => c.value)).toEqual(["Infosys", "TCS"]);
  });

  it("maps exclusion_keywords to title/exclude", () => {
    const result = parsedBriefToConditions({
      exclusion_keywords: ["Intern", "Fresher"],
    });
    const excls = result.filter(
      (c) => c.category === "title" && c.disposition === "exclude",
    );
    expect(excls.map((c) => c.value)).toEqual(["Intern", "Fresher"]);
  });

  it("skips empty/blank values", () => {
    const result = parsedBriefToConditions({
      required_skills: ["", "  "],
      nice_to_have_keywords: [],
    });
    expect(result).toHaveLength(0);
  });

  it("full round-trip produces correct conditions", () => {
    const result = parsedBriefToConditions({
      title: "Backend Engineer",
      seniority: "senior",
      location: "Hyderabad, India",
      years_experience_min: 5,
      years_experience_max: 12,
      required_skills: ["Java", "Kafka"],
      must_have_keywords: ["Microservices"],
      nice_to_have_keywords: ["Kubernetes"],
      excluded_companies: ["IBM"],
      exclusion_keywords: ["Manager"],
    });

    const categories = result.map(
      (c) => `${c.category}/${c.disposition}/${c.value}`,
    );
    expect(categories).toContain("title/require/Backend Engineer");
    expect(categories).toContain("seniority/require/senior");
    expect(categories).toContain("location/require/Hyderabad, India");
    expect(categories).toContain("experience_range/require/5-12");
    expect(categories).toContain("skill/require/Java");
    expect(categories).toContain("skill/require/Kafka");
    expect(categories).toContain("skill/require/Microservices");
    expect(categories).toContain("skill/prefer/Kubernetes");
    expect(categories).toContain("company/exclude/IBM");
    expect(categories).toContain("title/exclude/Manager");
  });
});
