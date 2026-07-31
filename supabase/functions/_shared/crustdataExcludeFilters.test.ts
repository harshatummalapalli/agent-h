import { describe, it, expect } from "vitest";
import {
  EXCLUDE_FIELDS,
  buildExcludeCondition,
  appendCompanyAndKeywordExcludes,
} from "./crustdataExcludeFilters";

// ── buildExcludeCondition ──────────────────────────────────────────────────────

describe("buildExcludeCondition", () => {
  it("produces a (!) condition with the given field and trimmed phrase", () => {
    const cond = buildExcludeCondition(
      EXCLUDE_FIELDS.currentCompanyName,
      "Cognizant",
    );
    expect(cond).toEqual({
      field: "experience.employment_details.current.company_name",
      type: "(!)",
      value: "Cognizant",
    });
  });

  it("trims leading/trailing whitespace from the phrase", () => {
    const cond = buildExcludeCondition(
      EXCLUDE_FIELDS.currentTitle,
      "  Manager  ",
    );
    expect(cond.value).toBe("Manager");
  });

  it("uses the skills field path correctly", () => {
    const cond = buildExcludeCondition(EXCLUDE_FIELDS.skills, "Recruiter");
    expect(cond.field).toBe("skills.professional_network_skills");
    expect(cond.type).toBe("(!)");
  });
});

// ── appendCompanyAndKeywordExcludes ───────────────────────────────────────────

type AnyCondition = { field: string; type: string; value: unknown };

describe("appendCompanyAndKeywordExcludes — excluded companies", () => {
  it("pushes one (!) condition on currentCompanyName per excluded company", () => {
    const conditions: AnyCondition[] = [];
    appendCompanyAndKeywordExcludes(conditions, {
      excludedCompanies: ["Cognizant", "TCS"],
    });
    const companyExcludes = conditions.filter(
      (c) => c.type === "(!)" && c.field === EXCLUDE_FIELDS.currentCompanyName,
    );
    expect(companyExcludes).toHaveLength(2);
    expect(companyExcludes.map((c) => c.value)).toContain("Cognizant");
    expect(companyExcludes.map((c) => c.value)).toContain("TCS");
  });

  it("skips blank company strings", () => {
    const conditions: AnyCondition[] = [];
    appendCompanyAndKeywordExcludes(conditions, {
      excludedCompanies: ["", "  ", "Infosys"],
    });
    expect(conditions).toHaveLength(1);
    expect(conditions[0].value).toBe("Infosys");
  });

  it("does nothing when excludedCompanies is null", () => {
    const conditions: AnyCondition[] = [];
    appendCompanyAndKeywordExcludes(conditions, { excludedCompanies: null });
    expect(conditions).toHaveLength(0);
  });

  it("does nothing when excludedCompanies is undefined", () => {
    const conditions: AnyCondition[] = [];
    appendCompanyAndKeywordExcludes(conditions, {});
    expect(conditions).toHaveLength(0);
  });

  it("does nothing when excludedCompanies is an empty array", () => {
    const conditions: AnyCondition[] = [];
    appendCompanyAndKeywordExcludes(conditions, { excludedCompanies: [] });
    expect(conditions).toHaveLength(0);
  });
});

describe("appendCompanyAndKeywordExcludes — exclusion keywords", () => {
  it("pushes (!) conditions on BOTH currentTitle AND skills for each keyword", () => {
    const conditions: AnyCondition[] = [];
    appendCompanyAndKeywordExcludes(conditions, {
      exclusionKeywords: ["Manager", "Director"],
    });

    const titleExcludes = conditions.filter(
      (c) => c.type === "(!)" && c.field === EXCLUDE_FIELDS.currentTitle,
    );
    const skillExcludes = conditions.filter(
      (c) => c.type === "(!)" && c.field === EXCLUDE_FIELDS.skills,
    );

    expect(titleExcludes).toHaveLength(2);
    expect(skillExcludes).toHaveLength(2);
    expect(titleExcludes.map((c) => c.value)).toContain("Manager");
    expect(titleExcludes.map((c) => c.value)).toContain("Director");
    expect(skillExcludes.map((c) => c.value)).toContain("Manager");
    expect(skillExcludes.map((c) => c.value)).toContain("Director");
  });

  it("skips blank keyword strings", () => {
    const conditions: AnyCondition[] = [];
    appendCompanyAndKeywordExcludes(conditions, {
      exclusionKeywords: ["", "  ", "Recruiter"],
    });
    // "Recruiter" → 2 conditions (title + skills)
    expect(conditions).toHaveLength(2);
  });

  it("does nothing when exclusionKeywords is null", () => {
    const conditions: AnyCondition[] = [];
    appendCompanyAndKeywordExcludes(conditions, { exclusionKeywords: null });
    expect(conditions).toHaveLength(0);
  });
});

describe("appendCompanyAndKeywordExcludes — combined", () => {
  it("emits correct total: N company + M*2 keyword conditions", () => {
    const conditions: AnyCondition[] = [];
    appendCompanyAndKeywordExcludes(conditions, {
      excludedCompanies: ["Wipro"], // +1
      exclusionKeywords: ["Manager", "VP"], // +2*2 = +4
    });
    // total = 1 + 4 = 5
    expect(conditions).toHaveLength(5);
  });

  it("conditions with existing items in the array are appended, not replaced", () => {
    const existing: AnyCondition[] = [
      { field: "some.field", type: "=", value: "x" },
    ];
    appendCompanyAndKeywordExcludes(existing, {
      excludedCompanies: ["Cognizant"],
    });
    expect(existing).toHaveLength(2);
    expect(existing[0].field).toBe("some.field");
  });

  it("field paths match queryBuilder CRUSTDATA_FIELDS exactly", () => {
    // Regression: if field paths diverge, query-layer excludes silently stop working.
    expect(EXCLUDE_FIELDS.currentCompanyName).toBe(
      "experience.employment_details.current.company_name",
    );
    expect(EXCLUDE_FIELDS.currentTitle).toBe(
      "experience.employment_details.current.title",
    );
    expect(EXCLUDE_FIELDS.skills).toBe("skills.professional_network_skills");
  });
});
