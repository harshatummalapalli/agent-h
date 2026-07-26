import { format } from "date-fns";

import type { DealStage } from "../types";

export const findDealLabel = (dealStages: DealStage[], dealValue: string) => {
  const dealStage = dealStages.find((stage) => stage.value === dealValue);
  return dealStage?.label;
};

export function getRelativeTimeString(
  dateString: string,
  locale = "en",
): string {
  const date = new Date(dateString);
  date.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diff = date.getTime() - today.getTime();
  const unitDiff = Math.round(diff / (1000 * 60 * 60 * 24));

  // Check if the date is more than one week old
  if (Math.abs(unitDiff) > 7) {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
    }).format(date);
  }

  // Intl.RelativeTimeFormat for dates within the last week
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  return ucFirst(rtf.format(unitDiff, "day"));
}

function ucFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

const isoDatePrefixRegex = /^(\d{4})-(\d{2})-(\d{2})/;

// Accepts YYYY-MM-DD or full ISO timestamps (e.g. "2026-07-26T12:34:56Z").
// Returns "" for null/undefined/unparseable — never throws on render paths.
export function formatISODateString(
  dateString: string | null | undefined,
): string {
  if (!dateString) return "";
  const match = dateString.match(isoDatePrefixRegex);
  if (!match) return "";
  // Parse date components in local timezone to avoid UTC off-by-one-day shifts.
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime())) return "";
  return format(date, "PP");
}
