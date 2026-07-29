#!/usr/bin/env node
// crustdata-live-search.mjs — Live smoke-test against the Crustdata person search API.
//
// Runs 3-4 minimal POST /person/search calls mirroring Crustdata docs examples.
// Prints total_count and the first profile name/title for each.
//
// Usage:
//   CRUSTDATA_API_KEY=<key> node scripts/crustdata-live-search.mjs
//
// If CRUSTDATA_API_KEY is not set, prints a skip message and exits 0 (CI-safe).

const CRUSTDATA_API_KEY = process.env.CRUSTDATA_API_KEY;
const API_URL = "https://api.crustdata.com/person/search";
const API_VERSION = "2025-11-01";
const LIMIT = 3;

if (!CRUSTDATA_API_KEY) {
  console.warn(
    "[crustdata-live-search] CRUSTDATA_API_KEY not set — skipping live search smoke-test.",
  );
  process.exit(0);
}

/** POST /person/search and return response JSON. */
async function search(label, payload) {
  console.warn(`\n── ${label} ─────────────────────────────────`);
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CRUSTDATA_API_KEY}`,
      "x-api-version": API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...payload, limit: LIMIT }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    console.error(`  HTTP ${res.status}: ${text.slice(0, 300)}`);
    return;
  }

  const data = await res.json();
  const total = data.total_count ?? data.profiles?.length ?? 0;
  console.warn(`  total_count: ${total}`);

  const first = data.profiles?.[0];
  if (first) {
    const bp = first.basic_profile;
    const name =
      bp?.full_name ??
      [bp?.first_name, bp?.last_name].filter(Boolean).join(" ") ??
      "(unknown)";
    const title =
      first.experience?.employment_details?.current?.[0]?.title ?? "(no title)";
    console.warn(`  first: ${name} — ${title}`);
  } else {
    console.warn("  (no profiles returned)");
  }
}

// ─── Test 1: India + machine learning skill ────────────────────────────────

await search("India + machine learning skill", {
  filters: {
    op: "and",
    conditions: [
      {
        field: "basic_profile.location.country",
        type: "=",
        value: "India",
      },
      {
        field: "skills.professional_network_skills",
        type: "(.)",
        value: "machine learning",
      },
    ],
  },
  fields: ["basic_profile", "experience"],
});

// ─── Test 2: recently_changed_jobs = true ─────────────────────────────────

await search("recently_changed_jobs = true + Software Engineer", {
  filters: {
    op: "and",
    conditions: [
      {
        field: "recently_changed_jobs",
        type: "=",
        value: true,
      },
      {
        field: "experience.employment_details.current.title",
        type: "(.)",
        value: "Software Engineer",
      },
    ],
  },
  fields: ["basic_profile", "experience"],
});

// ─── Test 3: geo_distance near San Francisco 10 mi ────────────────────────

await search("geo_distance near San Francisco 10 mi + CTO", {
  filters: {
    op: "and",
    conditions: [
      {
        field: "professional_network.location.raw",
        type: "geo_distance",
        value: {
          location: "San Francisco, CA",
          distance: 10,
          unit: "mi",
        },
      },
      {
        op: "or",
        conditions: [
          {
            field: "experience.employment_details.current.title",
            type: "(.)",
            value: "CTO",
          },
          {
            field: "experience.employment_details.current.title",
            type: "(.)",
            value: "Chief Technology Officer",
          },
        ],
      },
    ],
  },
  fields: ["basic_profile", "experience"],
});

// ─── Test 4: open_to_cards CAREER_INTEREST ────────────────────────────────

await search("open_to_cards CAREER_INTEREST + United States", {
  filters: {
    op: "and",
    conditions: [
      {
        field: "professional_network.open_to_cards",
        type: "in",
        value: ["CAREER_INTEREST"],
      },
      {
        field: "basic_profile.location.country",
        type: "=",
        value: "United States",
      },
    ],
  },
  fields: ["basic_profile", "professional_network"],
});

console.warn("\n── Done ───────────────────────────────────────");
