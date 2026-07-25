import { describe, expect, it } from "vitest";
import {
  buildBookingEmailPreview,
  buildBookingLinkUrl,
} from "./bookingLinkEmail.ts";

describe("bookingLinkEmail", () => {
  it("builds a Cal.com booking URL with metadata", () => {
    const url = buildBookingLinkUrl(7, 9, "Alex Doe", "alex@example.com", {
      calBaseUrl: "https://cal.example.com",
      calEventSlug: "screening",
      calUsername: "recruiter",
    });

    expect(url).toContain("https://cal.example.com/recruiter/screening?");
    expect(url).toContain("metadata%5BcandidateId%5D=7");
    expect(url).toContain("metadata%5BdealId%5D=9");
    expect(url).toContain("email=alex%40example.com");
  });

  it("builds booking email preview without sending", () => {
    const preview = buildBookingEmailPreview({
      candidateName: "Alex Doe",
      candidateEmail: "alex@example.com",
      dealName: "Backend Engineer",
      bookingLinkUrl: "https://cal.example.com/recruiter/screening?x=1",
    });

    expect(preview.to).toBe("alex@example.com");
    expect(preview.subject).toContain("Backend Engineer");
    expect(preview.html).toContain(
      "https://cal.example.com/recruiter/screening?x=1",
    );
  });
});
