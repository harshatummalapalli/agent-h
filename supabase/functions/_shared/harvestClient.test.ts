import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Stub Deno global for vitest environment
const _deno = { env: { get: (_k: string) => undefined as string | undefined } };
if (typeof globalThis.Deno === "undefined") {
  // @ts-expect-error test shim
  globalThis.Deno = _deno;
}

// We need to spy on the module-level HARVESTAPI_KEY consumption.
// Re-import after setting the env stub.
vi.stubGlobal("Deno", {
  env: {
    get: (k: string) => (k === "HARVESTAPI_KEY" ? "test-key" : undefined),
  },
});

// Dynamic import so the module reads the stubbed Deno.env at load time.
const {
  enrichProfileFromHarvest,
  batchEnrichFromHarvest,
  buildWorkHistorySummary,
  runWithConcurrency,
  fetchHarvestProfile,
  enrichCandidatesWithHarvestSkills,
} = await import("./harvestClient");

// ── helpers ───────────────────────────────────────────────────────────────────

const MOCK_URL = "https://www.linkedin.com/in/jdoe";

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

// ── enrichProfileFromHarvest ──────────────────────────────────────────────────

describe("enrichProfileFromHarvest", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("returns a normalized profile on success", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        profilePictureUrl: "https://example.com/photo.jpg",
        headline: "Staff Engineer",
        summary: "10 years in distributed systems",
        skills: ["TypeScript", "Rust"],
        experiences: [
          {
            title: "Staff Engineer",
            companyName: "Acme",
            startDate: "2021-01",
            endDate: null,
          },
        ],
        educations: [{ school: "MIT", degree: "BS", fieldOfStudy: "CS" }],
      }),
    );

    const profile = await enrichProfileFromHarvest(MOCK_URL);

    expect(profile).not.toBeNull();
    expect(profile!.profilePictureUrl).toBe("https://example.com/photo.jpg");
    expect(profile!.skills).toEqual(["TypeScript", "Rust"]);
    expect(profile!.experiences).toHaveLength(1);
    expect(profile!.experiences[0].companyName).toBe("Acme");
    expect(profile!.educations[0].school).toBe("MIT");
  });

  it("returns null on non-OK response", async () => {
    vi.stubGlobal("fetch", mockFetch({}, 404));
    const profile = await enrichProfileFromHarvest(MOCK_URL);
    expect(profile).toBeNull();
  });

  it("returns null on fetch network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );
    const profile = await enrichProfileFromHarvest(MOCK_URL);
    expect(profile).toBeNull();
  });

  it("returns null on invalid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("bad json")),
      }),
    );
    const profile = await enrichProfileFromHarvest(MOCK_URL);
    expect(profile).toBeNull();
  });

  it("handles missing fields gracefully", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    const profile = await enrichProfileFromHarvest(MOCK_URL);
    expect(profile).not.toBeNull();
    expect(profile!.skills).toEqual([]);
    expect(profile!.experiences).toEqual([]);
    expect(profile!.educations).toEqual([]);
    expect(profile!.profilePictureUrl).toBeNull();
  });

  it("includes X-API-Key header", async () => {
    const fetchMock = mockFetch({
      skills: [],
      experiences: [],
      educations: [],
    });
    vi.stubGlobal("fetch", fetchMock);

    await enrichProfileFromHarvest(MOCK_URL);

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toContain("harvestapi.io");
    expect((calledInit.headers as Record<string, string>)["X-API-Key"]).toBe(
      "test-key",
    );
  });
});

// ── batchEnrichFromHarvest ────────────────────────────────────────────────────

describe("batchEnrichFromHarvest", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns a map with results for each URL", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ skills: ["Go"], experiences: [], educations: [] }),
    );

    const urls = ["https://linkedin.com/in/a", "https://linkedin.com/in/b"];
    const results = await batchEnrichFromHarvest(urls, 2);

    expect(results.size).toBe(2);
    expect(results.get(urls[0])?.skills).toEqual(["Go"]);
    expect(results.get(urls[1])?.skills).toEqual(["Go"]);
  });

  it("returns empty map for empty input", async () => {
    const results = await batchEnrichFromHarvest([]);
    expect(results.size).toBe(0);
  });

  it("maps failed URLs to null without throwing", async () => {
    vi.stubGlobal("fetch", mockFetch({}, 500));

    const results = await batchEnrichFromHarvest(
      ["https://linkedin.com/in/x"],
      1,
    );
    expect(results.get("https://linkedin.com/in/x")).toBeNull();
  });
});

// ── buildWorkHistorySummary ───────────────────────────────────────────────────

describe("buildWorkHistorySummary", () => {
  it("builds a compact summary from experiences", () => {
    const exps = [
      {
        title: "Staff Eng",
        companyName: "Acme",
        startDate: "2021-01",
        endDate: "2024-06",
      },
      {
        title: "Senior Eng",
        companyName: "Beta",
        startDate: "2018-03",
        endDate: "2021-01",
      },
    ];
    const summary = buildWorkHistorySummary(exps);
    expect(summary).toContain("Staff Eng @ Acme");
    expect(summary).toContain("2021–2024");
    expect(summary).toContain("Senior Eng @ Beta");
  });

  it("handles missing dates", () => {
    const exps = [{ title: "CEO", companyName: "StartupX" }];
    const summary = buildWorkHistorySummary(exps);
    expect(summary).toBe("CEO @ StartupX");
  });

  it("caps at maxEntries", () => {
    const exps = Array.from({ length: 5 }, (_, i) => ({
      title: `Role ${i}`,
      companyName: `Co ${i}`,
      startDate: "2020-01",
      endDate: "2021-01",
    }));
    const summary = buildWorkHistorySummary(exps, 2);
    expect(summary.split(",")).toHaveLength(2);
  });

  it("returns empty string for empty input", () => {
    expect(buildWorkHistorySummary([])).toBe("");
  });
});

// ── runWithConcurrency ────────────────────────────────────────────────────────

describe("runWithConcurrency", () => {
  it("runs all tasks and returns results in order", async () => {
    const results = await runWithConcurrency(
      [async () => 1, async () => 2, async () => 3],
      2,
    );
    expect(results).toEqual([1, 2, 3]);
  });

  it("respects concurrency limit of 1 (serial execution)", async () => {
    const order: number[] = [];
    let inflight = 0;
    let maxInflight = 0;

    const tasks = Array.from({ length: 4 }, (_, i) => async () => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 5));
      order.push(i);
      inflight--;
    });

    await runWithConcurrency(tasks, 1);
    expect(maxInflight).toBe(1);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it("handles empty task list", async () => {
    const results = await runWithConcurrency([], 5);
    expect(results).toEqual([]);
  });
});

// ── fetchHarvestProfile ───────────────────────────────────────────────────────

describe("fetchHarvestProfile", () => {
  afterEach(() => vi.restoreAllMocks());

  it("retries on 429 and succeeds on second attempt", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 429 });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              skills: ["Python"],
              experiences: [],
              educations: [],
            }),
        });
      }),
    );

    const profile = await fetchHarvestProfile(MOCK_URL);
    expect(callCount).toBe(2);
    expect(profile).not.toBeNull();
    expect(profile!.skills).toEqual(["Python"]);
  });

  it("returns null after exhausting retries on 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429 }),
    );
    const profile = await fetchHarvestProfile(MOCK_URL);
    expect(profile).toBeNull();
  });

  it("does not retry on 404", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({ ok: false, status: 404 });
      }),
    );
    const profile = await fetchHarvestProfile(MOCK_URL);
    expect(callCount).toBe(1);
    expect(profile).toBeNull();
  });

  it("appends main=true when cheap=true (default)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ skills: [], experiences: [], educations: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchHarvestProfile(MOCK_URL);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("main=true");
  });

  it("does not append main=true when cheap=false", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ skills: [], experiences: [], educations: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchHarvestProfile(MOCK_URL, { cheap: false });
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("main=true");
  });

  it("parses certifications from string array", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        skills: [],
        certifications: ["AWS Certified Developer", "GCP Professional"],
        experiences: [],
        educations: [],
      }),
    );
    const profile = await fetchHarvestProfile(MOCK_URL);
    expect(profile!.certifications).toEqual([
      "AWS Certified Developer",
      "GCP Professional",
    ]);
  });

  it("parses certifications from object array with .name", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        skills: [],
        certifications: [{ name: "AWS Certified Developer" }, { name: "CKA" }],
        experiences: [],
        educations: [],
      }),
    );
    const profile = await fetchHarvestProfile(MOCK_URL);
    expect(profile!.certifications).toEqual(["AWS Certified Developer", "CKA"]);
  });

  it("parses emails from string array", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        skills: [],
        emails: ["alice@example.com", "alice@work.com"],
        experiences: [],
        educations: [],
      }),
    );
    const profile = await fetchHarvestProfile(MOCK_URL);
    expect(profile!.emails).toEqual(["alice@example.com", "alice@work.com"]);
  });

  it("sorts emails personal-first when type metadata present", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        skills: [],
        emails: [
          { email: "alice@work.com", type: "work" },
          { email: "alice@gmail.com", type: "personal" },
        ],
        experiences: [],
        educations: [],
      }),
    );
    const profile = await fetchHarvestProfile(MOCK_URL);
    expect(profile!.emails![0]).toBe("alice@gmail.com");
  });
});

// ── enrichCandidatesWithHarvestSkills ─────────────────────────────────────────

describe("enrichCandidatesWithHarvestSkills", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns a Map with correct shape for each URL", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        profilePictureUrl: "https://example.com/photo.jpg",
        skills: ["Go", "Kubernetes"],
        certifications: ["CKA"],
        emails: [{ email: "bob@gmail.com", type: "personal" }],
        experiences: [],
        educations: [],
      }),
    );

    const urls = ["https://linkedin.com/in/bob"];
    const map = await enrichCandidatesWithHarvestSkills(urls);

    expect(map.size).toBe(1);
    const entry = map.get(urls[0])!;
    expect(entry.skills).toEqual(["Go", "Kubernetes"]);
    expect(entry.certifications).toEqual(["CKA"]);
    expect(entry.photoUrl).toBe("https://example.com/photo.jpg");
    expect(entry.email).toBe("bob@gmail.com");
  });

  it("includes failed URLs with empty defaults", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    const urls = ["https://linkedin.com/in/nobody"];
    const map = await enrichCandidatesWithHarvestSkills(urls);
    expect(map.size).toBe(1);
    const entry = map.get(urls[0])!;
    expect(entry.skills).toEqual([]);
    expect(entry.photoUrl).toBeNull();
    expect(entry.email).toBeNull();
  });

  it("returns empty map when no URLs provided", async () => {
    const map = await enrichCandidatesWithHarvestSkills([]);
    expect(map.size).toBe(0);
  });
});
