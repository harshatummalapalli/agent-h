#!/usr/bin/env node
// crustdata-live-search.mjs — Live smoke-test against the Crustdata person search API.
//
// Usage:
//   CRUSTDATA_API_KEY=<key> node scripts/crustdata-live-search.mjs
//   CRUSTDATA_API_KEY=<key> node scripts/crustdata-live-search.mjs --compare-dot-ops
//
// --compare-dot-ops: settle (.) matching strategy with three real API calls
// against the same multi-word title phrase (a=full phrase, b=shingle OR-group,
// c=pipe-joined shingles). Prints total_count + sample titles for each.
//
// Default mode (no flag): docs-example smoke tests. Exits 0 if key missing (CI-safe).
// --compare-dot-ops: exits 1 if key missing (must not silently skip).

const CRUSTDATA_API_KEY = process.env.CRUSTDATA_API_KEY;
const API_URL = "https://api.crustdata.com/person/search";
const API_VERSION = "2025-11-01";
const LIMIT = 3;
const COMPARE = process.argv.includes("--compare-dot-ops");

// Multi-word phrase with a meaningful candidate pool (3 words → 2 shingles).
const TITLE_FIELD = "experience.employment_details.current.title";
const PHRASE =
  process.env.CRUSTDATA_COMPARE_PHRASE || "Machine Learning Engineer";

if (!CRUSTDATA_API_KEY) {
  if (COMPARE) {
    console.error(
      "[crustdata-live-search] CRUSTDATA_API_KEY is required for --compare-dot-ops.",
    );
    process.exit(1);
  }
  console.warn(
    "[crustdata-live-search] CRUSTDATA_API_KEY not set — skipping live search smoke-test.",
  );
  process.exit(0);
}

/** Split a phrase into overlapping 2-word shingles (mirrors query-builder). */
function shingle2(phrase, maxTerms = 6) {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 2) return words.length > 0 ? [words.join(" ")] : [];
  const out = [];
  for (let i = 0; i + 2 <= words.length; i++) {
    out.push(words.slice(i, i + 2).join(" "));
  }
  return out.slice(0, maxTerms);
}

/** POST /person/search and return response JSON (or null on error). */
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
    return null;
  }

  const data = await res.json();
  const total = data.total_count ?? data.profiles?.length ?? 0;
  console.warn(`  total_count: ${total}`);

  const profiles = data.profiles ?? [];
  for (let i = 0; i < Math.min(3, profiles.length); i++) {
    const p = profiles[i];
    const bp = p.basic_profile ?? {};
    const name =
      bp.full_name ??
      bp.name ??
      [bp.first_name, bp.last_name].filter(Boolean).join(" ") ??
      "(unknown)";
    const title =
      p.experience?.employment_details?.current?.[0]?.title ?? "(no title)";
    console.warn(`  [${i + 1}] ${name} — ${title}`);
  }
  if (profiles.length === 0) {
    console.warn("  (no profiles returned)");
  }
  return { total, profiles };
}

if (COMPARE) {
  const shingles = shingle2(PHRASE);
  console.warn(`\n=== (.) strategy comparison ===`);
  console.warn(`phrase: "${PHRASE}"`);
  console.warn(`shingles: ${JSON.stringify(shingles)}`);
  console.warn(`field: ${TITLE_FIELD}`);

  // (a) full phrase as one plain (.) — no shingles, no pipe
  const a = await search(`(a) full-phrase (.) — "${PHRASE}"`, {
    filters: {
      field: TITLE_FIELD,
      type: "(.)",
      value: PHRASE,
    },
    fields: ["basic_profile", "experience"],
  });

  // (b) 2-word shingles OR-grouped as separate conditions
  const bFilters =
    shingles.length === 1
      ? { field: TITLE_FIELD, type: "(.)", value: shingles[0] }
      : {
          op: "or",
          conditions: shingles.map((value) => ({
            field: TITLE_FIELD,
            type: "(.)",
            value,
          })),
        };
  const b = await search(`(b) shingle OR-group — ${JSON.stringify(shingles)}`, {
    filters: bFilters,
    fields: ["basic_profile", "experience"],
  });

  // (c) pipe-joined shingles in one (.) value (AND-of-words per docs)
  const pipeValue = shingles.join("|");
  const c = await search(`(c) pipe-joined shingles — "${pipeValue}"`, {
    filters: {
      field: TITLE_FIELD,
      type: "(.)",
      value: pipeValue,
    },
    fields: ["basic_profile", "experience"],
  });

  console.warn(`\n=== Summary ===`);
  console.warn(`(a) full-phrase total_count:        ${a?.total ?? "ERROR"}`);
  console.warn(`(b) shingle OR-group total_count:   ${b?.total ?? "ERROR"}`);
  console.warn(`(c) pipe-joined shingles total_count: ${c?.total ?? "ERROR"}`);
  if (a && b) {
    const ratio = a.total > 0 ? (b.total / a.total).toFixed(2) : "n/a (a is 0)";
    console.warn(`(b)/(a) ratio: ${ratio}`);
    if (b.total > a.total) {
      console.warn(
        "→ (b) is broader than (a). Prefer (a) full-phrase if titles in (b) look over-broad.",
      );
    } else if (a.total > b.total) {
      console.warn(
        "→ (a) returned MORE than (b) — unexpected; inspect sample titles.",
      );
    } else {
      console.warn("→ (a) and (b) returned the same total_count.");
    }
  }
  if (c && a) {
    console.warn(
      `(c) vs (a): pipe form ${c.total === a.total ? "matches" : c.total < a.total ? "UNDER-matches" : "OVER-matches"} full phrase`,
    );
  }
  console.warn("\n── Done ───────────────────────────────────────");
  process.exit(0);
}

// ─── Default smoke tests (docs examples) ───────────────────────────────────

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
