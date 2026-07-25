import { describe, expect, it } from "vitest";
import {
  checkDailyCap,
  detectLinkedInSeatType,
  extractLinkedInSlug,
  mapUnipileAccountStatus,
} from "./unipileClientHelpers.ts";

describe("extractLinkedInSlug", () => {
  it("extracts slug from full LinkedIn URL", () => {
    expect(
      extractLinkedInSlug("https://www.linkedin.com/in/satyanadella/"),
    ).toBe("satyanadella");
  });

  it("extracts slug from URL without trailing slash", () => {
    expect(extractLinkedInSlug("https://linkedin.com/in/satyanadella")).toBe(
      "satyanadella",
    );
  });

  it("returns null for empty string", () => {
    expect(extractLinkedInSlug("")).toBeNull();
  });

  it("handles bare slug (no URL structure)", () => {
    const result = extractLinkedInSlug("satyanadella");
    expect(result).toBe("satyanadella");
  });
});

describe("checkDailyCap", () => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  it("returns can_send=true when below cap", () => {
    const result = checkDailyCap({
      linkedin_daily_send_cap: 80,
      linkedin_sends_today: 10,
      linkedin_sends_reset_date: today,
    });
    expect(result.can_send).toBe(true);
    expect(result.cap_remaining).toBe(70);
    expect(result.needs_reset).toBe(false);
  });

  it("returns can_send=false when at cap", () => {
    const result = checkDailyCap({
      linkedin_daily_send_cap: 80,
      linkedin_sends_today: 80,
      linkedin_sends_reset_date: today,
    });
    expect(result.can_send).toBe(false);
    expect(result.cap_remaining).toBe(0);
  });

  it("resets counter when date has changed", () => {
    const result = checkDailyCap({
      linkedin_daily_send_cap: 80,
      linkedin_sends_today: 80,
      linkedin_sends_reset_date: yesterday,
    });
    expect(result.needs_reset).toBe(true);
    expect(result.sends_today).toBe(0);
    expect(result.can_send).toBe(true);
  });

  it("uses default cap of 80 when not set", () => {
    const result = checkDailyCap({
      linkedin_sends_today: 0,
      linkedin_sends_reset_date: today,
    });
    expect(result.cap).toBe(80);
  });
});

describe("unipileClient", () => {
  it("detects recruiter seat from sources metadata", () => {
    expect(
      detectLinkedInSeatType({
        id: "acc1",
        sources: [
          { provider: "LINKEDIN", connection_params: { recruiter: true } },
        ],
      }),
    ).toBe("recruiter");
  });

  it("maps checkpoint pending status", () => {
    expect(
      mapUnipileAccountStatus({
        status: "OK",
        checkpoint: { type: "2FA" },
      }),
    ).toEqual({ status: "checkpoint_pending", checkpoint_type: "2FA" });
  });

  it("maps credentials required", () => {
    expect(mapUnipileAccountStatus({ status: "CREDENTIALS" })).toEqual({
      status: "credentials_required",
      checkpoint_type: null,
    });
  });
});
