import { describe, it, expect } from "vitest";
import {
  apolloCompanySize,
  apolloYearsExperience,
  coresignalCompanySize,
  coresignalYearsExperience,
  crustdataCompanySize,
  crustdataYearsExperience,
  monthsToYears,
} from "./candidateDisplayFields";

describe("candidateDisplayFields", () => {
  it("converts CoreSignal experience months to years", () => {
    expect(
      coresignalYearsExperience({ total_experience_duration_months: 54 }),
    ).toBe(4.5);
  });

  it("reads CoreSignal company size from known response keys", () => {
    expect(
      coresignalCompanySize({ experience_company_employees_count: 240 }),
    ).toBe(240);
  });

  it("reads Crustdata years and headcount from nested response shape", () => {
    expect(
      crustdataYearsExperience({
        basic_profile: { years_of_experience: 8 },
      }),
    ).toBe(8);
    expect(
      crustdataCompanySize({
        experience: {
          employment_details: {
            current: [{ company_headcount_latest: 1200 }],
          },
        },
      }),
    ).toBe(1200);
  });

  it("reads Apollo organization employee count", () => {
    expect(
      apolloCompanySize({
        organization: { estimated_num_employees: 350 },
      }),
    ).toBe(350);
    expect(apolloYearsExperience({ years_of_experience: 6 })).toBe(6);
  });

  it("returns null when vendor fields are absent", () => {
    expect(monthsToYears(undefined)).toBeNull();
    expect(coresignalCompanySize({})).toBeNull();
  });
});
