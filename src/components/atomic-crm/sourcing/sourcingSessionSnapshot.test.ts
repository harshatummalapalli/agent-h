import { describe, expect, it, beforeEach } from "vitest";
import {
  clearSourcingSnapshot,
  loadSourcingSnapshot,
  saveSourcingSnapshot,
  type SourcingSessionSnapshot,
} from "./sourcingSessionSnapshot";

const snapshot: SourcingSessionSnapshot = {
  version: 1,
  savedAt: "2026-07-25T00:00:00.000Z",
  dealId: "42",
  stage: "fetched",
  candidates: [{ id: "p1", full_name: "Alex Example" }],
  scrollToken: "cursor-abc",
  total: 100,
  totalMatchesAll: 500,
  notes: ["note"],
  saveStates: { p1: "idle" },
  candidateDbIds: {},
};

describe("sourcingSessionSnapshot", () => {
  beforeEach(() => {
    clearSourcingSnapshot("42");
    clearSourcingSnapshot("99");
  });

  it("round-trips snapshot for a deal", () => {
    saveSourcingSnapshot(snapshot);
    expect(loadSourcingSnapshot("42")).toEqual(snapshot);
    expect(loadSourcingSnapshot("99")).toBeNull();
  });

  it("clear removes snapshot", () => {
    saveSourcingSnapshot(snapshot);
    clearSourcingSnapshot("42");
    expect(loadSourcingSnapshot("42")).toBeNull();
  });
});
