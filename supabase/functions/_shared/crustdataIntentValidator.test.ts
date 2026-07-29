// Vitest unit tests for crustdataIntentValidator.
// No Deno imports; runs under Vitest/Node via existing test infrastructure.

import { describe, it, expect } from "vitest";
import {
  validateAndAssembleIntent,
  expandCompanyAcronym,
} from "./crustdataIntentValidator.ts";
import type { VersionedSearchIntent } from "./searchIntent.ts";
import { CRUSTDATA_FIELDS } from "./crustdataCapabilityManifest.ts";

function makeIntent(
  conditions: VersionedSearchIntent["conditions"],
): VersionedSearchIntent {
  return {
    version: 1,
    updated_at: "2026-01-01T00:00:00.000Z",
    conditions,
    unenforceable_constraints: [],
  };
}

// ─── Company acronym expansion ────────────────────────────────────────────────

describe("expandCompanyAcronym", () => {
  it("expands FAANG to real company names", () => {
    const expanded = expandCompanyAcronym("FAANG");
    expect(expanded).toContain("Meta");
    expect(expanded).toContain("Apple");
    expect(expanded).toContain("Amazon");
    expect(expanded).toContain("Netflix");
    expect(expanded).toContain("Google");
    expect(expanded.length).toBeGreaterThanOrEqual(5);
  });

  it("expands MAANG to real company names", () => {
    const expanded = expandCompanyAcronym("MAANG");
    expect(expanded).toContain("Meta");
    expect(expanded).toContain("Google");
    expect(expanded).not.toContain("MAANG");
  });

  it("returns the value unchanged for unknown acronyms", () => {
    expect(expandCompanyAcronym("Stripe")).toEqual(["Stripe"]);
    expect(expandCompanyAcronym("Coupang")).toEqual(["Coupang"]);
  });
});

// ─── Seniority exclude ────────────────────────────────────────────────────────

describe("validateAndAssembleIntent — seniority exclude", () => {
  it("maps exclude seniority:Staff to a not-contains filter on seniority field", () => {
    const intent = makeIntent([
      { category: "seniority", disposition: "exclude", value: "Staff" },
    ]);
    const { filters, unenforceable } = validateAndAssembleIntent(intent);
    expect(unenforceable).toHaveLength(0);
    expect(filters).not.toBeNull();
    // Should contain at least one (!) condition on the seniority field.
    const conds = filters?.conditions ?? [];
    const seniorityExclude = conds.find(
      (c) =>
        "field" in c &&
        c.field === CRUSTDATA_FIELDS.currentSeniorityLevel &&
        c.type === "(!)",
    );
    expect(seniorityExclude).toBeDefined();
    expect((seniorityExclude as { value: string }).value).toBe("Staff");
  });
});

// ─── Company exclude with acronym expansion ───────────────────────────────────

describe("validateAndAssembleIntent — acronym company exclude", () => {
  it("expands FAANG to per-company (!)-excludes on currentCompanyName", () => {
    const intent = makeIntent([
      { category: "company", disposition: "exclude", value: "FAANG" },
    ]);
    const { filters, unenforceable } = validateAndAssembleIntent(intent);
    expect(unenforceable).toHaveLength(0);
    expect(filters).not.toBeNull();
    const conds = filters?.conditions ?? [];
    // Should produce 5 or 6 (!)-conditions for the expanded company names.
    const companyExcludes = conds.filter(
      (c) =>
        "field" in c &&
        c.field === CRUSTDATA_FIELDS.currentCompanyName &&
        c.type === "(!)",
    );
    // At least 5 companies (Meta + Apple + Amazon + Netflix + Google, possibly also Facebook).
    expect(companyExcludes.length).toBeGreaterThanOrEqual(5);
  });

  it("produces a not-contains for a literal company name", () => {
    const intent = makeIntent([
      { category: "company", disposition: "exclude", value: "Coupang" },
    ]);
    const { filters } = validateAndAssembleIntent(intent);
    const conds = filters?.conditions ?? [];
    const exclude = conds.find(
      (c) =>
        "field" in c &&
        c.field === CRUSTDATA_FIELDS.currentCompanyName &&
        c.type === "(!)" &&
        (c as { value: string }).value === "Coupang",
    );
    expect(exclude).toBeDefined();
  });
});

// ─── Skill recency → unenforceable ───────────────────────────────────────────

describe("validateAndAssembleIntent — unenforceable skill recency", () => {
  it("routes '5 years experience in React' to unenforceable_constraints", () => {
    const intent = makeIntent([
      { category: "skill", disposition: "require", value: "5 years experience in React" },
    ]);
    const { filters, unenforceable } = validateAndAssembleIntent(intent);
    expect(unenforceable.length).toBeGreaterThanOrEqual(1);
    expect(unenforceable[0].reason).toMatch(/recency|date|skill-date/i);
    // Should produce no filter for this condition (or an empty filters).
    const conds = filters?.conditions ?? [];
    const skillFilter = conds.find(
      (c) => "field" in c && c.field === CRUSTDATA_FIELDS.skills,
    );
    expect(skillFilter).toBeUndefined();
  });

  it("routes 'recent React experience' to unenforceable_constraints", () => {
    const intent = makeIntent([
      { category: "skill", disposition: "require", value: "recent React experience" },
    ]);
    const { unenforceable } = validateAndAssembleIntent(intent);
    expect(unenforceable.length).toBeGreaterThanOrEqual(1);
  });

  it("allows a plain skill (no recency) through as a filter", () => {
    const intent = makeIntent([
      { category: "skill", disposition: "require", value: "React" },
    ]);
    const { filters, unenforceable } = validateAndAssembleIntent(intent);
    expect(unenforceable).toHaveLength(0);
    const conds = filters?.conditions ?? [];
    const skillFilter = conds.find(
      (c) => "field" in c && c.field === CRUSTDATA_FIELDS.skills,
    );
    expect(skillFilter).toBeDefined();
  });
});

// ─── Prefer → always unenforceable ───────────────────────────────────────────

describe("validateAndAssembleIntent — prefer conditions", () => {
  it("routes all prefer conditions to unenforceable_constraints", () => {
    const intent = makeIntent([
      { category: "skill", disposition: "prefer", value: "Kubernetes" },
      { category: "company", disposition: "prefer", value: "startup background" },
    ]);
    const { filters, unenforceable } = validateAndAssembleIntent(intent);
    expect(unenforceable.length).toBe(2);
    // No filters from prefer conditions.
    expect(filters).toBeNull();
  });
});

// ─── Experience range ─────────────────────────────────────────────────────────

describe("validateAndAssembleIntent — experience_range", () => {
  it("parses 'min:5' format", () => {
    const intent = makeIntent([
      { category: "experience_range", disposition: "require", value: "min:5" },
    ]);
    const { filters, unenforceable } = validateAndAssembleIntent(intent);
    expect(unenforceable).toHaveLength(0);
    const conds = filters?.conditions ?? [];
    const expFilter = conds.find(
      (c) => "field" in c && c.field === CRUSTDATA_FIELDS.yearsOfExperience && c.type === "=>",
    );
    expect(expFilter).toBeDefined();
    expect((expFilter as { value: number }).value).toBe(5);
  });

  it("parses '5-10' range format", () => {
    const intent = makeIntent([
      { category: "experience_range", disposition: "require", value: "5-10" },
    ]);
    const { filters } = validateAndAssembleIntent(intent);
    const conds = filters?.conditions ?? [];
    const gte = conds.find((c) => "field" in c && c.field === CRUSTDATA_FIELDS.yearsOfExperience && c.type === "=>");
    const lte = conds.find((c) => "field" in c && c.field === CRUSTDATA_FIELDS.yearsOfExperience && c.type === "=<");
    expect(gte).toBeDefined();
    expect(lte).toBeDefined();
    expect((gte as { value: number }).value).toBe(5);
    expect((lte as { value: number }).value).toBe(10);
  });
});

// ─── Unenforceable passthrough ────────────────────────────────────────────────

describe("validateAndAssembleIntent — existing unenforceable passthrough", () => {
  it("carries forward unenforceable_constraints from the intent", () => {
    const intent: VersionedSearchIntent = {
      version: 1,
      updated_at: "2026-01-01T00:00:00.000Z",
      conditions: [],
      unenforceable_constraints: [
        { description: "Prefer startup background", reason: "Soft preference" },
      ],
    };
    const { unenforceable } = validateAndAssembleIntent(intent);
    expect(unenforceable.length).toBe(1);
    expect(unenforceable[0].description).toBe("Prefer startup background");
  });
});
