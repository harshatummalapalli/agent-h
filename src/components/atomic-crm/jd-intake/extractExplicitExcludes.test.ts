import { describe, it, expect } from "vitest";
import { extractExplicitExcludesFromText } from "./extractExplicitExcludes";

describe("extractExplicitExcludesFromText", () => {
  it("extracts companies from exact repro phrasing", () => {
    const text =
      "Senior Backend Engineer, Python, 8+ years. " +
      "Exclude candidates currently at Accenture, Infosys, or Cognizant. Hard filters, no exceptions.";
    const { companies } = extractExplicitExcludesFromText(text);
    expect(companies).toContain("Accenture");
    expect(companies).toContain("Infosys");
    expect(companies).toContain("Cognizant");
    expect(companies).toHaveLength(3);
  });

  it("handles 'Exclude candidates at X or Y'", () => {
    const { companies } = extractExplicitExcludesFromText(
      "Exclude candidates at TCS or Wipro.",
    );
    expect(companies).toContain("TCS");
    expect(companies).toContain("Wipro");
  });

  it("handles comma-separated without 'or'", () => {
    const { companies } = extractExplicitExcludesFromText(
      "Exclude candidates from IBM, Infosys, Cognizant.",
    );
    expect(companies).toContain("IBM");
    expect(companies).toContain("Infosys");
    expect(companies).toContain("Cognizant");
  });

  it("returns empty arrays for clean JD with no excludes", () => {
    const { companies, titleKeywords } = extractExplicitExcludesFromText(
      "We are looking for a Senior Python Engineer with 5+ years of experience. " +
        "Strong background in distributed systems and AWS required.",
    );
    expect(companies).toHaveLength(0);
    expect(titleKeywords).toHaveLength(0);
  });

  it("returns empty for 'Hard filters, no exceptions' alone", () => {
    const { companies } = extractExplicitExcludesFromText(
      "Hard filters, no exceptions.",
    );
    expect(companies).toHaveLength(0);
  });

  it("deduplicates case-insensitively", () => {
    const { companies } = extractExplicitExcludesFromText(
      "Exclude candidates at Infosys, Cognizant, Infosys.",
    );
    const lower = companies.map((c) => c.toLowerCase());
    expect(lower.filter((c) => c === "infosys")).toHaveLength(1);
    expect(companies).toHaveLength(2);
  });

  it("handles 'do not source from' pattern", () => {
    const { companies } = extractExplicitExcludesFromText(
      "Do not source candidates from Wipro or HCL.",
    );
    expect(companies).toContain("Wipro");
    expect(companies).toContain("HCL");
  });

  it("handles 'avoid candidates at' pattern", () => {
    const { companies } = extractExplicitExcludesFromText(
      "Please avoid candidates currently at Capgemini or Accenture.",
    );
    expect(companies).toContain("Capgemini");
    expect(companies).toContain("Accenture");
  });

  it("titleKeywords is always empty in v1", () => {
    const { titleKeywords } = extractExplicitExcludesFromText(
      "Exclude candidates at Accenture. No IT service company employees.",
    );
    expect(titleKeywords).toHaveLength(0);
  });
});
