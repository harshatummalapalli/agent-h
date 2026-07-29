import { describe, it, expect } from "vitest";
import { intentToDraft } from "./BuildSearchTab";
import type { VersionedSearchIntent } from "../types";

function makeIntent(
  conditions: { category: string; disposition: string; value: string }[],
): VersionedSearchIntent {
  return {
    version: 1,
    updated_at: "2026-01-01T00:00:00Z",
    conditions: conditions as VersionedSearchIntent["conditions"],
    unenforceable_constraints: [],
  };
}

describe("intentToDraft", () => {
  it("returns empty draft for undefined intent", () => {
    expect(intentToDraft(undefined)).toEqual({});
  });

  it("maps company require → currentCompaniesInclude", () => {
    const draft = intentToDraft(
      makeIntent([
        { category: "company", disposition: "require", value: "Stripe" },
        { category: "company", disposition: "require", value: "Brex" },
      ]),
    );
    expect(draft.currentCompaniesInclude).toEqual(["Stripe", "Brex"]);
    expect(draft.currentCompaniesExclude).toBeUndefined();
  });

  it("maps company exclude → currentCompaniesExclude", () => {
    const draft = intentToDraft(
      makeIntent([
        { category: "company", disposition: "exclude", value: "Google" },
        { category: "company", disposition: "exclude", value: "Meta" },
      ]),
    );
    expect(draft.currentCompaniesExclude).toEqual(["Google", "Meta"]);
    expect(draft.currentCompaniesInclude).toBeUndefined();
  });

  it("maps skill prefer → skillsNiceToHave", () => {
    const draft = intentToDraft(
      makeIntent([
        { category: "skill", disposition: "prefer", value: "GraphQL" },
        { category: "skill", disposition: "require", value: "TypeScript" },
      ]),
    );
    expect(draft.skillsNiceToHave).toEqual(["GraphQL"]);
    expect(draft.skillsRequired).toEqual(["TypeScript"]);
  });

  it("maps multiple locations to arrays (not just first)", () => {
    const draft = intentToDraft(
      makeIntent([
        { category: "location", disposition: "require", value: "India" },
        {
          category: "location",
          disposition: "require",
          value: "Bangalore (India)",
        },
        {
          category: "location",
          disposition: "require",
          value: "Mumbai (India)",
        },
      ]),
    );
    expect(draft.locationCountries).toContain("India");
    expect(draft.locationCities).toEqual(
      expect.arrayContaining(["Bangalore", "Mumbai"]),
    );
    expect(draft.locationCities?.length).toBeGreaterThanOrEqual(2);
  });

  it("maps title require/exclude and skill require", () => {
    const draft = intentToDraft(
      makeIntent([
        {
          category: "title",
          disposition: "require",
          value: "Software Engineer",
        },
        { category: "title", disposition: "exclude", value: "Intern" },
        { category: "skill", disposition: "require", value: "Python" },
      ]),
    );
    expect(draft.currentTitlesInclude).toEqual(["Software Engineer"]);
    expect(draft.currentTitlesExclude).toEqual(["Intern"]);
    expect(draft.skillsRequired).toEqual(["Python"]);
  });
});
