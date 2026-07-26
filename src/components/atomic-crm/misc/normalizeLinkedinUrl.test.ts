import { describe, it, expect } from "vitest";
import { normalizeLinkedinUrl } from "./normalizeLinkedinUrl";

describe("normalizeLinkedinUrl", () => {
  it("adds www. to a correctly-prefixed but www-less URL", () => {
    expect(normalizeLinkedinUrl("https://linkedin.com/in/johndoe")).toBe(
      "https://www.linkedin.com/in/johndoe",
    );
  });

  it("prefixes a bare URL (no protocol) and adds www.", () => {
    expect(normalizeLinkedinUrl("linkedin.com/in/johndoe")).toBe(
      "https://www.linkedin.com/in/johndoe",
    );
  });

  it("fixes a double-prefixed URL (https://https://...)", () => {
    expect(
      normalizeLinkedinUrl("https://https://linkedin.com/in/johndoe"),
    ).toBe("https://www.linkedin.com/in/johndoe");
  });

  it("normalises an http:// prefix to https:// and adds www.", () => {
    expect(normalizeLinkedinUrl("http://linkedin.com/in/johndoe")).toBe(
      "https://www.linkedin.com/in/johndoe",
    );
  });

  it("passes through an already-canonical www. URL unchanged", () => {
    expect(normalizeLinkedinUrl("www.linkedin.com/in/johndoe")).toBe(
      "https://www.linkedin.com/in/johndoe",
    );
  });

  it("passes through a fully-canonical https://www. URL unchanged", () => {
    expect(normalizeLinkedinUrl("https://www.linkedin.com/in/johndoe")).toBe(
      "https://www.linkedin.com/in/johndoe",
    );
  });

  it("expands 'in/slug' shorthand", () => {
    expect(normalizeLinkedinUrl("in/johndoe")).toBe(
      "https://www.linkedin.com/in/johndoe",
    );
  });

  it("expands a bare slug (no slashes, no dots)", () => {
    expect(normalizeLinkedinUrl("johndoe")).toBe(
      "https://www.linkedin.com/in/johndoe",
    );
  });

  it("handles a company URL", () => {
    expect(normalizeLinkedinUrl("linkedin.com/company/acme-corp")).toBe(
      "https://www.linkedin.com/company/acme-corp",
    );
  });

  it("handles a pub/ URL", () => {
    expect(
      normalizeLinkedinUrl("https://www.linkedin.com/pub/jane-doe/1/2/3"),
    ).toBe("https://www.linkedin.com/pub/jane-doe/1/2/3");
  });

  it("returns a best-effort URL when string contains 'linkedin' without a recognised path", () => {
    expect(normalizeLinkedinUrl("linkedin-johndoe")).toBe(
      "https://www.linkedin.com/in/linkedin-johndoe",
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
