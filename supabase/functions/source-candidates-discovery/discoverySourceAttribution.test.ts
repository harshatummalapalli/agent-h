import { describe, it, expect } from "vitest";
import {
  buildDiscoveryAttributionLookupPath,
  buildDiscoveryAttributionRows,
  isDiscoverySearchContinuation,
  parseAttributionVendorFromRows,
  resolveSourcedViaFromAttributionVendor,
  stripVendorFieldsForClient,
  vendorToSourcedVia,
} from "./discoverySourceAttribution";

describe("isDiscoverySearchContinuation", () => {
  it("returns false for preview calls", () => {
    expect(
      isDiscoverySearchContinuation({
        scrollToken: undefined,
        isPreview: true,
        cachedScrollQuery: "q1",
        cachedScrollToken: "tok",
        queryText: "q1",
      }),
    ).toBe(false);
  });

  it("returns true when the client sent a scroll token", () => {
    expect(
      isDiscoverySearchContinuation({
        scrollToken: "next-page",
        isPreview: false,
        cachedScrollQuery: "q1",
        cachedScrollToken: null,
        queryText: "q1",
      }),
    ).toBe(true);
  });

  it("returns true when resuming from the deal scroll cache with the same query", () => {
    expect(
      isDiscoverySearchContinuation({
        scrollToken: undefined,
        isPreview: false,
        cachedScrollQuery: "q1",
        cachedScrollToken: "tok",
        queryText: "q1",
      }),
    ).toBe(true);
  });

  it("returns false when the query changed (fresh search)", () => {
    expect(
      isDiscoverySearchContinuation({
        scrollToken: undefined,
        isPreview: false,
        cachedScrollQuery: "old-query",
        cachedScrollToken: "tok",
        queryText: "new-query",
      }),
    ).toBe(false);
  });
});

describe("buildDiscoveryAttributionRows", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");

  it("maps non-empty candidate ids to attribution rows", () => {
    const rows = buildDiscoveryAttributionRows(
      42,
      "crustdata",
      [
        { id: "900001", full_name: "Ada" },
        { id: "900002", full_name: "Bob" },
      ],
      now,
    );

    expect(rows).toEqual([
      {
        deal_id: 42,
        source_id: "900001",
        vendor: "crustdata",
        expires_at: "2026-07-31T12:00:00.000Z",
      },
      {
        deal_id: 42,
        source_id: "900002",
        vendor: "crustdata",
        expires_at: "2026-07-31T12:00:00.000Z",
      },
    ]);
  });

  it("de-duplicates repeated source ids within one batch", () => {
    const rows = buildDiscoveryAttributionRows(1, "coresignal", [
      { id: "2847193056" },
      { id: "2847193056" },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.source_id).toBe("2847193056");
    expect(rows[0]?.vendor).toBe("coresignal");
  });

  it("skips candidates with empty ids", () => {
    const rows = buildDiscoveryAttributionRows(1, "coresignal", [
      { id: "" },
      { id: "2847193056" },
    ]);

    expect(rows).toHaveLength(1);
  });
});

describe("stripVendorFieldsForClient", () => {
  it("removes _source_vendor from discovery API candidates", () => {
    const clientCandidate = stripVendorFieldsForClient({
      id: "2847193056",
      full_name: "Ada Lovelace",
      _source_vendor: "coresignal",
      _match_score: 0.82,
    });

    expect(clientCandidate).toEqual({
      id: "2847193056",
      full_name: "Ada Lovelace",
      _match_score: 0.82,
    });
    expect(clientCandidate).not.toHaveProperty("_source_vendor");
  });
});

describe("vendor attribution lookup helpers", () => {
  it("builds a PostgREST lookup path scoped to deal, source_id, and expiry", () => {
    const path = buildDiscoveryAttributionLookupPath(
      7,
      "881234567890",
      "2026-07-24T12:00:00.000Z",
    );

    expect(path).toContain("deal_id=eq.7");
    expect(path).toContain("source_id=eq.881234567890");
    expect(path).toContain("expires_at=gt.");
    expect(path).toContain("select=vendor");
  });

  it("parses vendor from attribution lookup rows", () => {
    expect(parseAttributionVendorFromRows([{ vendor: "crustdata" }])).toBe(
      "crustdata",
    );
    expect(parseAttributionVendorFromRows([])).toBeNull();
    expect(parseAttributionVendorFromRows(null)).toBeNull();
  });

  it("maps parsed vendor to sourced_via labels", () => {
    expect(resolveSourcedViaFromAttributionVendor("coresignal")).toBe(
      "coresignal_search",
    );
    expect(resolveSourcedViaFromAttributionVendor(null)).toBe("manual");
  });
});

describe("vendorToSourcedVia", () => {
  it("maps known vendors to *_search labels", () => {
    expect(vendorToSourcedVia("crustdata")).toBe("crustdata_search");
    expect(vendorToSourcedVia("coresignal")).toBe("coresignal_search");
  });

  it("falls back to manual when vendor is missing", () => {
    expect(vendorToSourcedVia(null)).toBe("manual");
    expect(vendorToSourcedVia(undefined)).toBe("manual");
  });
});

describe("vendor attribution E2E flow (unit-level)", () => {
  const dealId = 7;
  const now = new Date("2026-07-24T12:00:00.000Z");

  it("CoreSignal: discovery strips vendor, save resolves coresignal_search", () => {
    const rawHit = {
      id: "2847193056",
      full_name: "CoreSignal Person",
      _source_vendor: "coresignal",
    };

    const clientHit = stripVendorFieldsForClient(rawHit);
    expect(clientHit).not.toHaveProperty("_source_vendor");

    const rows = buildDiscoveryAttributionRows(
      dealId,
      "coresignal",
      [rawHit],
      now,
    );
    const vendor = parseAttributionVendorFromRows(
      rows.map((r) => ({ vendor: r.vendor })),
    );
    expect(resolveSourcedViaFromAttributionVendor(vendor)).toBe(
      "coresignal_search",
    );
  });

  it("Crustdata: discovery strips vendor, save resolves crustdata_search", () => {
    const rawHit = {
      id: "881234567890",
      full_name: "Crustdata Person",
      _source_vendor: "crustdata",
    };

    const clientHit = stripVendorFieldsForClient(rawHit);
    expect(clientHit).not.toHaveProperty("_source_vendor");

    const rows = buildDiscoveryAttributionRows(
      dealId,
      "crustdata",
      [rawHit],
      now,
    );
    const vendor = parseAttributionVendorFromRows(
      rows.map((r) => ({ vendor: r.vendor })),
    );
    expect(resolveSourcedViaFromAttributionVendor(vendor)).toBe(
      "crustdata_search",
    );
  });

  it("simulates a full discovery response payload without vendor fields", () => {
    const discoveryResponse = {
      candidates: [
        stripVendorFieldsForClient({
          id: "2847193056",
          full_name: "A",
          _source_vendor: "coresignal",
        }),
        stripVendorFieldsForClient({
          id: "881234567890",
          full_name: "B",
          _source_vendor: "crustdata",
        }),
      ],
    };

    for (const candidate of discoveryResponse.candidates) {
      expect(candidate).not.toHaveProperty("_source_vendor");
    }
  });
});
