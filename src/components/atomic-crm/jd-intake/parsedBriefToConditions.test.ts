import { describe, it, expect } from "vitest";
import {
  parsedBriefToConditions,
  normalizeSkillTokens,
} from "./parsedBriefToConditions";

// ─── normalizeSkillTokens ─────────────────────────────────────────────────────

describe("normalizeSkillTokens", () => {
  it("passes through clean atomic tokens unchanged", () => {
    expect(normalizeSkillTokens(["Python", "React", "AWS"])).toEqual([
      "Python",
      "React",
      "AWS",
    ]);
  });

  it("splits C#/.NET into separate tokens", () => {
    expect(normalizeSkillTokens(["C#/.NET"])).toEqual(["C#", ".NET"]);
  });

  it("splits compound prose phrase with tech alternatives via slash", () => {
    // Key Harsha feedback example
    expect(
      normalizeSkillTokens(["Enterprise applications with C#/.NET"]),
    ).toEqual(["C#", ".NET"]);
  });

  it("splits X or Y when both sides look like tech tokens", () => {
    const result = normalizeSkillTokens(["Python or Java"]);
    expect(result).toContain("Python");
    expect(result).toContain("Java");
  });

  it("splits X and Y when both sides look like tech tokens", () => {
    const result = normalizeSkillTokens(["React and Vue"]);
    expect(result).toContain("React");
    expect(result).toContain("Vue");
  });

  it("handles SQL Server or relational databases — keeps at least SQL Server", () => {
    const result = normalizeSkillTokens(["SQL Server or relational databases"]);
    expect(result).toContain("SQL Server");
  });

  it("strips 'programming' suffix — Python programming → Python", () => {
    expect(normalizeSkillTokens(["Python programming"])).toEqual(["Python"]);
  });

  it("strips 'development' suffix — ASP.NET Core development → ASP.NET Core", () => {
    expect(normalizeSkillTokens(["ASP.NET Core development"])).toEqual([
      "ASP.NET Core",
    ]);
  });

  it("strips 'knowledge of' prefix", () => {
    expect(normalizeSkillTokens(["knowledge of Kubernetes"])).toEqual([
      "Kubernetes",
    ]);
  });

  it("strips 'familiarity with' prefix", () => {
    expect(normalizeSkillTokens(["familiarity with Docker"])).toEqual([
      "Docker",
    ]);
  });

  it("drops YoE phrases — '5+ years software development experience'", () => {
    expect(
      normalizeSkillTokens(["5+ years software development experience"]),
    ).toEqual([]);
  });

  it("drops '3-5 years backend experience'", () => {
    expect(normalizeSkillTokens(["3-5 years backend experience"])).toEqual([]);
  });

  it("drops degree requirements", () => {
    expect(
      normalizeSkillTokens(["Bachelor's degree in Computer Science"]),
    ).toEqual([]);
  });

  it("drops placeholder values — <UNKNOWN>", () => {
    expect(normalizeSkillTokens(["<UNKNOWN>"])).toEqual([]);
  });

  it("drops placeholder values — N/A", () => {
    expect(normalizeSkillTokens(["N/A"])).toEqual([]);
  });

  it("drops placeholder values — TBD", () => {
    expect(normalizeSkillTokens(["TBD"])).toEqual([]);
  });

  it("deduplicates case-insensitively", () => {
    const result = normalizeSkillTokens(["Python", "python", "PYTHON"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Python");
  });

  it("drops empty and blank tokens", () => {
    expect(normalizeSkillTokens(["", "  ", "Python"])).toEqual(["Python"]);
  });

  it("handles slash split with three alternatives", () => {
    const result = normalizeSkillTokens(["React/Vue/Angular"]);
    expect(result).toContain("React");
    expect(result).toContain("Vue");
    expect(result).toContain("Angular");
  });
});

// ─── parsedBriefToConditions ──────────────────────────────────────────────────

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

  it("maps location to location/require with canonical city name", () => {
    // "Bangalore, India" resolves to the canonical city name "Bangalore"
    // (resolveLocation() strips the country suffix and looks up the city).
    const result = parsedBriefToConditions({ location: "Bangalore, India" });
    expect(result).toContainEqual({
      category: "location",
      disposition: "require",
      value: "Bangalore",
    });
  });

  it("splits multi-city location on ' / '", () => {
    const result = parsedBriefToConditions({ location: "Delhi / Mumbai" });
    const locs = result.filter((c) => c.category === "location");
    expect(locs).toHaveLength(2);
    expect(locs[0].value).toBe("Delhi");
    expect(locs[1].value).toBe("Mumbai");
  });

  it("skips <UNKNOWN> location — no location chip", () => {
    const result = parsedBriefToConditions({ location: "<UNKNOWN>" });
    expect(result.filter((c) => c.category === "location")).toHaveLength(0);
  });

  it("skips 'unknown' location (case-insensitive)", () => {
    const result = parsedBriefToConditions({ location: "unknown" });
    expect(result.filter((c) => c.category === "location")).toHaveLength(0);
  });

  it("skips 'N/A' location", () => {
    const result = parsedBriefToConditions({ location: "N/A" });
    expect(result.filter((c) => c.category === "location")).toHaveLength(0);
  });

  it("skips 'TBD' location", () => {
    const result = parsedBriefToConditions({ location: "TBD" });
    expect(result.filter((c) => c.category === "location")).toHaveLength(0);
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

  it("normalizes C#/.NET compound in required_skills", () => {
    const result = parsedBriefToConditions({
      required_skills: ["C#/.NET"],
    });
    const skills = result
      .filter((c) => c.category === "skill" && c.disposition === "require")
      .map((c) => c.value);
    expect(skills).toContain("C#");
    expect(skills).toContain(".NET");
  });

  it("normalizes prose phrase with tech alternatives", () => {
    const result = parsedBriefToConditions({
      required_skills: ["Enterprise applications with C#/.NET"],
    });
    const skills = result
      .filter((c) => c.category === "skill" && c.disposition === "require")
      .map((c) => c.value);
    expect(skills).toContain("C#");
    expect(skills).toContain(".NET");
    // Should not contain the raw prose phrase
    expect(skills).not.toContain("Enterprise applications with C#/.NET");
  });

  it("drops YoE phrase from required_skills", () => {
    const result = parsedBriefToConditions({
      required_skills: ["5+ years software development experience"],
    });
    expect(result.filter((c) => c.category === "skill")).toHaveLength(0);
  });

  it("strips 'programming' suffix from skill tokens", () => {
    const result = parsedBriefToConditions({
      required_skills: ["Python programming"],
    });
    const skills = result
      .filter((c) => c.category === "skill" && c.disposition === "require")
      .map((c) => c.value);
    expect(skills).toContain("Python");
    expect(skills).not.toContain("Python programming");
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

  // ── Multi-location + remote flag (P0 Bug 2 regression) ──────────────────────

  it("splits comma-separated cities into separate location chips", () => {
    const result = parsedBriefToConditions({
      location: "San Francisco, Austin",
    });
    const locs = result.filter((c) => c.category === "location");
    expect(locs).toHaveLength(2);
    const locValues = locs.map((c) => c.value);
    expect(locValues.some((v) => v.includes("San Francisco"))).toBe(true);
    expect(locValues.some((v) => v.includes("Austin"))).toBe(true);
  });

  it("treats 'remote' as other/require flag, not a location chip", () => {
    const result = parsedBriefToConditions({
      location: "Remote",
    });
    const locChips = result.filter((c) => c.category === "location");
    const remoteChip = result.find(
      (c) => c.category === "other" && c.value === "remote",
    );
    expect(locChips).toHaveLength(0);
    expect(remoteChip).toBeDefined();
  });

  it("splits multi-city + remote location string into separate chips (P0 Bug 2)", () => {
    const result = parsedBriefToConditions({
      location: "San Francisco, Austin, or fully remote within the United States",
    });
    const locChips = result.filter((c) => c.category === "location");
    const remoteChip = result.find(
      (c) => c.category === "other" && c.value === "remote",
    );
    expect(locChips).toHaveLength(2);
    expect(remoteChip).toBeDefined();
    const locValues = locChips.map((c) => c.value);
    expect(locValues.some((v) => v.includes("San Francisco"))).toBe(true);
    expect(locValues.some((v) => v.includes("Austin"))).toBe(true);
  });

  it("handles slash-separated multi-location (legacy format)", () => {
    const result = parsedBriefToConditions({
      location: "Mumbai / Bangalore",
    });
    const locs = result.filter((c) => c.category === "location");
    expect(locs).toHaveLength(2);
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
    expect(categories).toContain("location/require/Hyderabad");
    expect(categories).toContain("experience_range/require/5-12");
    expect(categories).toContain("skill/require/Java");
    expect(categories).toContain("skill/require/Kafka");
    expect(categories).toContain("skill/require/Microservices");
    expect(categories).toContain("skill/prefer/Kubernetes");
    expect(categories).toContain("company/exclude/IBM");
    expect(categories).toContain("title/exclude/Manager");
  });
});
