import { describe, it, expect } from "vitest";
import {
  decomposeSearchPhrase,
  buildContainsCondition,
  buildContainsOrGroupFromPhrases,
  buildCrustdataFilters,
  CRUSTDATA_FIELDS,
  type CrustdataSearchCriteria,
  type CrustdataFilterGroup,
  type CrustdataFilterCondition,
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
  it("keeps a short phrase intact", () => {
    expect(decomposeSearchPhrase("AI Engineer")).toEqual(["AI Engineer"]);
  });

  it("keeps a single word intact", () => {
    expect(decomposeSearchPhrase("Java")).toEqual(["Java"]);
  });

  it("keeps a long phrase whole (no shingle OR — live 2026-07-29)", () => {
    // Live compare: full-phrase (.) beat shingle OR for Machine Learning Engineer.
    expect(decomposeSearchPhrase("Azure OpenAI Engineer")).toEqual([
      "Azure OpenAI Engineer",
    ]);
    expect(decomposeSearchPhrase("Natural Language Processing")).toEqual([
      "Natural Language Processing",
    ]);
  });

  it("splits a slash-delimited compound string into separate variants", () => {
    expect(decomposeSearchPhrase("AWS/Azure/GCP")).toEqual([
      "AWS",
      "Azure",
      "GCP",
    ]);
  });

  it("splits a pipe-delimited compound string into full-phrase alternatives", () => {
    const result = decomposeSearchPhrase(
      "AI Engineer|.NET AI|Azure OpenAI Engineer",
    );
    expect(result).toContain("AI Engineer");
    expect(result).toContain(".NET AI");
    expect(result).toContain("Azure OpenAI Engineer");
    expect(result).not.toContain("Azure OpenAI"); // no longer shingles
  });

  it("de-duplicates repeated phrases across variants", () => {
    const result = decomposeSearchPhrase(
      "Senior Backend Engineer / Backend Engineer",
    );
    expect(result.filter((t) => t === "Backend Engineer").length).toBe(1);
    expect(result).toContain("Senior Backend Engineer");
  });

  it("caps the number of decomposed terms at maxTerms", () => {
    const result = decomposeSearchPhrase("one/two/three/four/five", 3);
    expect(result.length).toBe(3);
  });
});

describe("buildContainsCondition", () => {
  it("returns null when given no phrases", () => {
    expect(
      buildContainsCondition(CRUSTDATA_FIELDS.currentTitle, []),
    ).toBeNull();
  });

  it("returns null when every phrase decomposes to nothing", () => {
    expect(
      buildContainsCondition(CRUSTDATA_FIELDS.currentTitle, ["   ", ""]),
    ).toBeNull();
  });

  it("builds a single (.) condition with the full phrase (no pipe-join)", () => {
    expect(
      buildContainsCondition(CRUSTDATA_FIELDS.currentTitle, [
        "Machine Learning Engineer",
      ]),
    ).toEqual({
      field: CRUSTDATA_FIELDS.currentTitle,
      type: "(.)",
      value: "Machine Learning Engineer",
    });
  });

  it("OR-groups compound alternatives instead of pipe-joining", () => {
    expect(
      buildContainsCondition(CRUSTDATA_FIELDS.currentTitle, [
        "AI Engineer|ML Engineer",
      ]),
    ).toEqual({
      op: "or",
      conditions: [
        {
          field: CRUSTDATA_FIELDS.currentTitle,
          type: "(.)",
          value: "AI Engineer",
        },
        {
          field: CRUSTDATA_FIELDS.currentTitle,
          type: "(.)",
          value: "ML Engineer",
        },
      ],
    });
  });

  it("returns null when given multiple phrases (use buildContainsOrGroupFromPhrases)", () => {
    expect(
      buildContainsCondition(CRUSTDATA_FIELDS.currentTitle, [
        "Backend Engineer",
        "Backend Developer",
      ]),
    ).toBeNull();
  });
});

describe("buildContainsOrGroupFromPhrases", () => {
  it("OR-groups multiple expanded title synonyms as separate (.) conditions", () => {
    // Arrange & Act
    const result = buildContainsOrGroupFromPhrases(
      CRUSTDATA_FIELDS.currentTitle,
      ["Backend Engineer", "Backend Developer"],
    );

    // Assert
    expect(result).toEqual({
      op: "or",
      conditions: [
        {
          field: CRUSTDATA_FIELDS.currentTitle,
          type: "(.)",
          value: "Backend Engineer",
        },
        {
          field: CRUSTDATA_FIELDS.currentTitle,
          type: "(.)",
          value: "Backend Developer",
        },
      ],
    });
  });
});

function collectDotContainsConditions(
  node: CrustdataFilterGroup | CrustdataFilterCondition | null,
): CrustdataFilterCondition[] {
  if (!node) return [];
  if ("op" in node) {
    return node.conditions.flatMap((c) =>
      "op" in c ? collectDotContainsConditions(c) : c.type === "(.)" ? [c] : [],
    );
  }
  return node.type === "(.)" ? [node] : [];
}

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
    const pastTitleFilter = group.conditions.find(
      (c) =>
        ("field" in c && c.field === CRUSTDATA_FIELDS.pastTitle) ||
        ("op" in c &&
          c.op === "or" &&
          c.conditions.some(
            (cc) => "field" in cc && cc.field === CRUSTDATA_FIELDS.pastTitle,
          )),
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
    expect(pastTitleFilter).toBeDefined();
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

  it("does not pipe-join multiple title alternatives into one (.) value (deal 1 regression)", () => {
    // Arrange: live deal-1 bisection case -- pipe-joined title variants zeroed
    // out an otherwise valid AND query even though each variant alone matches.
    const criteria = buildEmptyCriteria({
      titles: [
        "Senior AI",
        "AI Software",
        "Software Engineer",
        "AI Engineer",
        "Senior .NET",
        ".NET Engineer",
      ],
      location: "Hyderabad, Telangana, India",
      requiredSkills: [
        "C#",
        ".NET",
        "ASP.NET Core",
        "Python",
        "REST APIs",
        "Microservices",
        "SQL Server",
        "Git",
        "Azure DevOps",
        "CI/CD",
        "Docker",
        "LLMs",
        "RAG (Retrieval-Augmented Generation)",
        "Prompt Engineering",
        "Vector Databases",
        "AI API Integration",
        "OpenAI",
        "Azure OpenAI",
      ],
      seniority: "senior",
      yearsExperienceMin: 5,
      yearsExperienceMax: 9,
    });

    // Act
    const { filters } = buildCrustdataFilters(criteria);

    // Assert
    const group = filters as CrustdataFilterGroup;
    const titleOrGroup = group.conditions.find(
      (c): c is CrustdataFilterGroup =>
        "op" in c &&
        c.op === "or" &&
        c.conditions.length > 1 &&
        c.conditions.every(
          (cc) => "field" in cc && cc.field === CRUSTDATA_FIELDS.currentTitle,
        ),
    );
    expect(titleOrGroup).toBeDefined();
    for (const condition of collectDotContainsConditions(filters)) {
      expect(condition.value).not.toContain("|");
    }
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
