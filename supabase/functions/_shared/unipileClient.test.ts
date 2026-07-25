import { describe, expect, it } from "vitest";
import {
  detectLinkedInSeatType,
  mapUnipileAccountStatus,
} from "./unipileClientHelpers.ts";

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
