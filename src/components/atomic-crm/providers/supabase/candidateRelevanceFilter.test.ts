import { isCandidateRelevantToDeal } from "./candidateRelevanceFilter";

it("returns true when candidate matches a required skill", () => {
  // Arrange
  const candidate = { job_title: "Senior AI Engineer", skills: ["PyTorch", "LLMs"] };
  const deal = { required_skills: ["LLMs"], must_have_keywords: [] };

  // Act
  const result = isCandidateRelevantToDeal(candidate, deal);

  // Assert
  expect(result).toBe(true);
});

it("returns false when candidate matches none of the required skills or must-have keywords", () => {
  // Arrange — the real Hugging Face/Kaggle false-positive case: only a
  // loose "Python" mention, nothing else about the AI Engineer role.
  const candidate = { job_title: "Kaggle Grandmaster", skills: ["Python", "pandas"] };
  const deal = { required_skills: ["LLMs", "RAG pipelines"], must_have_keywords: ["production ML"] };

  // Act
  const result = isCandidateRelevantToDeal(candidate, deal);

  // Assert
  expect(result).toBe(false);
});

it("returns true when the deal has no required_skills or must_have_keywords set", () => {
  // Arrange
  const candidate = { job_title: "Anything at all" };
  const deal = { required_skills: [], must_have_keywords: [] };

  // Act
  const result = isCandidateRelevantToDeal(candidate, deal);

  // Assert
  expect(result).toBe(true);
});

it("returns false when candidate's company is in excluded_companies, even if skills match", () => {
  // Arrange
  const candidate = { job_title: "AI Engineer", job_company_name: "Rival Corp", skills: ["LLMs"] };
  const deal = { required_skills: ["LLMs"], excluded_companies: ["Rival Corp"] };

  // Act
  const result = isCandidateRelevantToDeal(candidate, deal);

  // Assert
  expect(result).toBe(false);
});

it("returns false when candidate matches an exclusion keyword", () => {
  // Arrange
  const candidate = { job_title: "AI Engineer (intern)", skills: ["LLMs"] };
  const deal = { required_skills: ["LLMs"], exclusion_keywords: ["intern"] };

  // Act
  const result = isCandidateRelevantToDeal(candidate, deal);

  // Assert
  expect(result).toBe(false);
});

it("matches case-insensitively", () => {
  // Arrange
  const candidate = { job_title: "senior python engineer" };
  const deal = { required_skills: ["Python"] };

  // Act
  const result = isCandidateRelevantToDeal(candidate, deal);

  // Assert
  expect(result).toBe(true);
});
