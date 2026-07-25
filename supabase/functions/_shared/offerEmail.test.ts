import { describe, expect, it } from "vitest";
import {
  buildOfferEmailPreview,
  buildOfferReplyToAddress,
  formatCompensation,
} from "./offerEmail.ts";

describe("offerEmail", () => {
  it("formats compensation", () => {
    expect(formatCompensation(1200000, "INR", "annual")).toBe(
      "INR 1,200,000 / annual",
    );
  });

  it("builds reply-to with offer prefix", () => {
    expect(buildOfferReplyToAddress(12, 34, "replies.example.com")).toBe(
      "offer-12-deal-34@replies.example.com",
    );
  });

  it("builds offer email preview without sending", () => {
    const preview = buildOfferEmailPreview({
      candidateId: 12,
      dealId: 34,
      candidateName: "Alex Doe",
      candidateEmail: "alex@example.com",
      dealName: "Backend Engineer",
      receivingDomain: "replies.example.com",
      terms: {
        position_title: "Senior Engineer",
        compensation_amount: 1500000,
        compensation_currency: "INR",
        compensation_frequency: "annual",
        start_date: "2026-08-01",
        expiry_date: "2026-08-15",
        benefits_summary: "Health insurance included.",
      },
    });

    expect(preview.to).toBe("alex@example.com");
    expect(preview.reply_to).toBe("offer-12-deal-34@replies.example.com");
    expect(preview.subject).toContain("Senior Engineer");
    expect(preview.html).toContain("Alex Doe");
    expect(preview.html).not.toContain("undefined");
  });
});
