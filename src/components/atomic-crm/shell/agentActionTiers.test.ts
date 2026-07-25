import { describe, expect, it } from "vitest";
import { getActionTier, isLeavesPlatformAction } from "./agentActionTiers";

describe("agentActionTiers", () => {
  it("classifies read actions", () => {
    expect(getActionTier("show_roles")).toBe("read");
    expect(getActionTier("show_candidates")).toBe("read");
  });

  it("classifies reversible actions", () => {
    expect(getActionTier("continue_sourcing")).toBe("reversible");
    expect(getActionTier("relax_criterion")).toBe("reversible");
  });

  it("classifies leaves-platform actions", () => {
    expect(isLeavesPlatformAction("send_offer")).toBe(true);
    expect(isLeavesPlatformAction("send_booking_link")).toBe(true);
    expect(isLeavesPlatformAction("send_first_outreach")).toBe(true);
  });
});
