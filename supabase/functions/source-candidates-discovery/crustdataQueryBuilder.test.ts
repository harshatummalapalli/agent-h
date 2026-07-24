import { describe, it, expect } from "vitest";
import {
  decomposeSearchPhrase,
  buildContainsCondition,
  buildCrustdataFilters,
  CRUSTDATA_FIELDS,
  type CrustdataSearchCriteria,
  type CrustdataFilterGroup,
} from "./crustdataQueryBuilder";

// Base criteria with every field null/empty -- individual tests override
// just the fields they care about, same "start from a known-empty baseline"
// pattern the rest of this codebase's DiscoveryCriteria-shaped fixtures use.
function buildEmptyCriteria(
  overrides: Partial<CrustdataSearchCriteria> = {},
): CrustdataSearchCriteria {
  return {
    titles: null,
    location: null,
    requiredSkills: null,
    seniority: null,
    yearsExperienceMin: null,
    yearsExperienceMax: null,
    excludedCompanies: null,
    exclusionKeywords: null,
    pastTitles: null,
    pastCompanies: null,
    companySizeMin: null,
    companySizeMax: null,
    learnedCriteria: null,
    ...overrides,
  };
}

describe("decomposeSearchPhrase", () => {
  it("keeps a short phrase (at or under the shingle size) intact", () => {
    // Arrange
    const phrase = "AI Engineer";

    // Act
    const result = decomposeSearchPhrase(phrase);

    // Assert
    expect(result).toEqual(["AI Engineer"]);
  });

  it("keeps a single word intact", () => {
    // Arrange & Act
    const result = decomposeSearchPhrase("Java");

    // Assert
    expect(result).toEqual(["Java"]);
  });

  it("breaks a long compound phrase into overlapping shingles instead of one literal phrase", () => {
    // Arrange: the live-confirmed gotcha case -- "Azure OpenAI Engineer" (3
    // words) never appears verbatim in indexed titles, but its 2-word
    // shingles are far more likely to.
    const phrase = "Azure OpenAI Engineer";

    // Act
    const result = decomposeSearchPhrase(phrase);

    // Assert
    expect(result).toEqual(["Azure OpenAI", "OpenAI Engineer"]);
  });

  it("splits a slash-delimited compound string into separate variants", () => {
    // Arrange
    const phrase = "AWS/Azure/GCP";

    // Act
    const result = decomposeSearchPhrase(phrase);

    // Assert
    expect(result).toEqual(["AWS", "Azure", "GCP"]);
  });

  it("splits a pipe-delimited compound string and shingles the long variants", () => {
    // Arrange: the exact live-tested query from the gotcha report.
    const phrase = "AI Engineer|.NET AI|Azure OpenAI Engineer";

    // Act
    const result = decomposeSearchPhrase(phrase);

    // Assert
    expect(result).toContain("AI Engineer");
    expect(result).toContain(".NET AI");
    expect(result).toContain("Azure OpenAI");
    expect(result).toContain("OpenAI Engineer");
    // The original 3-word phrase should never survive as one literal term.
    expect(result).not.toContain("Azure OpenAI Engineer");
  });

  it("de-duplicates repeated shingles across variants", () => {
    // Arrange
    const phrase = "Senior Backend Engineer / Backend Engineer";

    // Act
    const result = decomposeSearchPhrase(phrase);

    // Assert: "Backend Engineer" shingle appears from both variants but only once
    const occurrences = result.filter((t) => t === "Backend Engineer").length;
    expect(occurrences).toBe(1);
  });

  it("caps the number of decomposed terms at maxTerms", () => {
    // Arrange
    const phrase = "one two three four five six seven eight nine ten";

    // Act
    const result = decomposeSearchPhrase(phrase, 3);

    // Assert
    expect(result.length).toBe(3);
  });
});

describe("buildContainsCondition", () => {
  it("returns null when given no phrases", () => {
    // Arrange & Act
    const result = buildContainsCondition(CRUSTDATA_FIELDS.currentTitle, []);

    // Assert
    expect(result).toBeNull();
  });

  it("returns null when every phrase decomposes to nothing", () => {
    // Arrange & Act
    const result = buildContainsCondition(CRUSTDATA_FIELDS.currentTitle, [
      "   ",
      "",
    ]);

    // Assert
    expect(result).toBeNull();
  });

  it("builds a single (.) condition joining decomposed terms with |", () => {
    // Arrange & Act
    const result = buildContainsCondition(CRUSTDATA_FIELDS.currentTitle, [
      "AI Engineer",
    ]);

    // Assert
    expect(result).toEqual({
      field: CRUSTDATA_FIELDS.currentTitle,
      type: "(.)",
      value: "AI Engineer",
    });
  });

  it("joins multiple expanded title synonyms into one pipe-delimited value", () => {
    // Arrange & Act
    const result = buildContainsCondition(CRUSTDATA_FIELDS.currentTitle, [
      "Backend Engineer",
      "Backend Developer",
    ]);

    // Assert
    expect(result?.type).toBe("(.)");
    expect(result?.value).toContain("Backend Engineer");
    expect(result?.value).toContain("Backend Developer");
    expect((result?.value as string).includes("|")).toBe(true);
  });
});

describe("buildCrustdataFilters", () => {
  it("returns null filters and a note when no criteria are provided at all", () => {
    // Arrange
    const criteria = buildEmptyCriteria();

    // Act
    const { filters, notes } = buildCrustdataFilters(criteria);

    // Assert
    expect(filters).toBeNull();
    expect(notes.some((n) => n.includes("No role title"))).toBe(true);
  });

  it("builds a top-level AND group with a title condition when only a title is given", () => {
    // Arrange
    const criteria = buildEmptyCriteria({ titles: ["Backend Engineer"] });

    // Act
    const { filters } = buildCrustdataFilters(criteria);

    // Assert
    expect(filters).not.toBeNull();
    const group = filters as CrustdataFilterGroup;
    expect(group.op).toBe("and");
    expect(group.conditions).toEqual([
      {
        field: CRUSTDATA_FIELDS.currentTitle,
        type: "(.)",
        value: "Backend Engineer",
      },
    ]);
  });

  it("skips the location filter entirely for a remote role", () => {
    // Arrange
    const criteria = buildEmptyCriteria({
      titles: ["Backend Engineer"],
      location: "Remote",
    });

    // Act
    const { filters, notes } = buildCrustdataFilters(criteria);

    // Assert
    const group = filters as CrustdataFilterGroup;
    expect(
      group.conditions.some(
        (c) => "field" in c && c.field === CRUSTDATA_FIELDS.locationCity,
      ),
    ).toBe(false);
    expect(notes.some((n) => n.includes("remote"))).toBe(true);
  });

  it("uses only the first comma segment of a location as the city filter", () => {
    // Arrange
    const criteria = buildEmptyCriteria({
      titles: ["Backend Engineer"],
      location: "Hyderabad, Telangana, India",
    });

    // Act
    const { filters } = buildCrustdataFilters(criteria);

    // Assert
    const group = filters as CrustdataFilterGroup;
    expect(group.conditions).toContainEqual({
      field: CRUSTDATA_FIELDS.locationCity,
      type: "(.)",
      value: "Hyderabad",
    });
  });

  it("requires the top skill and OR-groups the remaining skills", () => {
    // Arrange
    const criteria = buildEmptyCriteria({
      requiredSkills: ["Java", "Spring", "Kafka", "Hibernate", "Docker"],
    });

    // Act
    const { filters, notes } = buildCrustdataFilters(criteria);

    // Assert
    const group = filters as CrustdataFilterGroup;
    expect(group.conditions).toContainEqual({
      field: CRUSTDATA_FIELDS.skills,
      type: "(.)",
      value: "Java",
    });
    const orGroup = group.conditions.find(
      (c): c is CrustdataFilterGroup => "op" in c && c.op === "or",
    );
    expect(orGroup).toBeDefined();
    expect(orGroup?.conditions.length).toBe(3); // Spring, Kafka, Hibernate (capped at 3)
    expect(notes.some((n) => n.includes("Docker"))).toBe(true); // dropped, disclosed
  });

  it("applies a fuzzy seniority filter when a mapping exists", () => {
    // Arrange
    const criteria = buildEmptyCriteria({ seniority: "director" });

    // Act
    const { filters, notes } = buildCrustdataFilters(criteria);

    // Assert
    const group = filters as CrustdataFilterGroup;
    expect(group.conditions).toContainEqual({
      field: CRUSTDATA_FIELDS.currentSeniorityLevel,
      type: "(.)",
      value: "Director",
    });
    expect(notes.some((n) => n.includes('seniority level "director"'))).toBe(
      true,
    );
  });

  it("leaves mid_level seniority unmapped, same honest-gap rule as PDL/Coresignal", () => {
    // Arrange
    const criteria = buildEmptyCriteria({ seniority: "mid_level" });

    // Act
    const { filters, notes } = buildCrustdataFilters(criteria);

    // Assert
    expect(filters).toBeNull(); // no other criteria set, and seniority alone isn't enough
    expect(
      notes.some((n) => n.includes("doesn't have a clean equivalent")),
    ).toBe(true);
  });

  it("skips the seniority filter when useSeniority is false", () => {
    // Arrange
    const criteria = buildEmptyCriteria({
      titles: ["Engineer"],
      seniority: "senior",
    });

    // Act
    const { filters } = buildCrustdataFilters(criteria, {
      useSeniority: false,
    });

    // Assert
    const group = filters as CrustdataFilterGroup;
    expect(
      group.conditions.some(
        (c) =>
          "field" in c && c.field === CRUSTDATA_FIELDS.currentSeniorityLevel,
      ),
    ).toBe(false);
  });

  it("builds a years-of-experience range using => and =< (not <=/>=)", () => {
    // Arrange
    const criteria = buildEmptyCriteria({
      yearsExperienceMin: 5,
      yearsExperienceMax: 8,
    });

    // Act
    const { filters } = buildCrustdataFilters(criteria);

    // Assert
    const group = filters as CrustdataFilterGroup;
    expect(group.conditions).toContainEqual({
      field: CRUSTDATA_FIELDS.yearsOfExperience,
      type: "=>",
      value: 5,
    });
    expect(group.conditions).toContainEqual({
      field: CRUSTDATA_FIELDS.yearsOfExperience,
      type: "=<",
      value: 8,
    });
  });

  it("builds a company-size range on company_headcount_latest", () => {
    // Arrange
    const criteria = buildEmptyCriteria({
      companySizeMin: 50,
      companySizeMax: 200,
    });

    // Act
    const { filters } = buildCrustdataFilters(criteria);

    // Assert
    const group = filters as CrustdataFilterGroup;
    expect(group.conditions).toContainEqual({
      field: CRUSTDATA_FIELDS.currentCompanyHeadcountLatest,
      type: "=>",
      value: 50,
    });
    expect(group.conditions).toContainEqual({
      field: CRUSTDATA_FIELDS.currentCompanyHeadcountLatest,
      type: "=<",
      value: 200,
    });
  });

  it("hard-excludes named companies with (!)", () => {
    // Arrange
    const criteria = buildEmptyCriteria({ excludedCompanies: ["Acme Corp"] });

    // Act
    const { filters } = buildCrustdataFilters(criteria);

    // Assert
    const group = filters as CrustdataFilterGroup;
    expect(group.conditions).toContainEqual({
      field: CRUSTDATA_FIELDS.currentCompanyName,
      type: "(!)",
      value: "Acme Corp",
    });
  });

  it("hard-excludes keywords against both title and skills", () => {
    // Arrange
    const criteria = buildEmptyCriteria({ exclusionKeywords: ["intern"] });

    // Act
    const { filters } = buildCrustdataFilters(criteria);

    // Assert
    const group = filters as CrustdataFilterGroup;
    expect(group.conditions).toContainEqual({
      field: CRUSTDATA_FIELDS.currentTitle,
      type: "(!)",
      value: "intern",
    });
    expect(group.conditions).toContainEqual({
      field: CRUSTDATA_FIELDS.skills,
      type: "(!)",
      value: "intern",
    });
  });

  it("OR-groups past titles and past companies as real filters, not boosts", () => {
    // Arrange
    const criteria = buildEmptyCriteria({
      pastTitles: ["Founding Engineer"],
      pastCompanies: ["Google", "Meta"],
    });

    // Act
    const { filters, notes } = buildCrustdataFilters(criteria);

    // Assert
    const group = filters as CrustdataFilterGroup;
    const pastTitleGroup = group.conditions.find(
      (c): c is CrustdataFilterGroup =>
        "op" in c &&
        c.op === "or" &&
        c.conditions.some(
          (cc) => "field" in cc && cc.field === CRUSTDATA_FIELDS.pastTitle,
        ),
    );
    const pastCompanyGroup = group.conditions.find(
      (c): c is CrustdataFilterGroup =>
        "op" in c &&
        c.op === "or" &&
        c.conditions.some(
          (cc) =>
            "field" in cc && cc.field === CRUSTDATA_FIELDS.pastCompanyName,
        ),
    );
    expect(pastTitleGroup).toBeDefined();
    expect(pastCompanyGroup).toBeDefined();
    expect(pastCompanyGroup?.conditions.length).toBe(2);
    expect(
      notes.some((n) =>
        n.includes("real filter, not just a ranking preference"),
      ),
    ).toBe(true);
  });

  it("applies a require_keyword learned criterion as a skills contains-filter", () => {
    // Arrange
    const criteria = buildEmptyCriteria({
      learnedCriteria: [
        {
          criterionType: "require_keyword",
          value: { keyword: "Kubernetes" },
          label: "Must have Kubernetes experience.",
        },
      ],
    });

    // Act
    const { filters, notes } = buildCrustdataFilters(criteria);

    // Assert
    const group = filters as CrustdataFilterGroup;
    expect(group.conditions).toContainEqual({
      field: CRUSTDATA_FIELDS.skills,
      type: "(.)",
      value: "Kubernetes",
    });
    expect(notes.some((n) => n.includes("Learned criterion applied"))).toBe(
      true,
    );
  });

  it("applies an exclude_keyword learned criterion against title and skills", () => {
    // Arrange
    const criteria = buildEmptyCriteria({
      learnedCriteria: [
        {
          criterionType: "exclude_keyword",
          value: { keyword: "contractor" },
          label: "Must not be a contractor.",
        },
      ],
    });

    // Act
    const { filters } = buildCrustdataFilters(criteria);

    // Assert
    const group = filters as CrustdataFilterGroup;
    expect(group.conditions).toContainEqual({
      field: CRUSTDATA_FIELDS.currentTitle,
      type: "(!)",
      value: "contractor",
    });
    expect(group.conditions).toContainEqual({
      field: CRUSTDATA_FIELDS.skills,
      type: "(!)",
      value: "contractor",
    });
  });

  it("combines title, location, skills, seniority, and years into one AND group", () => {
    // Arrange: a realistic full role brief, mirroring discoverCandidates'
    // real DiscoveryCriteria construction in index.ts.
    const criteria = buildEmptyCriteria({
      titles: ["Backend Engineer"],
      location: "Austin, Texas, USA",
      requiredSkills: ["Java"],
      seniority: "senior",
      yearsExperienceMin: 5,
    });

    // Act
    const { filters } = buildCrustdataFilters(criteria);

    // Assert
    const group = filters as CrustdataFilterGroup;
    expect(group.op).toBe("and");
    expect(group.conditions.length).toBe(5);
  });
});
