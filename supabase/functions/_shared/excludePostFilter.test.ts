import { describe, it, expect } from "vitest";
import {
  applyExcludeFilter,
  excludeConditionsFromFlat,
} from "./excludePostFilter.ts";
import type { SearchIntentCondition } from "./searchIntent.ts";

type TestCandidate = {
  current_employer_company_name?: string | null;
  title?: string | null;
  headline?: string | null;
};

const alice: TestCandidate = {
  current_employer_company_name: "Cognizant",
  title: "Senior Software Engineer",
  headline: "SWE at Cognizant",
};
const bob: TestCandidate = {
  current_employer_company_name: "Stripe",
  title: "Staff Engineer",
  headline: "Building payments infra",
};
const carol: TestCandidate = {
  current_employer_company_name: "TCS",
  title: "Delivery Manager",
  headline: "Project delivery at TCS",
};
const dave: TestCandidate = {
  current_employer_company_name: "Accenture",
  title: "Senior Developer",
  headline: "Full-stack at Accenture",
};

const companyExcludeCognizant: SearchIntentCondition = {
  category: "company",
  disposition: "exclude",
  value: "Cognizant",
};
const companyExcludeTcs: SearchIntentCondition = {
  category: "company",
  disposition: "exclude",
  value: "TCS",
};
const titleExcludeManager: SearchIntentCondition = {
  category: "title",
  disposition: "exclude",
  value: "Manager",
};

describe("applyExcludeFilter", () => {
  it("passes all candidates when no exclude conditions", () => {
    const result = applyExcludeFilter([alice, bob, carol], []);
    expect(result).toHaveLength(3);
  });

  it("excludes candidate whose current_employer matches company/exclude (case-insensitive)", () => {
    const result = applyExcludeFilter([alice, bob], [companyExcludeCognizant]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(bob);
  });

  it("company exclude is case-insensitive", () => {
    const lower: SearchIntentCondition = {
      category: "company",
      disposition: "exclude",
      value: "cognizant",
    };
    const result = applyExcludeFilter([alice, bob], [lower]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(bob);
  });

  it("excludes candidate whose title matches title/exclude keyword", () => {
    const result = applyExcludeFilter([bob, carol], [titleExcludeManager]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(bob);
  });

  it("excludes candidate whose headline matches title/exclude keyword", () => {
    const candidate: TestCandidate = {
      current_employer_company_name: "SomeCompany",
      title: "Senior Developer",
      headline: "Delivery Manager at SomeCompany",
    };
    const result = applyExcludeFilter([candidate, bob], [titleExcludeManager]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(bob);
  });

  it("applies multiple company excludes — any match excludes the candidate", () => {
    const result = applyExcludeFilter(
      [alice, bob, carol, dave],
      [companyExcludeCognizant, companyExcludeTcs],
    );
    expect(result).toHaveLength(2);
    expect(result).toContain(bob);
    expect(result).toContain(dave);
  });

  it("handles null/missing employer/title gracefully", () => {
    const empty: TestCandidate = {};
    const result = applyExcludeFilter([empty], [companyExcludeCognizant]);
    expect(result).toHaveLength(1);
  });

  it("preserves non-exclude conditions (require/prefer) without excluding anything", () => {
    const requireCond: SearchIntentCondition = {
      category: "skill",
      disposition: "require",
      value: "React",
    };
    const result = applyExcludeFilter([alice, bob], [requireCond]);
    expect(result).toHaveLength(2);
  });
});

describe("excludeConditionsFromFlat", () => {
  it("converts flat excluded_companies to company/exclude conditions", () => {
    const conds = excludeConditionsFromFlat(["Cognizant", "TCS"], null);
    expect(conds).toHaveLength(2);
    expect(conds[0]).toMatchObject({
      category: "company",
      disposition: "exclude",
      value: "Cognizant",
    });
  });

  it("converts flat exclusion_keywords to title/exclude conditions", () => {
    const conds = excludeConditionsFromFlat(null, ["Manager", "Director"]);
    expect(conds).toHaveLength(2);
    expect(conds[0]).toMatchObject({
      category: "title",
      disposition: "exclude",
    });
  });

  it("handles null/undefined inputs", () => {
    expect(excludeConditionsFromFlat(null, null)).toHaveLength(0);
    expect(excludeConditionsFromFlat(undefined, undefined)).toHaveLength(0);
  });

  it("skips blank strings", () => {
    const conds = excludeConditionsFromFlat(["", "  "], ["  "]);
    expect(conds).toHaveLength(0);
  });
});

// ── NEW: field alias tests (job_company_name / job_title) ─────────────────────
// These cover the RawCalibrationCandidate shape from crustdataClient.ts, which
// uses job_company_name and job_title instead of current_employer_company_name
// and title.  excludePostFilter now handles both field sets so calibration-session
// can pass candidates directly without a rename adapter.

const companyExcludeWipro: SearchIntentCondition = {
  category: "company",
  disposition: "exclude",
  value: "Wipro",
};
const titleExcludeVP: SearchIntentCondition = {
  category: "title",
  disposition: "exclude",
  value: "VP",
};

describe("applyExcludeFilter — job_company_name alias (RawCalibrationCandidate shape)", () => {
  it("excludes a candidate whose job_company_name matches company/exclude", () => {
    const candidate = {
      job_company_name: "Wipro Technologies",
      job_title: "Engineer",
    };
    const result = applyExcludeFilter([candidate], [companyExcludeWipro]);
    expect(result).toHaveLength(0);
  });

  it("keeps a candidate whose job_company_name does not match", () => {
    const candidate = { job_company_name: "Stripe", job_title: "Engineer" };
    const result = applyExcludeFilter([candidate], [companyExcludeWipro]);
    expect(result).toHaveLength(1);
  });

  it("company match is case-insensitive on job_company_name", () => {
    const candidate = { job_company_name: "wipro" };
    const result = applyExcludeFilter([candidate], [companyExcludeWipro]);
    expect(result).toHaveLength(0);
  });

  it("excludes via job_company_name even when current_employer_company_name is absent", () => {
    // Simulates a raw Crustdata candidate with no field renaming applied.
    const candidate = { job_company_name: "Wipro" };
    const result = applyExcludeFilter([candidate], [companyExcludeWipro]);
    expect(result).toHaveLength(0);
  });
});

describe("applyExcludeFilter — job_title alias (RawCalibrationCandidate shape)", () => {
  it("excludes a candidate whose job_title matches title/exclude", () => {
    const candidate = { job_company_name: "ACME", job_title: "VP Engineering" };
    const result = applyExcludeFilter([candidate], [titleExcludeVP]);
    expect(result).toHaveLength(0);
  });

  it("keeps a candidate whose job_title does not match", () => {
    const candidate = {
      job_company_name: "ACME",
      job_title: "Senior Engineer",
    };
    const result = applyExcludeFilter([candidate], [titleExcludeVP]);
    expect(result).toHaveLength(1);
  });

  it("title match is case-insensitive on job_title", () => {
    const candidate = { job_title: "vp of engineering" };
    const result = applyExcludeFilter([candidate], [titleExcludeVP]);
    expect(result).toHaveLength(0);
  });

  it("excludes via job_title even when title and headline are absent", () => {
    const candidate = { job_title: "VP" };
    const result = applyExcludeFilter([candidate], [titleExcludeVP]);
    expect(result).toHaveLength(0);
  });
});

describe("applyExcludeFilter — company_name alias", () => {
  it("excludes a candidate whose company_name matches company/exclude", () => {
    const candidate = { company_name: "Cognizant Global" };
    const exclude: SearchIntentCondition = {
      category: "company",
      disposition: "exclude",
      value: "Cognizant",
    };
    const result = applyExcludeFilter([candidate], [exclude]);
    expect(result).toHaveLength(0);
  });
});

describe("applyExcludeFilter — mixed field shapes in the same batch", () => {
  it("correctly filters a batch with candidates using different field name conventions", () => {
    // Coresignal-normalised candidate (current_employer_company_name / title)
    const coresignal = {
      current_employer_company_name: "Wipro Ltd",
      title: "Software Engineer",
    };
    // Crustdata raw candidate (job_company_name / job_title)
    const crustdata = {
      job_company_name: "Wipro",
      job_title: "Developer",
    };
    // Safe candidate (different company entirely)
    const safe = {
      job_company_name: "Stripe",
      job_title: "Backend Engineer",
    };

    const result = applyExcludeFilter(
      [coresignal, crustdata, safe],
      [companyExcludeWipro],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(safe);
  });
});
