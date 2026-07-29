// Vitest unit tests for crustdataFilterCompiler.
// No Deno imports; runs under Vitest/Node via existing test infrastructure.

import { describe, it, expect } from "vitest";
import { compileFilterDraft } from "./crustdataFilterCompiler.ts";
import type {
  CrustdataCondition,
  CrustdataGroup,
  FilterDraft,
} from "./crustdataFilterCompiler.ts";
import { CRUSTDATA_FIELDS } from "./crustdataCapabilityManifest.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findExact(
  filters: CrustdataGroup,
  field: string,
): CrustdataCondition | undefined {
  for (const c of filters.conditions) {
    if ("field" in c && c.field === field && c.type === "=") return c;
  }
  return undefined;
}

function findContains(
  filters: CrustdataGroup,
  field: string,
): Array<CrustdataCondition> {
  const results: CrustdataCondition[] = [];
  for (const c of filters.conditions) {
    if ("field" in c && c.field === field && c.type === "(.)") results.push(c);
    if ("op" in c) {
      for (const inner of c.conditions) {
        if ("field" in inner && inner.field === field && inner.type === "(.)") {
          results.push(inner);
        }
      }
    }
  }
  return results;
}

function findNotContains(
  filters: CrustdataGroup,
  field: string,
): Array<CrustdataCondition> {
  const results: CrustdataCondition[] = [];
  for (const c of filters.conditions) {
    if ("field" in c && c.field === field && c.type === "(!)") results.push(c);
  }
  return results;
}

// ─── Empty draft ──────────────────────────────────────────────────────────────

describe("compileFilterDraft – empty draft", () => {
  it("returns null filters for empty object", () => {
    const { filters } = compileFilterDraft({});
    expect(filters).toBeNull();
  });

  it("returns null filters for all-empty arrays", () => {
    const { filters } = compileFilterDraft({
      currentTitlesInclude: [],
      currentTitlesExclude: [],
      skillsRequired: [],
    });
    expect(filters).toBeNull();
  });
});

// ─── Country exact match ──────────────────────────────────────────────────────

describe("compileFilterDraft – country", () => {
  it("emits exact = condition for locationCountry", () => {
    const { filters } = compileFilterDraft({ locationCountry: "India" });
    expect(filters).not.toBeNull();
    const cond = findExact(filters!, CRUSTDATA_FIELDS.locationCountry);
    expect(cond).toBeDefined();
    expect(cond!.value).toBe("India");
  });

  it("trims whitespace from country value", () => {
    const { filters } = compileFilterDraft({
      locationCountry: "  United States  ",
    });
    const cond = findExact(filters!, CRUSTDATA_FIELDS.locationCountry);
    expect(cond!.value).toBe("United States");
  });

  it("includes country in appliedGroups", () => {
    const { appliedGroups } = compileFilterDraft({ locationCountry: "India" });
    expect(appliedGroups).toContain("country");
  });
});

// ─── Current title include — OR group ─────────────────────────────────────────

describe("compileFilterDraft – current title include", () => {
  it("single short title → single (.) condition (no extra OR wrapper)", () => {
    const { filters } = compileFilterDraft({
      currentTitlesInclude: ["Security Engineer"],
    });
    expect(filters).not.toBeNull();
    // "Security Engineer" is 2 words → no shingle decomp, single (.) directly
    const conds = findContains(filters!, CRUSTDATA_FIELDS.currentTitle);
    expect(conds.length).toBeGreaterThan(0);
    expect(conds.some((c) => c.value === "Security Engineer")).toBe(true);
  });

  it("multiple titles → OR group of (.) conditions", () => {
    const { filters } = compileFilterDraft({
      currentTitlesInclude: ["Security Analyst", "Incident Responder"],
    });
    expect(filters).not.toBeNull();
    // Should find an OR group containing both
    const orG = filters!.conditions.find(
      (c): c is CrustdataGroup => "op" in c && c.op === "or",
    );
    expect(orG).toBeDefined();
    const values = orG!.conditions
      .filter((c): c is CrustdataCondition => "field" in c)
      .map((c) => c.value);
    expect(values).toContain("Security Analyst");
    expect(values).toContain("Incident Responder");
  });

  it("long title phrase (>2 words) is shingle-decomposed into 2-word OR conditions", () => {
    const { filters } = compileFilterDraft({
      currentTitlesInclude: ["Cyber Incident Response Engineer"],
    });
    expect(filters).not.toBeNull();
    const titleConds = findContains(filters!, CRUSTDATA_FIELDS.currentTitle);
    // Decomposed: "Cyber Incident", "Incident Response", "Response Engineer"
    expect(titleConds.some((c) => c.value === "Cyber Incident")).toBe(true);
    expect(titleConds.some((c) => c.value === "Incident Response")).toBe(true);
    expect(titleConds.some((c) => c.value === "Response Engineer")).toBe(true);
  });
});

// ─── Title exclusions ─────────────────────────────────────────────────────────

describe("compileFilterDraft – title exclusions", () => {
  it("each exclusion keyword → separate (!) condition AND'd at top level", () => {
    const { filters } = compileFilterDraft({
      currentTitlesExclude: ["Manager", "Director"],
    });
    expect(filters).not.toBeNull();
    const excl = findNotContains(filters!, CRUSTDATA_FIELDS.currentTitle);
    expect(excl.some((c) => c.value === "Manager")).toBe(true);
    expect(excl.some((c) => c.value === "Director")).toBe(true);
  });

  it("includes 'current title exclude' in appliedGroups", () => {
    const { appliedGroups } = compileFilterDraft({
      currentTitlesExclude: ["Manager"],
    });
    expect(appliedGroups).toContain("current title exclude");
  });
});

// ─── Skills OR-group ──────────────────────────────────────────────────────────

describe("compileFilterDraft – skills", () => {
  it("multiple skills → OR group (any-of, not all-of)", () => {
    const { filters } = compileFilterDraft({
      skillsRequired: ["Python", "Kubernetes", "Security"],
    });
    expect(filters).not.toBeNull();
    const orG = filters!.conditions.find(
      (c): c is CrustdataGroup =>
        "op" in c &&
        c.op === "or" &&
        c.conditions.some(
          (i): boolean => "field" in i && i.field === CRUSTDATA_FIELDS.skills,
        ),
    );
    expect(orG).toBeDefined();
    const vals = orG!.conditions
      .filter((c): c is CrustdataCondition => "field" in c)
      .map((c) => c.value);
    expect(vals).toContain("Python");
    expect(vals).toContain("Kubernetes");
    expect(vals).toContain("Security");
  });

  it("single skill → direct (.) condition, no OR wrapper", () => {
    const { filters } = compileFilterDraft({ skillsRequired: ["Python"] });
    const conds = findContains(filters!, CRUSTDATA_FIELDS.skills);
    expect(conds.some((c) => c.value === "Python")).toBe(true);
  });
});

// ─── Years of experience ──────────────────────────────────────────────────────

describe("compileFilterDraft – yoe", () => {
  it("yoeMin → => condition", () => {
    const { filters } = compileFilterDraft({ yoeMin: 5 });
    expect(filters).not.toBeNull();
    const cond = filters!.conditions.find(
      (c): c is CrustdataCondition =>
        "field" in c &&
        c.field === CRUSTDATA_FIELDS.yearsOfExperience &&
        c.type === "=>",
    );
    expect(cond).toBeDefined();
    expect(cond!.value).toBe(5);
  });

  it("yoeMax → =< condition", () => {
    const { filters } = compileFilterDraft({ yoeMax: 10 });
    const cond = filters!.conditions.find(
      (c): c is CrustdataCondition =>
        "field" in c &&
        c.field === CRUSTDATA_FIELDS.yearsOfExperience &&
        c.type === "=<",
    );
    expect(cond).toBeDefined();
    expect(cond!.value).toBe(10);
  });

  it("both yoeMin and yoeMax → two numeric conditions", () => {
    const { filters } = compileFilterDraft({ yoeMin: 5, yoeMax: 15 });
    const yoeConds = filters!.conditions.filter(
      (c): c is CrustdataCondition =>
        "field" in c && c.field === CRUSTDATA_FIELDS.yearsOfExperience,
    );
    expect(yoeConds.length).toBe(2);
  });

  it("yoeMin=0 is ignored", () => {
    const { filters } = compileFilterDraft({ yoeMin: 0 });
    expect(filters).toBeNull();
  });
});

// ─── Company include/exclude ──────────────────────────────────────────────────

describe("compileFilterDraft – company", () => {
  it("company includes → OR group of (.) conditions", () => {
    const { filters } = compileFilterDraft({
      currentCompaniesInclude: ["Palo Alto Networks", "CrowdStrike"],
    });
    expect(filters).not.toBeNull();
    const orG = filters!.conditions.find(
      (c): c is CrustdataGroup =>
        "op" in c &&
        c.op === "or" &&
        c.conditions.some(
          (i): boolean =>
            "field" in i &&
            i.field === CRUSTDATA_FIELDS.currentCompanyName &&
            i.type === "(.)",
        ),
    );
    expect(orG).toBeDefined();
  });

  it("company excludes → (!) conditions at top level", () => {
    const { filters } = compileFilterDraft({
      currentCompaniesExclude: ["Google", "Meta"],
    });
    const excl = findNotContains(filters!, CRUSTDATA_FIELDS.currentCompanyName);
    expect(excl.some((c) => c.value === "Google")).toBe(true);
    expect(excl.some((c) => c.value === "Meta")).toBe(true);
  });
});

// ─── Complex combined draft ───────────────────────────────────────────────────

describe("compileFilterDraft – combined (India cyber security role)", () => {
  const draft: FilterDraft = {
    currentTitlesInclude: ["Security Analyst", "Incident Response"],
    currentTitlesExclude: ["Manager", "Director"],
    locationCountry: "India",
    locationCity: "Hyderabad",
    skillsRequired: ["SIEM", "Threat Intelligence"],
    seniority: "Senior",
    yoeMin: 4,
    yoeMax: 12,
    currentCompaniesExclude: ["TCS", "Infosys"],
  };

  it("compiles without throwing", () => {
    expect(() => compileFilterDraft(draft)).not.toThrow();
  });

  it("filters is non-null AND root op is 'and'", () => {
    const { filters } = compileFilterDraft(draft);
    expect(filters).not.toBeNull();
    expect(filters!.op).toBe("and");
  });

  it("country is exactly India", () => {
    const { filters } = compileFilterDraft(draft);
    const cond = findExact(filters!, CRUSTDATA_FIELDS.locationCountry);
    expect(cond!.value).toBe("India");
  });

  it("title exclusions are present", () => {
    const { filters } = compileFilterDraft(draft);
    const excl = findNotContains(filters!, CRUSTDATA_FIELDS.currentTitle);
    expect(excl.some((c) => c.value === "Manager")).toBe(true);
    expect(excl.some((c) => c.value === "Director")).toBe(true);
  });

  it("appliedGroups covers all populated fields", () => {
    const { appliedGroups } = compileFilterDraft(draft);
    expect(appliedGroups).toContain("current title include");
    expect(appliedGroups).toContain("current title exclude");
    expect(appliedGroups).toContain("country");
    expect(appliedGroups).toContain("city");
    expect(appliedGroups).toContain("skills");
    expect(appliedGroups).toContain("seniority");
    expect(appliedGroups).toContain("yoe min");
    expect(appliedGroups).toContain("yoe max");
    expect(appliedGroups).toContain("current company exclude");
  });
});
