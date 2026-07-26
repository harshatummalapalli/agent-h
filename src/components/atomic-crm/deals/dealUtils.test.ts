import { commands } from "vitest/browser";

import { formatISODateString } from "./dealUtils";

describe("formatISODateString", () => {
  let originalTimezone: string;

  beforeEach(() => {
    originalTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  });

  afterEach(async () => {
    await commands.setTimezone(originalTimezone);
  });

  it("formats a valid ISO date string correctly", () => {
    const isoDate = "2024-06-15";
    const formattedDate = formatISODateString(isoDate);
    expect(formattedDate).toBe("Jun 15, 2024");
  });

  it("should not shift the date regardless of timezone", async () => {
    // Uses CDP (Emulation.setTimezoneOverride) to actually change the browser's
    // timezone at runtime so we can catch regressions where someone replaces the
    // manual date-component parse with new Date(isoString), which would shift
    // dates in negative-offset timezones like America/New_York.
    const isoDate = "2024-06-15";
    await commands.setTimezone("America/New_York");
    expect(formatISODateString(isoDate)).toBe("Jun 15, 2024");

    await commands.setTimezone("Asia/Tokyo");
    expect(formatISODateString(isoDate)).toBe("Jun 15, 2024");

    await commands.setTimezone("UTC");
    expect(formatISODateString(isoDate)).toBe("Jun 15, 2024");

    await commands.setTimezone("Pacific/Auckland");
    expect(formatISODateString(isoDate)).toBe("Jun 15, 2024");
  });

  it("returns empty string for an invalid date string", () => {
    expect(formatISODateString("invalid-date")).toBe("");
  });

  it("returns empty string for a date string with wrong format", () => {
    expect(formatISODateString("15-06-2024")).toBe("");
  });

  it("accepts a full ISO timestamp and extracts the date portion", () => {
    expect(formatISODateString("2024-06-15T12:34:56Z")).toBe("Jun 15, 2024");
    expect(formatISODateString("2024-06-15T00:00:00.000Z")).toBe(
      "Jun 15, 2024",
    );
  });

  it("returns empty string for null or undefined", () => {
    expect(formatISODateString(null)).toBe("");
    expect(formatISODateString(undefined)).toBe("");
    expect(formatISODateString("")).toBe("");
  });
});
