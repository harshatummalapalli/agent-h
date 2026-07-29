// Vitest unit tests for crustdataAllWords — shared (.) all-words builder.
import { describe, it, expect } from "vitest";
import {
  buildAllWordsCondition,
  buildAllWordsOrGroup,
  normalizeAllWordsPhrase,
} from "./crustdataAllWords.ts";

describe("normalizeAllWordsPhrase", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeAllWordsPhrase("  Machine   Learning  ")).toBe(
      "Machine Learning",
    );
  });

  it("treats & as space", () => {
    expect(normalizeAllWordsPhrase("AI & Software Engineer")).toBe(
      "AI Software Engineer",
    );
  });

  it("returns empty for blank input", () => {
    expect(normalizeAllWordsPhrase("   ")).toBe("");
  });
});

describe("buildAllWordsCondition", () => {
  it("returns null for blank phrase", () => {
    expect(buildAllWordsCondition("f", "  ")).toBeNull();
  });

  it("emits one (.) with the full multi-word phrase (no shingles)", () => {
    expect(
      buildAllWordsCondition(
        "experience.employment_details.current.title",
        "Machine Learning Engineer",
      ),
    ).toEqual({
      field: "experience.employment_details.current.title",
      type: "(.)",
      value: "Machine Learning Engineer",
    });
  });
});

describe("buildAllWordsOrGroup", () => {
  it("returns bare condition for a single phrase", () => {
    expect(buildAllWordsOrGroup("f", ["Python"])).toEqual({
      field: "f",
      type: "(.)",
      value: "Python",
    });
  });

  it("OR-groups multiple alternative phrases (never pipe-joins)", () => {
    expect(
      buildAllWordsOrGroup("f", ["Backend Engineer", "Backend Developer"]),
    ).toEqual({
      op: "or",
      conditions: [
        { field: "f", type: "(.)", value: "Backend Engineer" },
        { field: "f", type: "(.)", value: "Backend Developer" },
      ],
    });
  });

  it("dedupes normalized phrases", () => {
    const g = buildAllWordsOrGroup("f", [
      "AI Engineer",
      "  AI   Engineer  ",
      "ML Engineer",
    ]);
    expect(g).toEqual({
      op: "or",
      conditions: [
        { field: "f", type: "(.)", value: "AI Engineer" },
        { field: "f", type: "(.)", value: "ML Engineer" },
      ],
    });
  });

  it("returns null for all-blank input", () => {
    expect(buildAllWordsOrGroup("f", ["", "  "])).toBeNull();
  });
});
