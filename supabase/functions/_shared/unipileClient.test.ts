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

describe("detectLinkedInSeatType", () => {
  it("detects recruiter from connection_params.im.premiumFeatures at account root (real payload shape)", () => {
    expect(
      detectLinkedInSeatType({
        id: "b6OxZmnMQbyjsy_6eCkHEw",
        type: "LINKEDIN",
        sources: [{ id: "..._MESSAGING", status: "OK" }],
        connection_params: { im: { premiumFeatures: ["recruiter"] } },
      }),
    ).toBe("recruiter");
  });

  it("detects sales_navigator from premiumFeatures", () => {
    expect(
      detectLinkedInSeatType({
        id: "acc1",
        connection_params: { im: { premiumFeatures: ["sales_navigator"] } },
      }),
    ).toBe("sales_navigator");
  });

  it("detects premium from premiumFeatures", () => {
    expect(
      detectLinkedInSeatType({
        id: "acc1",
        connection_params: { im: { premiumFeatures: ["premium"] } },
      }),
    ).toBe("premium");
  });

  it("falls back to classic when premiumFeatures is empty array", () => {
    expect(
      detectLinkedInSeatType({
        id: "acc1",
        connection_params: { im: { premiumFeatures: [] } },
      }),
    ).toBe("classic");
  });

  it("falls back to legacy boolean recruiter flag in sources", () => {
    expect(
      detectLinkedInSeatType({
        id: "acc1",
        sources: [
          { provider: "LINKEDIN", connection_params: { recruiter: true } },
        ],
      }),
    ).toBe("recruiter");
  });

  it("returns null when no id", () => {
    expect(detectLinkedInSeatType({})).toBeNull();
  });
});

describe("mapUnipileAccountStatus", () => {
  it("returns connected for real Unipile payload with sources[].status=OK", () => {
    expect(
      mapUnipileAccountStatus({
        id: "b6OxZmnMQbyjsy_6eCkHEw",
        type: "LINKEDIN",
        sources: [{ id: "..._MESSAGING", status: "OK" }],
        connection_params: { im: { premiumFeatures: ["recruiter"] } },
      }),
    ).toEqual({ status: "connected", checkpoint_type: null });
  });

  it("returns credentials_required when sources[].status=CREDENTIALS", () => {
    expect(
      mapUnipileAccountStatus({
        id: "acc1",
        sources: [{ status: "CREDENTIALS" }],
      }),
    ).toEqual({ status: "credentials_required", checkpoint_type: null });
  });

  it("returns credentials_required when sources[].status=DISCONNECTED", () => {
    expect(
      mapUnipileAccountStatus({
        id: "acc1",
        sources: [{ status: "DISCONNECTED" }],
      }),
    ).toEqual({ status: "credentials_required", checkpoint_type: null });
  });

  it("returns credentials_required when sources[].status=ERROR", () => {
    expect(
      mapUnipileAccountStatus({
        id: "acc1",
        sources: [{ status: "ERROR" }],
      }),
    ).toEqual({ status: "credentials_required", checkpoint_type: null });
  });

  it("checkpoint takes priority over sources status", () => {
    expect(
      mapUnipileAccountStatus({
        sources: [{ status: "OK" }],
        checkpoint: { type: "2FA" },
      }),
    ).toEqual({ status: "checkpoint_pending", checkpoint_type: "2FA" });
  });

  it("falls back to top-level status=OK when no sources", () => {
    expect(mapUnipileAccountStatus({ status: "OK" })).toEqual({
      status: "connected",
      checkpoint_type: null,
    });
  });

  it("maps top-level CREDENTIALS when no sources", () => {
    expect(mapUnipileAccountStatus({ status: "CREDENTIALS" })).toEqual({
      status: "credentials_required",
      checkpoint_type: null,
    });
  });

  it("maps checkpoint pending (legacy shape with top-level status)", () => {
    expect(
      mapUnipileAccountStatus({
        status: "OK",
        checkpoint: { type: "2FA" },
      }),
    ).toEqual({ status: "checkpoint_pending", checkpoint_type: "2FA" });
  });
});
