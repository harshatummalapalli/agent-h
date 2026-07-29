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

// ─── Skills (must-have AND) ───────────────────────────────────────────────────

describe("compileFilterDraft – skills", () => {
  it("slash skill alternatives → OR within chip, AND across chips", () => {
    const { filters } = compileFilterDraft({
      skillsRequired: ["LangChain / LangGraph", "Python"],
    });
    expect(filters).not.toBeNull();
    expect(filters!.op).toBe("and");
    // First condition is OR(LangChain, LangGraph); second is Python
    const first = filters!.conditions[0];
    expect("op" in first && first.op === "or").toBe(true);
    if ("op" in first) {
      const vals = first.conditions
        .filter((c): c is CrustdataCondition => "field" in c)
        .map((c) => c.value);
      expect(vals).toContain("LangChain");
      expect(vals).toContain("LangGraph");
    }
    const skillConds = findContains(filters!, CRUSTDATA_FIELDS.skills);
    expect(skillConds.some((c) => c.value === "Python")).toBe(true);
  });

  it("single skill → direct (.) condition", () => {
    const { filters } = compileFilterDraft({ skillsRequired: ["LangChain"] });
    const conds = findContains(filters!, CRUSTDATA_FIELDS.skills);
    expect(conds.some((c) => c.value === "LangChain")).toBe(true);
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

// ─── Multi-country OR ─────────────────────────────────────────────────────────

describe("compileFilterDraft – multi-country OR (locationCountries)", () => {
  it("two countries → OR-group of two exact = conditions", () => {
    const { filters } = compileFilterDraft({
      locationCountries: ["India", "United States"],
    });
    expect(filters).not.toBeNull();
    const orG = filters!.conditions.find(
      (c): c is CrustdataGroup => "op" in c && c.op === "or",
    );
    expect(orG).toBeDefined();
    const vals = orG!.conditions
      .filter((c): c is CrustdataCondition => "field" in c)
      .map((c) => ({ field: c.field, type: c.type, value: c.value }));
    expect(vals.some((v) => v.value === "India" && v.type === "=")).toBe(true);
    expect(
      vals.some((v) => v.value === "United States" && v.type === "="),
    ).toBe(true);
  });

  it("single country in locationCountries → direct = condition (no redundant OR wrapper)", () => {
    const { filters } = compileFilterDraft({
      locationCountries: ["Germany"],
    });
    expect(filters).not.toBeNull();
    const cond = findExact(filters!, CRUSTDATA_FIELDS.locationCountry);
    expect(cond).toBeDefined();
    expect(cond!.value).toBe("Germany");
  });

  it("alias 'us' normalised to 'United States'", () => {
    const { filters } = compileFilterDraft({
      locationCountries: ["us", "India"],
    });
    expect(filters).not.toBeNull();
    const orG = filters!.conditions.find(
      (c): c is CrustdataGroup => "op" in c && c.op === "or",
    );
    const vals = orG!.conditions
      .filter((c): c is CrustdataCondition => "field" in c)
      .map((c) => c.value);
    expect(vals).toContain("United States");
    expect(vals).toContain("India");
  });

  it("locationCountries takes precedence over legacy locationCountry", () => {
    const { filters, appliedGroups } = compileFilterDraft({
      locationCountries: ["Germany"],
      locationCountry: "India",
    });
    // Only 'countries' should be in appliedGroups, not 'country'
    expect(appliedGroups).toContain("countries");
    expect(appliedGroups).not.toContain("country");
    const cond = findExact(filters!, CRUSTDATA_FIELDS.locationCountry);
    expect(cond!.value).toBe("Germany");
  });
});

// ─── Nice-to-have skills (OR) ─────────────────────────────────────────────────

describe("compileFilterDraft – nice-to-have skills OR", () => {
  it("two nice-to-have skills → single OR-group (not two top-level conditions)", () => {
    const { filters } = compileFilterDraft({
      skillsNiceToHave: ["GraphQL", "Redis"],
    });
    expect(filters).not.toBeNull();
    const orG = filters!.conditions.find(
      (c): c is CrustdataGroup => "op" in c && c.op === "or",
    );
    expect(orG).toBeDefined();
    const vals = orG!.conditions
      .filter((c): c is CrustdataCondition => "field" in c)
      .map((c) => c.value);
    expect(vals).toContain("GraphQL");
    expect(vals).toContain("Redis");
    // Must NOT be multiple top-level conditions (that would be AND)
    const topLevelSkillConds = filters!.conditions.filter(
      (c): c is CrustdataCondition =>
        "field" in c && c.field === CRUSTDATA_FIELDS.skills,
    );
    expect(topLevelSkillConds.length).toBe(0);
  });

  it("must-have AND nice-to-have produce distinct structures", () => {
    // Use 2 nice-to-have skills so they form an OR group (single would be unwrapped)
    const { filters } = compileFilterDraft({
      skillsRequired: ["Python"],
      skillsNiceToHave: ["GraphQL", "Redis"],
    });
    expect(filters).not.toBeNull();
    // must-have: direct (.) condition at top level (not inside an OR group)
    const directRequiredConds = filters!.conditions.filter(
      (c): c is CrustdataCondition =>
        "field" in c && c.field === CRUSTDATA_FIELDS.skills && c.type === "(.)",
    );
    expect(directRequiredConds.length).toBe(1);
    expect(directRequiredConds[0].value).toBe("Python");
    // nice-to-have: inside an OR group (not a direct top-level condition)
    const orG = filters!.conditions.find(
      (c): c is CrustdataGroup =>
        "op" in c &&
        c.op === "or" &&
        c.conditions.some(
          (i): boolean =>
            "field" in i &&
            i.field === CRUSTDATA_FIELDS.skills &&
            (i as CrustdataCondition).value === "GraphQL",
        ),
    );
    expect(orG).toBeDefined();
  });
});

// ─── Multi-seniority OR ───────────────────────────────────────────────────────

describe("compileFilterDraft – currentSeniorities OR", () => {
  it("two seniorities → OR-group of (.) conditions", () => {
    const { filters } = compileFilterDraft({
      currentSeniorities: ["Senior", "Lead"],
    });
    expect(filters).not.toBeNull();
    const orG = filters!.conditions.find(
      (c): c is CrustdataGroup =>
        "op" in c &&
        c.op === "or" &&
        c.conditions.some(
          (i): boolean =>
            "field" in i && i.field === CRUSTDATA_FIELDS.currentSeniorityLevel,
        ),
    );
    expect(orG).toBeDefined();
  });
});

// ─── Past company include ─────────────────────────────────────────────────────

describe("compileFilterDraft – pastCompaniesInclude OR", () => {
  it("two past companies → OR-group of (.) conditions on past company field", () => {
    const { filters } = compileFilterDraft({
      pastCompaniesInclude: ["Google", "Meta"],
    });
    expect(filters).not.toBeNull();
    const orG = filters!.conditions.find(
      (c): c is CrustdataGroup =>
        "op" in c &&
        c.op === "or" &&
        c.conditions.some(
          (i): boolean =>
            "field" in i &&
            i.field === CRUSTDATA_FIELDS.pastCompanyName &&
            i.type === "(.)",
        ),
    );
    expect(orG).toBeDefined();
    const vals = orG!.conditions
      .filter((c): c is CrustdataCondition => "field" in c)
      .map((c) => c.value);
    expect(vals).toContain("Google");
    expect(vals).toContain("Meta");
  });
});

// ─── Education ────────────────────────────────────────────────────────────────

describe("compileFilterDraft – education filters", () => {
  it("educationSchools → OR-group of (.) on education.schools.school", () => {
    const { filters, appliedGroups } = compileFilterDraft({
      educationSchools: ["MIT", "Stanford"],
    });
    expect(filters).not.toBeNull();
    expect(appliedGroups).toContain("education schools");
    const schoolConds = findContains(
      filters!,
      CRUSTDATA_FIELDS.educationSchool,
    );
    expect(schoolConds.some((c) => c.value === "MIT")).toBe(true);
    expect(schoolConds.some((c) => c.value === "Stanford")).toBe(true);
  });

  it("educationDegrees → OR-group of (.) on education.schools.degree", () => {
    const { filters, appliedGroups } = compileFilterDraft({
      educationDegrees: ["MBA", "Bachelor"],
    });
    expect(filters).not.toBeNull();
    expect(appliedGroups).toContain("education degrees");
    const degreeConds = findContains(
      filters!,
      CRUSTDATA_FIELDS.educationDegree,
    );
    expect(degreeConds.length).toBeGreaterThan(0);
  });

  it("educationFieldsOfStudy → OR-group on education.schools.field_of_study", () => {
    const { filters, appliedGroups } = compileFilterDraft({
      educationFieldsOfStudy: ["Computer Science"],
    });
    expect(appliedGroups).toContain("education fields of study");
    const conds = findContains(
      filters!,
      CRUSTDATA_FIELDS.educationFieldOfStudy,
    );
    expect(conds.length).toBeGreaterThan(0);
  });
});

// ─── Languages ────────────────────────────────────────────────────────────────

describe("compileFilterDraft – languages OR", () => {
  it("two languages → OR-group of (.) on basic_profile.languages", () => {
    const { filters, appliedGroups } = compileFilterDraft({
      languages: ["English", "Spanish"],
    });
    expect(filters).not.toBeNull();
    expect(appliedGroups).toContain("languages");
    const langConds = findContains(filters!, CRUSTDATA_FIELDS.languages);
    expect(langConds.some((c) => c.value === "English")).toBe(true);
    expect(langConds.some((c) => c.value === "Spanish")).toBe(true);
  });
});

// ─── Headline keywords ────────────────────────────────────────────────────────

describe("compileFilterDraft – headline keywords", () => {
  it("headlineKeywordsInclude → OR-group of (.) on basic_profile.headline", () => {
    const { filters, appliedGroups } = compileFilterDraft({
      headlineKeywordsInclude: ["AI", "ML"],
    });
    expect(appliedGroups).toContain("headline include");
    const conds = findContains(filters!, CRUSTDATA_FIELDS.headline);
    expect(conds.some((c) => c.value === "AI")).toBe(true);
    expect(conds.some((c) => c.value === "ML")).toBe(true);
  });

  it("headlineKeywordsExclude → (!) conditions at top level", () => {
    const { filters, appliedGroups } = compileFilterDraft({
      headlineKeywordsExclude: ["Intern"],
    });
    expect(appliedGroups).toContain("headline exclude");
    const excl = findNotContains(filters!, CRUSTDATA_FIELDS.headline);
    expect(excl.some((c) => c.value === "Intern")).toBe(true);
  });
});

// ─── Connections min ─────────────────────────────────────────────────────────

describe("compileFilterDraft – connectionsMin", () => {
  it("connectionsMin → => condition on professional_network.connections", () => {
    const { filters, appliedGroups } = compileFilterDraft({
      connectionsMin: 500,
    });
    expect(appliedGroups).toContain("connections min");
    const cond = filters!.conditions.find(
      (c): c is CrustdataCondition =>
        "field" in c &&
        c.field === CRUSTDATA_FIELDS.connections &&
        c.type === "=>",
    );
    expect(cond).toBeDefined();
    expect(cond!.value).toBe(500);
  });

  it("connectionsMin=0 is ignored", () => {
    const { filters } = compileFilterDraft({ connectionsMin: 0 });
    expect(filters).toBeNull();
  });
});

// ─── Company HQ country ───────────────────────────────────────────────────────

describe("compileFilterDraft – companyHQCountry", () => {
  it("companyHQCountry uppercased → exact = on company_headquarters_country", () => {
    const { filters, appliedGroups } = compileFilterDraft({
      companyHQCountry: "usa",
    });
    expect(appliedGroups).toContain("company HQ country");
    const cond = filters!.conditions.find(
      (c): c is CrustdataCondition =>
        "field" in c &&
        c.field === CRUSTDATA_FIELDS.currentCompanyHQCountry &&
        c.type === "=",
    );
    expect(cond).toBeDefined();
    expect(cond!.value).toBe("USA");
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
