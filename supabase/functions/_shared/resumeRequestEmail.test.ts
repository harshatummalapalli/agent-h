import { describe, expect, it } from "vitest";
import {
  buildResumeRequestEmailPreview,
  buildResumeRequestReplyTo,
} from "./resumeRequestEmail.ts";

describe("resumeRequestEmail", () => {
  it("builds reply-to with candidate prefix", () => {
    expect(buildResumeRequestReplyTo(5, 9, "replies.example.com")).toBe(
      "candidate-5-deal-9@replies.example.com",
    );
  });

  it("builds resume request email preview without sending", () => {
    const preview = buildResumeRequestEmailPreview({
      candidateId: 5,
      dealId: 9,
      candidateName: "Alex Doe",
      candidateEmail: "alex@example.com",
      dealName: "Backend Engineer",
      receivingDomain: "replies.example.com",
    });

    expect(preview.to).toBe("alex@example.com");
    expect(preview.subject).toContain("resume");
    expect(preview.html).toContain("Alex Doe");
  });
});
