// crustdataDocsParity.test.ts — Crustdata docs examples parity fixtures.
//
// Each test compiles a FilterDraft that mirrors a Crustdata docs example
// (https://docs.crustdata.com, 2026-07) and asserts the compiled output shape.
// Tests run under Vitest/Node with no Deno imports.

import { describe, it, expect } from "vitest";
import { compileFilterDraft } from "./crustdataFilterCompiler.ts";
import type {
  CrustdataCondition,
  CrustdataGroup,
  CrustdataGeoValue,
} from "./crustdataFilterCompiler.ts";
import { CRUSTDATA_FIELDS } from "./crustdataCapabilityManifest.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findCond(
  filters: CrustdataGroup,
  field: string,
  type?: CrustdataCondition["type"],
): CrustdataCondition | undefined {
  for (const c of filters.conditions) {
    if ("field" in c && c.field === field) {
      if (!type || c.type === type) return c;
    }
    if ("op" in c) {
      for (const inner of c.conditions) {
        if ("field" in inner && inner.field === field) {
          if (!type || inner.type === type) return inner as CrustdataCondition;
        }
      }
    }
  }
  return undefined;
}

function findAllConds(
  filters: CrustdataGroup,
  field: string,
  type?: CrustdataCondition["type"],
): CrustdataCondition[] {
  const results: CrustdataCondition[] = [];
  for (const c of filters.conditions) {
    if ("field" in c && c.field === field) {
      if (!type || c.type === type) results.push(c);
    }
    if ("op" in c) {
      for (const inner of c.conditions) {
        if ("field" in inner && inner.field === field) {
          if (!type || inner.type === type)
            results.push(inner as CrustdataCondition);
        }
      }
    }
  }
  return results;
}

// ─── Test 1: Skills + education (Stanford + machine learning) ─────────────────

describe("docs parity 1 — skills + education (Stanford / ML)", () => {
  const { filters, appliedGroups } = compileFilterDraft({
    skillsRequired: ["machine learning", "Python"],
    educationSchools: ["Stanford University"],
    locationCountries: ["United States"],
  });

  it("compiles to non-null and-group", () => {
    expect(filters).not.toBeNull();
    expect(filters!.op).toBe("and");
  });

  it("includes skill conditions (must-have AND)", () => {
    expect(appliedGroups).toContain("skills");
    const mlConds = findAllConds(filters!, CRUSTDATA_FIELDS.skills, "(.)");
    expect(mlConds.some((c) => c.value === "machine learning")).toBe(true);
    const pyConds = findAllConds(filters!, CRUSTDATA_FIELDS.skills, "(.)");
    expect(pyConds.some((c) => c.value === "Python")).toBe(true);
  });

  it("includes Stanford school condition", () => {
    expect(appliedGroups).toContain("education schools");
    const schoolCond = findCond(
      filters!,
      CRUSTDATA_FIELDS.educationSchool,
      "(.)",
    );
    expect(schoolCond).toBeDefined();
    expect(schoolCond!.value).toBe("Stanford University");
  });

  it("includes US country condition", () => {
    expect(appliedGroups).toContain("countries");
    const countryCond = findCond(
      filters!,
      CRUSTDATA_FIELDS.locationCountry,
      "=",
    );
    expect(countryCond).toBeDefined();
    expect(countryCond!.value).toBe("United States");
  });
});

// ─── Test 2: recently_changed_jobs = true ─────────────────────────────────────

describe("docs parity 2 — recently_changed_jobs = true", () => {
  const { filters, appliedGroups } = compileFilterDraft({
    recentlyChangedJobs: true,
    currentTitlesInclude: ["Software Engineer"],
  });

  it("emits recently_changed_jobs = true condition", () => {
    expect(appliedGroups).toContain("recently changed jobs");
    const cond = findCond(filters!, CRUSTDATA_FIELDS.recentlyChangedJobs, "=");
    expect(cond).toBeDefined();
    expect(cond!.value).toBe(true);
  });

  it("also includes title condition", () => {
    expect(appliedGroups).toContain("current title include");
  });
});

// ─── Test 3: geo_distance near San Francisco 10 mi + title CTO ────────────────

describe("docs parity 3 — geo_distance near San Francisco 10 mi + title CTO", () => {
  // Use separate OR titles (not pipe-joined)
  const { filters, appliedGroups } = compileFilterDraft({
    currentTitlesInclude: ["CTO", "Chief Technology Officer"],
    geoNear: "San Francisco, CA",
    geoDistance: 10,
    geoUnit: "mi",
  });

  it("emits geo_distance condition with correct shape", () => {
    expect(appliedGroups).toContain("geo distance");
    const geoCond = filters!.conditions.find(
      (c): c is CrustdataCondition => "field" in c && c.type === "geo_distance",
    );
    expect(geoCond).toBeDefined();
    const val = geoCond!.value as CrustdataGeoValue;
    expect(val.location).toBe("San Francisco, CA");
    expect(val.distance).toBe(10);
    expect(val.unit).toBe("mi");
  });

  it("titles are separate OR conditions (not pipe-joined)", () => {
    expect(appliedGroups).toContain("current title include");
    // Find the OR group or the direct conditions for title
    const titleConds = findAllConds(filters!, CRUSTDATA_FIELDS.currentTitle);
    expect(titleConds.some((c) => c.value === "CTO")).toBe(true);
    expect(titleConds.some((c) => c.value === "Chief Technology Officer")).toBe(
      true,
    );
  });

  it("root is an AND group", () => {
    expect(filters!.op).toBe("and");
  });
});

// ─── Test 4: open_to_cards CAREER_INTEREST via "in" ─────────────────────────

describe("docs parity 4 — open_to_cards CAREER_INTEREST via in", () => {
  const { filters, appliedGroups } = compileFilterDraft({
    openToCards: ["CAREER_INTEREST"],
    locationCountries: ["India"],
  });

  it("emits single in condition for open_to_cards", () => {
    expect(appliedGroups).toContain("open-to cards");
    const cond = findCond(filters!, CRUSTDATA_FIELDS.openToCards, "in");
    expect(cond).toBeDefined();
    expect(cond!.value).toEqual(["CAREER_INTEREST"]);
  });

  it("country condition also present", () => {
    expect(appliedGroups).toContain("countries");
  });
});

// ─── Test 5: company website domain stripe.com ────────────────────────────────

describe("docs parity 5 — company website domain stripe.com", () => {
  const { filters, appliedGroups } = compileFilterDraft({
    currentCompanyDomains: ["stripe.com"],
    currentTitlesInclude: ["Engineer"],
  });

  it("emits = condition for single domain", () => {
    expect(appliedGroups).toContain("company domain");
    const cond = findCond(
      filters!,
      CRUSTDATA_FIELDS.currentCompanyWebsiteDomain,
      "=",
    );
    expect(cond).toBeDefined();
    expect(cond!.value).toBe("stripe.com");
  });
});

// ─── Test 6: exact_phrase title uses [.] ─────────────────────────────────────

describe("docs parity 6 — exact_phrase title uses [.]", () => {
  const { filters, appliedGroups } = compileFilterDraft({
    currentTitlesInclude: ["Head of Engineering"],
    titleMatchMode: "exact_phrase",
  });

  it("emits [.] condition for title when exact_phrase mode", () => {
    expect(appliedGroups).toContain("current title include");
    // Look for [.] condition directly or inside an OR group
    const directExact = filters!.conditions.find(
      (c): c is CrustdataCondition =>
        "field" in c &&
        c.field === CRUSTDATA_FIELDS.currentTitle &&
        c.type === "[.]",
    );
    const inGroup = filters!.conditions.find(
      (c): c is CrustdataGroup =>
        "op" in c &&
        c.conditions.some(
          (i): boolean =>
            "field" in i &&
            i.field === CRUSTDATA_FIELDS.currentTitle &&
            (i as CrustdataCondition).type === "[.]",
        ),
    );
    expect(directExact ?? inGroup).toBeDefined();
  });

  it("does NOT use (.) for the title in exact_phrase mode", () => {
    const dotConds = findAllConds(
      filters!,
      CRUSTDATA_FIELDS.currentTitle,
      "(.)",
    );
    expect(dotConds.length).toBe(0);
  });
});

// ─── Test 7: sorts for followers desc when sortField set ─────────────────────

describe("docs parity 7 — sorts for followers desc when sortField set", () => {
  const result = compileFilterDraft({
    currentTitlesInclude: ["Data Scientist"],
    locationCountries: ["India"],
    sortField: "professional_network.followers",
    sortOrder: "desc",
  });

  it("sorts array is present with correct field and order", () => {
    expect(result.sorts).toBeDefined();
    expect(result.sorts).toHaveLength(1);
    expect(result.sorts![0].field).toBe("professional_network.followers");
    expect(result.sorts![0].order).toBe("desc");
  });

  it("filters are still compiled (sorts don't suppress filters)", () => {
    expect(result.filters).not.toBeNull();
    expect(result.appliedGroups).toContain("current title include");
    expect(result.appliedGroups).toContain("countries");
  });
});
