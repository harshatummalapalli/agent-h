// Agent H Stage 3: free-portal sourcing (2026-07-19).
//
// Why this exists: Harsha's explicit call, made before deciding whether to
// pay for Coresignal (or any other paid vendor) credits at all -- "before we
// decide on getting CoreSignal's payment plans or other vendor's payment
// plans, can we have another recalibrated loop running for x-ray searching
// various free portals ... to source candidates?" This is a SEPARATE,
// additive discovery path, deliberately NOT folded into
// source-candidates-discovery/index.ts's DISCOVERY_PROVIDERS/runDiscovery --
// that file is the one that caused today's 502 regression, and it's already
// well past the 800-line file-size ceiling in coding-style.md. A new
// function keeps this genuinely free feature isolated from the fragile,
// paid-vendor-dependent search path, per "grow the file count, not the
// file."
//
// What "free" actually means here, confirmed directly against each
// portal's own docs before writing this (not assumed):
//   - GitHub: official public REST Search API (docs.github.com/en/rest/
//     search). Unauthenticated: 10 requests/min. With a personal access
//     token (GITHUB_TOKEN, free to generate, zero billing): 30/min for
//     search specifically. No scraping, no bot-detection concern at all --
//     this is GitHub's own sanctioned API surface.
//   - Stack Overflow: official Stack Exchange API v2.3 (api.stackexchange.
//     com/docs). 300 requests/day unauthenticated per IP, 10,000/day with a
//     free STACK_EXCHANGE_KEY (also free to generate). There is no "search
//     users by skill" endpoint, but /tags/{tags}/top-answerers/{period} is a
//     real, official, skill-relevant proxy: the highest-reputation answerers
//     for a given tag are a genuinely strong signal of expertise in that
//     technology.
//   - Hugging Face: official Hub API (huggingface.co/docs/hub/api). No
//     dedicated "search users" endpoint exists (confirmed -- the Hub API's
//     search surface covers models/datasets/Spaces, not people directly).
//     Proxy used here instead: search models/datasets by keyword, and treat
//     the AUTHORS of matching repos as the candidate signal -- arguably a
//     BETTER proxy for AI/ML talent than a generic profile search would be,
//     since it's evidence of actual published work, not a self-reported bio.
//   - Kaggle: official public API (kaggle.com/docs/api), Basic Auth with a
//     free username+key pair (KAGGLE_USERNAME / KAGGLE_KEY secrets). Same
//     "no user-search endpoint" gap as Hugging Face -- proxied the same way,
//     via kernel/notebook authors matching a keyword. Disclosed gap: Kaggle's
//     API doesn't expose a public "get any user's profile" endpoint the way
//     GitHub's /users/{login} does, so Kaggle candidates carry only a
//     username + the kernel title/tags that surfaced them -- no bio,
//     location, or company. Thinner signal than the other three, shown
//     honestly via a note rather than a fabricated profile.
//
// Kaggle/Hugging Face DROPPED from the default per-role search (2026-07-22,
// Harsha's explicit call after seeing live results on the Epiq role): "I
// think we can exclude Kaggle & Hugging Face for all roles." Both portals'
// author-matching proxy is a real signal for a Data Scientist/ML Engineer
// role, but pure noise for most others -- the live Epiq run surfaced Kaggle
// notebook authors whose kernel title happened to contain the substring
// "C#" ("Fuzzy C-Means Clustering", "MNIST - CNN coded in C"), not people
// who actually know C#. searchKaggle/searchHuggingFace are kept below,
// defined but unused by runFreePortalDiscovery's default provider list,
// rather than deleted -- Harsha separately floated a narrower, better-fit
// use for them: looking a candidate's existing Kaggle/Hugging Face profile
// up ON DEMAND if their resume already links to one, instead of searching
// either platform blind for every role. That's a real, separate feature
// (needs resume-link extraction + an on-demand lookup UI) that hasn't been
// built yet -- tracked as a follow-up, not implemented here.
//
// Calibration loop reuse ("another recalibrated loop"): this function reads
// the SAME public.role_brief_learned_criteria rows the Coresignal path
// writes (see supabase/schemas/29_agent_h_learned_criteria.sql), so a
// recruiter's "not a fit" feedback narrows free-portal results too, not just
// Coresignal's. Only require_keyword/exclude_keyword actually apply here --
// years_experience_min/max criteria are silently skipped (disclosed via a
// note, not silently ignored) because none of these four portals expose a
// structured total-experience-duration field the way Coresignal does; there
// is nothing honest to tighten. Applied as a client-side post-filter over
// each candidate's combined bio/skills/title text (case-insensitive
// substring match) rather than a server-side query filter, since none of
// these four APIs has a query language expressive enough for real
// AND/require-this-word semantics against free-text bios -- simplest
// correct thing that actually works, not a fabricated "as if" query.
//
// What this deliberately does NOT do:
//   - No LinkedIn automation of any kind. LinkedIn's own bot-detection/
//     anti-automation defenses make that off the table regardless of
//     accepted risk -- see the frontend's "X-ray Assist" feature instead,
//     which generates ready-to-click search-engine query links for a
//     recruiter to open and review themselves (the recruiter does the
//     actual searching, same as manual X-ray always worked), built entirely
//     client-side in SourceCandidatesPage.tsx with no server call at all.
//   - No blast-radius/criteria-impact preview (unlike the Coresignal path) --
//     these portals have no reliable, honest "total matches" concept the
//     way Coresignal's x-total-results header does, so no fabricated count
//     is shown.
//   - No "search wider"/scroll-token continuation yet -- v1 returns one
//     batch per portal per call; worth adding once real usage shows it's
//     needed.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

// All four optional -- isConfigured() below just means "this portal will be
// queried with a higher, saner rate limit." GitHub, Stack Overflow, and
// Hugging Face all still work with ZERO secrets set (public, unauthenticated
// access, just a lower request ceiling); only Kaggle's API requires
// Basic Auth for every call, even public reads (confirmed directly against
// kaggle.com/docs/api), so it's skipped entirely (not attempted half-
// authenticated) when its two secrets aren't both set.
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");
const STACK_EXCHANGE_KEY = Deno.env.get("STACK_EXCHANGE_KEY");
const KAGGLE_USERNAME = Deno.env.get("KAGGLE_USERNAME");
const KAGGLE_KEY = Deno.env.get("KAGGLE_KEY");

const GITHUB_API_URL = "https://api.github.com";
const STACK_EXCHANGE_API_URL = "https://api.stackexchange.com/2.3";
const HUGGING_FACE_API_URL = "https://huggingface.co/api";
const KAGGLE_API_URL = "https://www.kaggle.com/api/v1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST",
};

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });

async function requireAuth(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing authorization header" }, 401);
  }
  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer" || !token) {
    return jsonResponse({ error: "Invalid authorization header" }, 401);
  }
  try {
    await jose.jwtVerify(token, SUPABASE_JWT_KEYS, {
      issuer: SUPABASE_JWT_ISSUER,
    });
    return null;
  } catch {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
}

// Deliberately thin -- only the fields this function actually needs, unlike
// source-candidates-discovery's full RoleBrief type.
type RoleBrief = {
  id: number;
  name: string | null;
  location: string | null;
  required_skills: string[] | null;
  nice_to_have_keywords: string[] | null;
};

async function fetchRoleBrief(
  roleBriefId: number,
  authHeader: string,
): Promise<RoleBrief | null> {
  const url =
    `${SUPABASE_URL}/rest/v1/deals` +
    `?id=eq.${roleBriefId}` +
    `&select=id,name,location,required_skills,nice_to_have_keywords`;
  const response = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY ?? "", Authorization: authHeader },
  });
  if (!response.ok) {
    console.error("fetchRoleBrief failed", response.status, await response.text());
    return null;
  }
  const rows = await response.json();
  return rows?.[0] ?? null;
}

// Same shape and same table as source-candidates-discovery/index.ts's
// LearnedCriterion/fetchLearnedCriteria -- deliberately duplicated (not
// imported) since each Supabase Edge Function is its own isolated Deno
// module with no shared package between function directories in this repo,
// same convention already used for requireAuth/fetchRoleBrief/CORS_HEADERS
// across every function here.
type LearnedCriterion = {
  id: number;
  criterionType:
    | "require_keyword"
    | "exclude_keyword"
    | "years_experience_min"
    | "years_experience_max";
  value: { keyword?: string; years?: number };
  label: string;
  status: "active" | "relaxed";
};

async function fetchActiveLearnedCriteria(
  dealId: number,
  authHeader: string,
): Promise<LearnedCriterion[]> {
  const url =
    `${SUPABASE_URL}/rest/v1/role_brief_learned_criteria` +
    `?deal_id=eq.${dealId}&status=eq.active` +
    `&select=id,criterion_type,value,label,status&order=created_at.asc`;
  const response = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY ?? "", Authorization: authHeader },
  });
  if (!response.ok) {
    console.error(
      "fetchActiveLearnedCriteria failed",
      response.status,
      await response.text(),
    );
    return [];
  }
  const rows: Array<{
    id: number;
    criterion_type: LearnedCriterion["criterionType"];
    value: LearnedCriterion["value"];
    label: string;
    status: LearnedCriterion["status"];
  }> = await response.json();
  return rows.map((row) => ({
    id: row.id,
    criterionType: row.criterion_type,
    value: row.value ?? {},
    label: row.label,
    status: row.status,
  }));
}

// Common candidate shape every provider below normalizes into -- same
// fields source-candidates-discovery's normalizeCoresignalCandidate/
// normalizeApolloCandidate produce, so save-sourced-candidate (already
// vendor-neutral, keyed off _source_vendor) and the frontend's existing
// candidate card both work unmodified for these portals too.
type FreePortalCandidate = {
  id: string;
  full_name: string | null;
  job_title: string | null;
  job_company_name: string | null;
  location_name: string | null;
  skills: string[];
  linkedin_url: string | null;
  _source_vendor: string;
  // Free-portal-specific: the actual profile/repo/kernel URL, since these
  // aren't LinkedIn-based -- shown alongside (not instead of) linkedin_url,
  // which stays null for all four of these portals (none of them expose a
  // candidate's LinkedIn on their public API).
  _portal_url: string | null;
  // Merge/dedupe (2026-07-19, Harsha's call: "the recruiter doesn't need to
  // know which site... if we get the same candidate in multiple searches,
  // all need to be merged before showing"): when the same name surfaces
  // from more than one portal (see mergeDuplicateCandidates below), this
  // lists every portal that surfaced them, so the merged card can still
  // link out to each profile -- the top-level _source_vendor/_portal_url
  // become just the richest one of the group, not the only one. Absent
  // (undefined) on a candidate that only came from a single portal.
  _all_portals?: Array<{ vendor: string; url: string | null }>;
};

// A widely-used subset of GitHub's `language:` search qualifier values --
// mapping a role brief's free-text required-skill strings onto this list
// lets the query use GitHub's real `language:` filter (far more precise
// than free-text search) whenever a skill IS a language; anything that
// doesn't match falls through to a plain keyword term instead (matched
// against bio/username/README via GitHub's default search behavior).
// Deliberately small and case-insensitive -- not trying to cover every
// GitHub-recognized language, just the common ones a JD is likely to name.
const GITHUB_LANGUAGE_ALIASES: Record<string, string> = {
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
  java: "Java",
  go: "Go",
  golang: "Go",
  rust: "Rust",
  "c++": "C++",
  "c#": "C#",
  ruby: "Ruby",
  php: "PHP",
  swift: "Swift",
  kotlin: "Kotlin",
  scala: "Scala",
};

function combinedSearchableText(candidate: FreePortalCandidate, extra: string[]): string {
  return [
    candidate.full_name ?? "",
    candidate.job_title ?? "",
    candidate.job_company_name ?? "",
    ...(candidate.skills ?? []),
    ...extra,
  ]
    .join(" ")
    .toLowerCase();
}

// --- GitHub provider ---
//
// /search/users query built from title + required/nice-to-have skills
// (language: qualifiers where recognized, plain keyword terms otherwise) +
// location:. Search results are summaries only (login, id, score) --
// GitHub's search API doesn't return bio/location/company inline (confirmed
// directly against docs.github.com/en/rest/search) -- so each result is
// followed by one GET /users/{login} call for the real profile fields.
// Capped at `size` detail lookups to stay well inside GitHub's rate limit
// (30/min search + 5,000/hr core with a token; the summary search call
// itself only costs 1 of those regardless of result count).
async function searchGithub(
  criteria: FreePortalCriteria,
  size: number,
): Promise<{ candidates: FreePortalCandidate[]; note: string }> {
  const qualifiers: string[] = ["type:user"];
  const languageTerms: string[] = [];
  const keywordTerms: string[] = [];

  for (const skill of [...(criteria.requiredSkills ?? []), ...(criteria.niceToHaveKeywords ?? [])]) {
    const mapped = GITHUB_LANGUAGE_ALIASES[skill.trim().toLowerCase()];
    if (mapped && !languageTerms.includes(mapped)) {
      languageTerms.push(mapped);
    } else if (!mapped) {
      keywordTerms.push(skill);
    }
  }
  // GitHub's search treats multiple `language:` qualifiers as AND, which
  // would over-narrow ("must know Python AND Go") -- only the first
  // recognized language is used as a hard qualifier; the rest fall back to
  // plain keyword terms (OR'd in implicitly by GitHub's own search ranking).
  if (languageTerms.length > 0) {
    qualifiers.push(`language:${languageTerms[0]}`);
  }
  if (criteria.location && !/remote/i.test(criteria.location)) {
    qualifiers.push(`location:${criteria.location.split(",")[0].trim()}`);
  }

  const freeText = [...keywordTerms.slice(0, 2), ...languageTerms.slice(1)].join(" ");
  const q = [freeText, ...qualifiers].filter((s) => s.length > 0).join(" ");

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

  const searchResponse = await fetch(
    `${GITHUB_API_URL}/search/users?q=${encodeURIComponent(q)}&per_page=${Math.min(size, 30)}`,
    { headers },
  );
  if (!searchResponse.ok) {
    const body = await searchResponse.text();
    throw new Error(`GitHub search API error (${searchResponse.status}): ${body}`);
  }
  const searchResult = await searchResponse.json();
  const items: Array<{ login: string; id: number; html_url: string }> = searchResult?.items ?? [];

  const candidates: FreePortalCandidate[] = [];
  for (const item of items.slice(0, size)) {
    try {
      const profileResponse = await fetch(`${GITHUB_API_URL}/users/${item.login}`, { headers });
      if (!profileResponse.ok) continue;
      const profile = await profileResponse.json();
      candidates.push({
        id: `github:${item.login}`,
        full_name: typeof profile.name === "string" ? profile.name : item.login,
        job_title: typeof profile.bio === "string" ? profile.bio : null,
        job_company_name: typeof profile.company === "string" ? profile.company : null,
        location_name: typeof profile.location === "string" ? profile.location : null,
        // GitHub's own profile API has no structured skills field --
        // language:/keyword terms that actually matched are attached as a
        // best-effort "why this person" tag list rather than left empty.
        skills: [...languageTerms, ...keywordTerms],
        linkedin_url: null,
        _source_vendor: "github",
        _portal_url: item.html_url,
      });
    } catch (error) {
      console.error("GitHub profile lookup failed (non-fatal)", item.login, error);
    }
  }

  return {
    candidates,
    note: `GitHub: query "${q}" -- ${items.length} user(s) found, ${candidates.length} profile(s) fetched.`,
  };
}

// --- Stack Exchange provider (all relevant sites, not just Stack Overflow) ---
//
// No "search users by skill" endpoint exists on the Stack Exchange API
// (confirmed against api.stackexchange.com/docs) -- /tags/{tags}/top-
// answerers/{period} is used instead: the real, official ranking of highest-
// reputation answerers for a given tag, which is a genuine expertise signal,
// not a fabricated substitute. Location isn't filterable server-side on this
// endpoint, so it's applied as a post-filter against each user's own
// (free-text, self-reported) `location` field.
//
// Multi-site expansion (2026-07-19, Harsha's call: "the other Stack Exchange
// sites are worthwhile too"): the Stack Exchange API is one platform with
// many `site=` values (confirmed -- same api.stackexchange.com/2.3 base for
// every site, just a different `site` query param), so covering AI Stack
// Exchange, Data Science, CrossValidated (stats), Server Fault/Super User,
// and Math Stack Exchange costs nothing new to integrate -- same endpoint,
// same auth, same rate limit pool. A role brief's skills/title are matched
// against STACK_EXCHANGE_DOMAIN_SITES below to decide which EXTRA sites (on
// top of Stack Overflow, always queried) are actually relevant -- an AI
// Engineer role brief pulls in "ai"/"datascience"/"stats", a DevOps role
// pulls in "serverfault"/"superuser", etc. Falls back to a plain top-
// reputation user list on a site (no tag) if the tag itself doesn't exist on
// that site (a 400/404 from the tag endpoint) rather than skipping the site
// entirely -- still a real "who's active and expert on this site" signal.
const STACK_EXCHANGE_DOMAIN_SITES: Record<string, string[]> = {
  "machine learning": ["ai", "datascience", "stats"],
  "deep learning": ["ai", "datascience"],
  llm: ["ai"],
  nlp: ["ai", "datascience"],
  "data science": ["datascience", "stats"],
  statistics: ["stats"],
  devops: ["serverfault", "superuser"],
  linux: ["serverfault", "superuser"],
  sysadmin: ["serverfault"],
  kubernetes: ["serverfault"],
  algorithm: ["cs", "math"],
  algorithms: ["cs", "math"],
  math: ["math"],
  mathematics: ["math"],
};

function pickStackExchangeSites(criteria: FreePortalCriteria): string[] {
  const haystack = [criteria.title, ...(criteria.requiredSkills ?? []), ...(criteria.niceToHaveKeywords ?? [])]
    .filter((s): s is string => typeof s === "string")
    .join(" ")
    .toLowerCase();
  const extraSites = new Set<string>();
  for (const [keyword, sites] of Object.entries(STACK_EXCHANGE_DOMAIN_SITES)) {
    if (haystack.includes(keyword)) {
      sites.forEach((s) => extraSites.add(s));
    }
  }
  return ["stackoverflow", ...extraSites];
}

async function searchOneStackExchangeSite(
  site: string,
  tag: string,
  locationFilter: string | null,
  size: number,
): Promise<{ candidates: FreePortalCandidate[]; count: number }> {
  const params = new URLSearchParams({
    site,
    pagesize: String(Math.min(size * 2, 50)),
  });
  if (STACK_EXCHANGE_KEY) params.set("key", STACK_EXCHANGE_KEY);

  let items: Array<{
    user: { user_id: number; display_name: string; link: string; location?: string };
  }> = [];

  const tagResponse = await fetch(
    `${STACK_EXCHANGE_API_URL}/tags/${encodeURIComponent(tag)}/top-answerers/all_time?${params.toString()}`,
  );
  if (tagResponse.ok) {
    const result = await tagResponse.json();
    items = result?.items ?? [];
  }

  // Fallback: the tag itself may not exist on this specific site (e.g. a
  // Stack Overflow-flavored tag slug that has no equivalent on
  // stats.stackexchange.com) -- rather than skip the site, fall back to a
  // plain top-reputation user list for it, still a real "who's active and
  // well-regarded here" signal, just not tag-scoped.
  if (items.length === 0) {
    const usersResponse = await fetch(
      `${STACK_EXCHANGE_API_URL}/users?order=desc&sort=reputation&${params.toString()}`,
    );
    if (usersResponse.ok) {
      const result = await usersResponse.json();
      items = (result?.items ?? []).map((u: any) => ({ user: u }));
    }
  }

  const candidates: FreePortalCandidate[] = items
    .filter((item) => !locationFilter || (item.user.location ?? "").toLowerCase().includes(locationFilter))
    .slice(0, size)
    .map((item) => ({
      id: `stackexchange:${site}:${item.user.user_id}`,
      full_name: item.user.display_name,
      job_title: `Top answerer -- ${tag} (${site})`,
      job_company_name: null,
      location_name: item.user.location ?? null,
      skills: [tag],
      linkedin_url: null,
      _source_vendor: `stackexchange:${site}`,
      _portal_url: item.user.link,
    }));

  return { candidates, count: items.length };
}

async function searchStackExchange(
  criteria: FreePortalCriteria,
  size: number,
): Promise<{ candidates: FreePortalCandidate[]; note: string }> {
  const tagCandidates = [...(criteria.requiredSkills ?? []), ...(criteria.niceToHaveKeywords ?? [])]
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, "-"))
    .filter((s) => s.length > 0);
  if (tagCandidates.length === 0) {
    return { candidates: [], note: "Stack Exchange: no required/nice-to-have skills on this role brief to use as tags -- skipped." };
  }
  const tag = tagCandidates[0];
  const sites = pickStackExchangeSites(criteria);

  const locationFilter = criteria.location && !/remote/i.test(criteria.location)
    ? criteria.location.split(",")[0].trim().toLowerCase()
    : null;

  const perSite = await Promise.allSettled(
    sites.map((site) => searchOneStackExchangeSite(site, tag, locationFilter, size)),
  );

  let candidates: FreePortalCandidate[] = [];
  const siteSummaries: string[] = [];
  perSite.forEach((result, i) => {
    const site = sites[i];
    if (result.status === "fulfilled") {
      candidates = candidates.concat(result.value.candidates);
      siteSummaries.push(`${site}: ${result.value.count} found`);
    } else {
      console.error(`Stack Exchange site "${site}" failed (non-fatal)`, result.reason);
      siteSummaries.push(`${site}: failed`);
    }
  });

  return {
    candidates,
    note: `Stack Exchange: top answerers for tag "${tag}" across ${sites.length} site(s) (${siteSummaries.join(", ")})${locationFilter ? `, filtered to "${locationFilter}"` : ""}.`,
  };
}

// --- Hugging Face provider (kept, but NOT called by default -- see the
// header comment: dropped from the general per-role search 2026-07-22,
// available for a future on-demand "look up this candidate's HF profile"
// feature). ---
//
// No user-search endpoint exists (confirmed against huggingface.co/docs/
// hub/api -- the documented search surface is models/datasets/Spaces, not
// people). Proxy: search models by keyword, treat the unique AUTHORS of
// matching models as the candidate signal -- real published work, not a
// self-reported bio. Each author's own overview (bio/name if set) is then
// looked up individually; if that specific endpoint shape doesn't match
// what's expected here (unconfirmed against a live response, disclosed
// rather than assumed), falls back to just the username.
async function searchHuggingFace(
  criteria: FreePortalCriteria,
  size: number,
): Promise<{ candidates: FreePortalCandidate[]; note: string }> {
  const keyword = (criteria.requiredSkills?.[0] ?? criteria.niceToHaveKeywords?.[0] ?? criteria.title ?? "").trim();
  if (!keyword) {
    return { candidates: [], note: "Hugging Face: no required skill/title on this role brief to search models with -- skipped." };
  }

  const response = await fetch(
    `${HUGGING_FACE_API_URL}/models?search=${encodeURIComponent(keyword)}&sort=downloads&direction=-1&limit=${Math.min(size * 3, 60)}`,
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Hugging Face API error (${response.status}): ${body}`);
  }
  const models: Array<{ id: string; author?: string; tags?: string[] }> = await response.json();

  const authors = Array.from(
    new Set(
      models
        .map((m) => m.author ?? m.id?.split("/")?.[0])
        .filter((a): a is string => typeof a === "string" && a.length > 0 && a !== "no-author"),
    ),
  ).slice(0, size);

  const candidates: FreePortalCandidate[] = [];
  for (const author of authors) {
    let fullName: string | null = author;
    let bio: string | null = null;
    try {
      const overviewResponse = await fetch(`${HUGGING_FACE_API_URL}/users/${author}/overview`);
      if (overviewResponse.ok) {
        const overview = await overviewResponse.json();
        if (typeof overview?.fullname === "string" && overview.fullname.length > 0) {
          fullName = overview.fullname;
        }
        if (typeof overview?.bio === "string" && overview.bio.length > 0) {
          bio = overview.bio;
        }
      }
    } catch (error) {
      console.error("Hugging Face user overview lookup failed (non-fatal)", author, error);
    }
    candidates.push({
      id: `huggingface:${author}`,
      full_name: fullName,
      job_title: bio ?? `Published models matching \"${keyword}\" on Hugging Face`,
      job_company_name: null,
      location_name: null,
      skills: [keyword],
      linkedin_url: null,
      _source_vendor: "huggingface",
      _portal_url: `https://huggingface.co/${author}`,
    });
  }

  return {
    candidates,
    note: `Hugging Face: ${models.length} model(s) matching \"${keyword}\", ${candidates.length} unique author(s) shown as candidates (proxy signal -- published work, not a profile search).`,
  };
}

// --- Kaggle provider (kept, but NOT called by default -- see the header
// comment: dropped from the general per-role search 2026-07-22, available
// for a future on-demand "look up this candidate's Kaggle profile"
// feature). ---
//
// No user-search endpoint exists (confirmed against kaggle.com/docs/api) --
// same proxy approach as Hugging Face, via kernel (notebook) authors
// matching a keyword. Disclosed gap, deliberately not worked around: Kaggle
// also has no public "get any user's profile" endpoint the way GitHub does,
// so candidates here carry only a username + the kernel title that surfaced
// them -- no bio, location, or company. Every Kaggle API call requires HTTP
// Basic Auth (even for public reads), so this provider is skipped entirely
// (not attempted half-authenticated) unless both secrets are set.
async function searchKaggle(
  criteria: FreePortalCriteria,
  size: number,
): Promise<{ candidates: FreePortalCandidate[]; note: string }> {
  const keyword = (criteria.requiredSkills?.[0] ?? criteria.niceToHaveKeywords?.[0] ?? criteria.title ?? "").trim();
  if (!keyword) {
    return { candidates: [], note: "Kaggle: no required skill/title on this role brief to search kernels with -- skipped." };
  }

  const basicAuth = btoa(`${KAGGLE_USERNAME}:${KAGGLE_KEY}`);
  const response = await fetch(
    `${KAGGLE_API_URL}/kernels/list?search=${encodeURIComponent(keyword)}&pageSize=${Math.min(size * 3, 60)}`,
    { headers: { Authorization: `Basic ${basicAuth}` } },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Kaggle API error (${response.status}): ${body}`);
  }
  const kernels: Array<{ ref: string; title: string; author?: string }> = await response.json();

  const seen = new Set<string>();
  const candidates: FreePortalCandidate[] = [];
  for (const kernel of kernels) {
    // Kaggle's kernel `ref` is "username/kernel-slug" -- the author field
    // isn't consistently populated on this endpoint (unconfirmed against a
    // live response for every kernel), so ref is the more reliable source
    // of the username.
    const author = kernel.author ?? kernel.ref?.split("/")?.[0];
    if (!author || seen.has(author)) continue;
    seen.add(author);
    candidates.push({
      id: `kaggle:${author}`,
      full_name: author,
      job_title: `Kaggle notebook: \"${kernel.title}\" (matching \"${keyword}\")`,
      job_company_name: null,
      location_name: null,
      skills: [keyword],
      linkedin_url: null,
      _source_vendor: "kaggle",
      _portal_url: `https://www.kaggle.com/${author}`,
    });
    if (candidates.length >= size) break;
  }

  return {
    candidates,
    note: `Kaggle: ${kernels.length} kernel(s) matching \"${keyword}\", ${candidates.length} unique author(s) shown as candidates (username + kernel title only -- Kaggle's API has no public user-profile endpoint).`,
  };
}

type FreePortalCriteria = {
  title: string | null;
  location: string | null;
  requiredSkills: string[] | null;
  niceToHaveKeywords: string[] | null;
};

// Merge/dedupe across portals (2026-07-19, Harsha's explicit call): "if we
// get the same candidate in multiple searches across Kaggle/GitHub/... all
// need to be merged before showing the recruiter" -- a recruiter shouldn't
// have to notice on their own that the same person showed up twice under
// two different portal badges. Matched on normalized full name only --
// there is no shared identifier (email, a common profile URL, etc.) across
// GitHub/Stack Exchange/Hugging Face/Kaggle to match on more precisely, so
// this is a real, disclosed heuristic (a common name like "David Kim" could
// falsely merge two different people), not a guaranteed-exact dedup.
// When a group merges, the "richest" record (the one with the most fields
// actually filled in, tie-broken by PORTAL_RICHNESS_ORDER) becomes the
// primary displayed record; every portal in the group is kept in
// _all_portals so the merged card can still link out to each profile, and
// skills are unioned across the whole group.
const PORTAL_RICHNESS_ORDER = ["github", "stackexchange", "huggingface", "kaggle"];

function portalFamily(sourceVendor: string): string {
  return sourceVendor.split(":")[0];
}

function filledFieldCount(candidate: FreePortalCandidate): number {
  return [candidate.job_title, candidate.job_company_name, candidate.location_name].filter(
    (v) => v !== null && v !== undefined && v !== "",
  ).length;
}

function normalizeNameForDedup(name: string | null): string | null {
  if (!name) return null;
  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function mergeDuplicateCandidates(
  candidates: FreePortalCandidate[],
): { merged: FreePortalCandidate[]; mergedAwayCount: number } {
  const groups = new Map<string, FreePortalCandidate[]>();
  const singles: FreePortalCandidate[] = [];

  for (const candidate of candidates) {
    const key = normalizeNameForDedup(candidate.full_name);
    if (!key) {
      singles.push(candidate);
      continue;
    }
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const merged: FreePortalCandidate[] = [...singles];
  let mergedAwayCount = 0;

  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    mergedAwayCount += group.length - 1;

    const sorted = [...group].sort((a, b) => {
      const richnessDiff = filledFieldCount(b) - filledFieldCount(a);
      if (richnessDiff !== 0) return richnessDiff;
      const aIndex = PORTAL_RICHNESS_ORDER.indexOf(portalFamily(a._source_vendor));
      const bIndex = PORTAL_RICHNESS_ORDER.indexOf(portalFamily(b._source_vendor));
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    });
    const primary = sorted[0];
    const allSkills = Array.from(new Set(group.flatMap((c) => c.skills ?? [])));
    const allPortals = group.map((c) => ({ vendor: c._source_vendor, url: c._portal_url }));

    merged.push({ ...primary, skills: allSkills, _all_portals: allPortals });
  }

  return { merged, mergedAwayCount };
}

// Runs every configured free portal concurrently (Promise.allSettled -- one
// portal failing shouldn't take down the others, same "a vendor having a
// bad moment shouldn't break the whole search" principle used throughout
// source-candidates-discovery), merges the results, then applies active
// learned criteria as a client-side post-filter.
//
// Kaggle and Hugging Face are DELIBERATELY absent from `providers` below --
// see the file header comment for why (2026-07-22, dropped from the general
// per-role search after producing noisy results on the Epiq role; kept
// defined above for a possible future on-demand lookup feature instead).
async function runFreePortalDiscovery(
  criteria: FreePortalCriteria,
  learnedCriteria: LearnedCriterion[],
  size: number,
): Promise<{ candidates: FreePortalCandidate[]; notes: string[] }> {
  const providers: Array<{ name: string; run: () => Promise<{ candidates: FreePortalCandidate[]; note: string }> }> = [
    { name: "github", run: () => searchGithub(criteria, size) },
    { name: "stackexchange", run: () => searchStackExchange(criteria, size) },
  ];

  const notes: string[] = [
    "Kaggle and Hugging Face are excluded from this search by design -- their author-matching proxy produces noisy results for most roles (e.g. matching \"C#\" against unrelated notebook titles). Worth revisiting per-role for Data Scientist/ML Engineer searches, or as an on-demand lookup when a candidate's resume already links to one.",
  ];

  const settled = await Promise.allSettled(providers.map((p) => p.run()));
  let allCandidates: FreePortalCandidate[] = [];
  settled.forEach((result, i) => {
    const providerName = providers[i].name;
    if (result.status === "fulfilled") {
      notes.push(result.value.note);
      allCandidates = allCandidates.concat(result.value.candidates);
    } else {
      console.error(`${providerName} free-portal search failed (non-fatal)`, result.reason);
      const reasonMessage =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      notes.push(
        `${providerName}: search failed this time (non-fatal -- other portals still shown). Detail: ${reasonMessage}`,
      );
    }
  });

  // Merge/dedupe (2026-07-19, Harsha's call): the recruiter shouldn't have
  // to notice on their own that the same person surfaced from two portals --
  // see mergeDuplicateCandidates above for the matching logic and its
  // disclosed limits (name-only, no shared identifier across portals).
  const totalBeforeMerge = allCandidates.length;
  const { merged, mergedAwayCount } = mergeDuplicateCandidates(allCandidates);
  allCandidates = merged;
  if (mergedAwayCount > 0) {
    notes.push(
      `${mergedAwayCount} duplicate candidate(s) appeared in more than one portal search (${totalBeforeMerge} raw results -> ${allCandidates.length} unique) and were merged into a single card -- matched by name only, so a shared common name could occasionally merge two different people.`,
    );
  }

  const requireKeywords = learnedCriteria
    .filter((c) => c.criterionType === "require_keyword" && c.value.keyword)
    .map((c) => c.value.keyword!.toLowerCase());
  const excludeKeywords = learnedCriteria
    .filter((c) => c.criterionType === "exclude_keyword" && c.value.keyword)
    .map((c) => c.value.keyword!.toLowerCase());
  const yearsCriteria = learnedCriteria.filter(
    (c) => c.criterionType === "years_experience_min" || c.criterionType === "years_experience_max",
  );

  if (yearsCriteria.length > 0) {
    notes.push(
      `${yearsCriteria.length} learned years-of-experience criterion/criteria from calibration feedback could NOT be applied here -- GitHub/Stack Exchange don't expose a structured total-experience field the way Coresignal does.`,
    );
  }

  let filtered = allCandidates;
  if (requireKeywords.length > 0 || excludeKeywords.length > 0) {
    filtered = allCandidates.filter((candidate) => {
      const text = combinedSearchableText(candidate, []);
      const meetsRequired = requireKeywords.every((kw) => text.includes(kw));
      const hitsExcluded = excludeKeywords.some((kw) => text.includes(kw));
      return meetsRequired && !hitsExcluded;
    });
    notes.push(
      `Applied ${requireKeywords.length + excludeKeywords.length} learned keyword criterion/criteria from calibration feedback: ${allCandidates.length} candidate(s) found across all portals, ${filtered.length} remain after filtering.`,
    );
  }

  return { candidates: filtered, notes };
}

// Same annotation as source-candidates-discovery's annotateAlreadySaved --
// duplicated rather than shared (see the LearnedCriterion comment above for
// why), matched on source_id since save-sourced-candidate already writes
// these free-portal ids (e.g. "github:octocat") into that same column.
async function annotateAlreadySaved(
  candidates: FreePortalCandidate[],
  authHeader: string,
): Promise<void> {
  const sourceIds = candidates.map((c) => c.id).filter((id) => id.length > 0);
  if (sourceIds.length === 0) return;
  try {
    const idList = sourceIds.map((id) => encodeURIComponent(id)).join(",");
    const url = `${SUPABASE_URL}/rest/v1/candidates?source_id=in.(${idList})&select=id,source_id`;
    const response = await fetch(url, {
      headers: { apikey: SUPABASE_ANON_KEY ?? "", Authorization: authHeader },
    });
    if (!response.ok) return;
    const rows: Array<{ id: number; source_id: string }> = await response.json();
    const savedBySourceId = new Map(rows.map((r) => [r.source_id, r.id]));
    for (const candidate of candidates as unknown as Array<Record<string, unknown>>) {
      const savedId = savedBySourceId.get(candidate.id as string);
      candidate._already_saved = savedId !== undefined;
      candidate._candidate_id = savedId ?? null;
    }
  } catch (error) {
    console.error("annotateAlreadySaved failed (non-fatal)", error);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const authError = await requireAuth(req);
  if (authError) return authError;
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const authHeader = req.headers.get("authorization")!;

  const roleBriefId = body?.role_brief_id;
  if (!roleBriefId || typeof roleBriefId !== "number") {
    return jsonResponse({ error: "role_brief_id is required" }, 400);
  }
  const size = typeof body?.size === "number" ? Math.max(1, Math.min(20, Math.floor(body.size))) : 10;

  const roleBrief = await fetchRoleBrief(roleBriefId, authHeader);
  if (!roleBrief) {
    return jsonResponse({ error: "Role brief not found (or you don't have access to it)" }, 404);
  }

  const learnedCriteria = await fetchActiveLearnedCriteria(roleBriefId, authHeader);

  const criteria: FreePortalCriteria = {
    title: roleBrief.name,
    location: roleBrief.location,
    requiredSkills: roleBrief.required_skills,
    niceToHaveKeywords: roleBrief.nice_to_have_keywords,
  };

  try {
    const { candidates, notes } = await runFreePortalDiscovery(criteria, learnedCriteria, size);
    await annotateAlreadySaved(candidates, authHeader);
    return jsonResponse({ candidates, notes, total: candidates.length });
  } catch (error) {
    console.error("source-candidates-free-portals failed", error);
    return jsonResponse({ error: "Failed to search free portals" }, 502);
  }
});
