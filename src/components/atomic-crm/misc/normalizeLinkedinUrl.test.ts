import { describe, it, expect } from "vitest";
import { normalizeLinkedinUrl } from "./normalizeLinkedinUrl";

describe("normalizeLinkedinUrl", () => {
  it("passes through a correctly-prefixed URL unchanged", () => {
    expect(normalizeLinkedinUrl("https://linkedin.com/in/johndoe")).toBe(
      "https://linkedin.com/in/johndoe",
    );
  });

  it("prefixes a bare URL (no protocol)", () => {
    expect(normalizeLinkedinUrl("linkedin.com/in/johndoe")).toBe(
      "https://linkedin.com/in/johndoe",
    );
  });

  it("fixes a double-prefixed URL (https://https://...)", () => {
    expect(
      normalizeLinkedinUrl("https://https://linkedin.com/in/johndoe"),
    ).toBe("https://linkedin.com/in/johndoe");
  });

  it("normalises an http:// prefix to https://", () => {
    expect(normalizeLinkedinUrl("http://linkedin.com/in/johndoe")).toBe(
      "https://linkedin.com/in/johndoe",
    );
  });

  it("handles www. prefix", () => {
    expect(normalizeLinkedinUrl("www.linkedin.com/in/johndoe")).toBe(
      "https://www.linkedin.com/in/johndoe",
    );
  });

  it("returns null for null input", () => {
    expect(normalizeLinkedinUrl(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizeLinkedinUrl(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeLinkedinUrl("")).toBeNull();
  });

  it("returns null for non-LinkedIn URL", () => {
    expect(normalizeLinkedinUrl("https://example.com/johndoe")).toBeNull();
  });

  it("returns null for a GitHub URL", () => {
    expect(normalizeLinkedinUrl("https://github.com/johndoe")).toBeNull();
  });
});
