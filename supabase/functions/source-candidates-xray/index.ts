// Agent H Stage 3: multi-query X-ray search via Exa (2026-07-22).
//
// Why this exists, and why it's a SEPARATE function from source-candidates-
// free-portals: Harsha's explicit call, made live during the Epiq demo after
// seeing free-portal results were mostly noise (Kaggle's fuzzy search
// matching "C#" against notebook titles like "Fuzzy C-Means Clustering") --
// "I think X-ray queries... would be helpful to show the first set of 5-10
// candidates to get the Recruiter's sense of what's there in the market...
// a cheap way to gut check before we hit any paid vendors like CoreSignal/
// PDL/CrustData." Someone also suggested X-ray against CodeChef/HackerRank,
// cross-referenced with GitHub, to surface candidates with genuine public
// code. Harsha separately asked for MULTIPLE searches per portal so a real
// chunk of candidates surfaces instead of 1-2 hits from one narrow query.
//
// SEARCH BACKEND -- four attempts, in order, each one a real dead end before
// landing here (kept as a record so nobody re-tries the same thing):
//   v1: BrightData's SERP API directly. Worked, cost trivial (~$0.005 for a
//       few queries), but requires a paid BrightData zone + payment method
//       Harsha hadn't set up.
//   v2: Fetching DuckDuckGo's plain no-JS HTML page DIRECTLY via `fetch`.
//       Confirmed working live from a real browser -- but run from this
//       function in production, every query came back HTTP 202 with a
//       canonical link to duckduckgo.com's homepage and no result markup:
//       DuckDuckGo's bot-challenge response. Root cause: Supabase Edge
//       Functions run on shared datacenter egress IPs, exactly what
//       DuckDuckGo's anti-automation detection is built to catch.
//   v3: Relaying the same DuckDuckGo request THROUGH BrightData's generic
//       proxy/unlocker endpoint instead of fetching it directly. This would
//       have worked, but still needs a BrightData zone + payment method --
//       same blocker as v1, just for a different piece of the pipeline.
//       Confirmed Deno.createHttpClient (the normal way to route Deno's
//       fetch through a forward proxy) is NOT supported on Supabase's Edge
//       Function runtime, so a raw TCP/HTTP CONNECT proxy wasn't an option
//       either.
//   Also ruled out: Brave Search API (killed its free tier Feb 2026, now
//   requires a card too) and public SearXNG instances (searx.be returned a
//   bot-challenge page even to a real browser; priv.au returned a flat 403
//   on JSON output) -- confirmed live, not assumed.
//
// v4 (current): the actual fix was realizing this app ALREADY HAS a working,
// cheap, zero-bot-detection-risk search backend wired in and paid for --
// Exa (see source-candidates-exa/index.ts), which is a real API (not a
// scraped results page) and therefore isn't subject to the same IP-
// reputation blocking that sank v2/v3. Exa's `includeDomains` parameter
// (confirmed against Exa's own docs, which even have a "Recruiting Agent"
// example doing exactly this) restricts results to a specific site --
// functionally the same thing a `site:linkedin.com` X-ray query does, just
// as a real, sanctioned API parameter instead of a boolean search-engine
// operator scraped off a results page. No new vendor, no new zone, no new
// payment method -- EXA_API_KEY is already a working secret on this project
// (confirmed: source-candidates-exa is live and already used by the "Free &
// low-cost search" button). BrightData is DROPPED from this function
// entirely for now -- not because the earlier decision to accept it was
// wrong, but because it turned out to be unnecessary once the already-
// working vendor was used correctly.
//
// QUERY LADDER, not just multiple portals (2026-07-22, Harsha's follow-up
// correction after the first version of this function): "when I mentioned
// different ways of sourcing, I didn't mean multiple platforms, I meant
// multiple boolean strings... narrow to broad OR broad to narrow, till we
// genuinely give closer to what the recruiter is looking for, with evidence
// based proof/explanation." Concretely: a good candidate can be missed
// because they don't use the exact job title, because they wrote their
// state instead of their city, or because they're in a nearby city and
// would relocate. buildQueryLadder (below) generates a small, ordered set
// of query variants per portal that deliberately relaxes ONE dimension at a
// time, narrowest first:
//   1. narrow      -- exact title + top skills + exact city
//   2. broad_title  -- a semantically-equivalent title (see
//                      TITLE_SYNONYM_GROUPS), same skills/city
//   3. broad_location_state -- exact title/skills, but the candidate's
//                      STATE instead of city (e.g. "Telangana" instead of
//                      "Hyderabad" -- some profiles only list the state)
//   4. broad_location_nearby -- exact title, candidates in nearby metros
//                      that are plausible relocation candidates (see
//                      LOCATION_ADJACENCY), phrased as "open to relocation"
//   5. broad_both   -- title AND location both relaxed, skill-only --
//                      the widest net, to catch someone a narrower query
//                      would miss entirely
// Every variant beyond "narrow" carries a plain-English `evidence` string
// explaining exactly what was relaxed and why that's still a legitimate
// candidate to surface -- this is attached to every candidate that query
// variant produces (see `_match_evidence` on XrayCandidate) so a recruiter
// sees WHY a less-than-exact match showed up, not just that it did. Results
// across all variants for a portal are merged and deduped by URL, keeping
// the narrowest rung's tag for any candidate found by more than one.
//
// LinkedIn uses Exa's category: "people" (the same mode source-candidates-
// exa already uses, confirmed to return "strikingly relevant, real
// LinkedIn-profile-derived results" per that file's own header comment) plus
// includeDomains: ["linkedin.com"]. CodeChef/HackerRank use a plain search
// (no category -- "people" category restricts includeDomains to LinkedIn
// only, confirmed against Exa's docs) with includeDomains set to each site,
// then usernames parsed from the result URL are cross-referenced against
// GitHub's own free, official public API (same GET /users/{login} pattern
// as source-candidates-free-portals' searchGithub) -- a competitive-
// programming handle that also has a real GitHub account is a much stronger
// signal than either data point alone. No matching GitHub account -> still
// returned, thinner, disclosed via a note rather than silently dropped.
//
// Cost discipline (the whole point of this feature, per Harsha: "a cheap
// way to gut check before we hit any paid vendors"): every query is a real
// Exa call at ~$0.015 each (same rate source-candidates-exa already
// discloses) -- up to MAX_QUERY_VARIANTS x 3 portals = up to 12 calls/run,
// so worst case is roughly $0.18 for a full run, disclosed via `notes`
// every time, not hidden. Still a fraction of Coresignal/PDL/CrustData's
// per-record pricing.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

const EXA_API_KEY = Deno.env.get("EXA_API_KEY");
const EXA_SEARCH_URL = "https://api.exa.ai/search";
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");
const GITHUB_API_URL = "https://api.github.com";

// Cost/volume knobs. MAX_QUERY_VARIANTS controls how many distinct Exa
// queries run per portal (each a real, billed Exa call) to actually surface
// a meaningful chunk of candidates rather than 1-2 hits from a single
// narrow query. MAX_RESULTS_PER_QUERY caps how many results Exa returns per
// call. MAX_CODE_PORTAL_CANDIDATES_PER_SITE caps the (free) GitHub cross-
// reference step for CodeChef/HackerRank.
const MAX_QUERY_VARIANTS = 6; // the 5-rung ladder below produces up to 6 variants
const MAX_RESULTS_PER_QUERY = 5;
const MAX_CODE_PORTAL_CANDIDATES_PER_SITE = 8;
const EXA_QUERY_DELAY_MS = 250; // courtesy pacing, not required by Exa's own limits

// Semantic title expansion: matched against the role's title + skill list
// text (not just the title alone) so a role brief that never says the word
// ".NET" in its title but lists it as a required skill still gets the
// synonym group. Deliberately generic across recruiting domains, not
// hand-tuned to one role -- this function runs against whatever role brief
// is selected.
const TITLE_SYNONYM_GROUPS: Array<{ match: RegExp; synonyms: string[] }> = [
  { match: /\.net|c#|asp\.net|dotnet/i, synonyms: [".NET Developer", ".NET Full Stack Engineer", "C# Developer"] },
  { match: /\b(ai|ml|llm|genai|rag|agentic|machine learning)\b/i, synonyms: ["AI/ML Engineer", "GenAI Engineer", "Machine Learning Engineer", "LLM Engineer"] },
  { match: /\bjava\b/i, synonyms: ["Java Developer", "Java Backend Engineer"] },
  { match: /\bpython\b/i, synonyms: ["Python Developer", "Python Backend Engineer"] },
  { match: /react|frontend|front-end/i, synonyms: ["Frontend Engineer", "React Developer"] },
  { match: /devops|kubernetes|docker/i, synonyms: ["DevOps Engineer", "Cloud Engineer"] },
  { match: /data engineer|etl\b/i, synonyms: ["Data Engineer"] },
  { match: /\bnode(\.js)?\b/i, synonyms: ["Node.js Developer", "Backend Engineer"] },
];

// Location adjacency for the India tech-hub metros Harsha named explicitly
// ("closer to the region like Bengaluru/Chennai/Pune/Coimbatore/Udupi/
// Mangalore may be interested in relocating"). Keyed by lowercased city
// name; `state` supports the "candidate only listed their state" case,
// `nearby` supports the "candidate is in a plausible relocation radius"
// case. Not exhaustive -- covers the metros actually named plus the other
// major India tech hubs likely to come up for a similar role; a city not in
// this table just skips the two location-broadening rungs rather than
// erroring.
const LOCATION_ADJACENCY: Record<string, { state: string; nearby: string[] }> = {
  hyderabad: { state: "Telangana", nearby: ["Bengaluru", "Chennai", "Pune", "Coimbatore", "Mangalore", "Udupi"] },
  bengaluru: { state: "Karnataka", nearby: ["Hyderabad", "Chennai", "Pune", "Mangalore", "Udupi", "Coimbatore"] },
  bangalore: { state: "Karnataka", nearby: ["Hyderabad", "Chennai", "Pune", "Mangalore", "Udupi", "Coimbatore"] },
  chennai: { state: "Tamil Nadu", nearby: ["Bengaluru", "Coimbatore", "Hyderabad", "Pune"] },
  coimbatore: { state: "Tamil Nadu", nearby: ["Chennai", "Bengaluru"] },
  pune: { state: "Maharashtra", nearby: ["Mumbai", "Bengaluru", "Hyderabad"] },
  mumbai: { state: "Maharashtra", nearby: ["Pune", "Bengaluru"] },
  mangalore: { state: "Karnataka", nearby: ["Bengaluru", "Udupi", "Chennai"] },
  udupi: { state: "Karnataka", nearby: ["Mangalore", "Bengaluru"] },
  delhi: { state: "Delhi NCR", nearby: ["Gurugram", "Noida", "Bengaluru"] },
  gurugram: { state: "Haryana", nearby: ["Delhi", "Noida"] },
  noida: { state: "Uttar Pradesh", nearby: ["Delhi", "Gurugram"] },
  kochi: { state: "Kerala", nearby: ["Bengaluru", "Chennai"] },
};

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

// Same thin type/duplication convention as the other sourcing edge
// functions -- no shared package between Deno function directories here.
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

// Same shape family as FreePortalCandidate/ExaCandidate in the other
// sourcing functions -- kept structurally compatible (not shared/imported)
// so the frontend merges these into the same unified candidate list.
// `_match_evidence` (2026-07-22): null for a "narrow" rung hit (self-
// evidently on-target -- exact title/skills/city), set to a plain-English
// explanation for anything surfaced by a broadened rung, e.g. "Title
// relaxed -- searched as 'AI/ML Engineer' instead of..." -- see
// buildQueryLadder's header comment for the full rung list. This is the
// "evidence based proof/explanation" Harsha asked for: why a less-than-
// exact match is still worth a recruiter's look.
type XrayCandidate = {
  id: string;
  full_name: string | null;
  job_title: string | null;
  job_company_name: string | null;
  location_name: string | null;
  skills: string[];
  linkedin_url: string | null;
  _source_vendor: string;
  _portal_url: string | null;
  _match_evidence?: string | null;
};

type XrayCriteria = {
  title: string | null;
  location: string | null;
  requiredSkills: string[] | null;
  niceToHaveKeywords: string[] | null;
};

type QueryVariant = {
  query: string;
  rung: "narrow" | "broad_title" | "broad_location_state" | "broad_location_nearby" | "broad_both";
  // null only for "narrow" -- every broadened rung must explain itself.
  evidence: string | null;
};

// Matches the role's title + full skill list text against
// TITLE_SYNONYM_GROUPS -- returns every synonym whose group pattern hits,
// deduped, in group order. Text-based (not a lookup by exact title) so a
// role brief that spells out ".NET/C#" only in required_skills still gets
// the right synonym group even if the title itself is generic.
function titleSynonyms(title: string | null, skillPool: string[]): string[] {
  const haystack = `${title ?? ""} ${skillPool.join(" ")}`;
  const found = new Set<string>();
  for (const group of TITLE_SYNONYM_GROUPS) {
    if (group.match.test(haystack)) {
      for (const synonym of group.synonyms) found.add(synonym);
    }
  }
  return Array.from(found);
}

function locationInfo(
  location: string | null,
): { city: string; state: string | null; nearby: string[] } | null {
  if (!location || /remote/i.test(location)) return null;
  const city = location.split(",")[0].trim();
  if (city.length === 0) return null;
  const adjacency = LOCATION_ADJACENCY[city.toLowerCase()];
  return { city, state: adjacency?.state ?? null, nearby: adjacency?.nearby ?? [] };
}

// The query ladder itself -- see the header comment above for the full
// rung-by-rung reasoning. Builds up to `maxVariants` QueryVariants, ordered
// narrowest-first (so downstream dedup-by-URL naturally keeps the narrowest
// evidence tag for any candidate multiple rungs would have found anyway).
function buildQueryLadder(criteria: XrayCriteria, maxVariants: number): QueryVariant[] {
  const skillPool = [
    ...(criteria.requiredSkills ?? []),
    ...(criteria.niceToHaveKeywords ?? []),
  ].filter((s): s is string => typeof s === "string" && s.length > 0);
  const topSkills = skillPool.slice(0, 2);
  const loc = locationInfo(criteria.location);
  const synonyms = titleSynonyms(criteria.title, skillPool);

  const variants: QueryVariant[] = [];
  const join = (parts: Array<string | null>) =>
    parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" ");

  // Rung 1 -- narrow: exact title + top skills + exact city.
  if (criteria.title) {
    variants.push({
      query: join([
        criteria.title,
        topSkills.length > 0 ? `with ${topSkills.join(" and ")} experience` : null,
        loc ? `based in ${loc.city}` : null,
      ]),
      rung: "narrow",
      evidence: null,
    });
  }

  // Rung 2 -- broad_title: a semantically-equivalent title, same
  // skills/city. Up to 2 synonyms so this rung doesn't dominate the budget.
  for (const synonym of synonyms.slice(0, 2)) {
    variants.push({
      query: join([
        synonym,
        topSkills.length > 0 ? `with ${topSkills.join(" and ")} experience` : null,
        loc ? `based in ${loc.city}` : null,
      ]),
      rung: "broad_title",
      evidence: `Title relaxed -- searched as "${synonym}" instead of the exact role title "${criteria.title}", since a genuinely strong candidate may not use that literal title even while doing the same work.`,
    });
  }

  // Rung 3 -- broad_location_state: exact title/skills, candidate's STATE
  // instead of city -- some profiles only list the state, never the city.
  if (loc?.state) {
    variants.push({
      query: join([
        criteria.title,
        topSkills.length > 0 ? `with ${topSkills[0]} experience` : null,
        `based in ${loc.state}`,
      ]),
      rung: "broad_location_state",
      evidence: `Location relaxed -- searched by state ("${loc.state}") instead of just "${loc.city}", since some candidates only list their state on their profile, not the specific city.`,
    });
  }

  // Rung 4 -- broad_location_nearby: exact title, candidates in nearby
  // metros who are plausible relocation candidates (Harsha's explicit
  // example: someone in Bengaluru/Chennai/Pune/Coimbatore/Udupi/Mangalore
  // may be open to relocating for a Hyderabad role).
  if (loc && loc.nearby.length > 0) {
    const nearbyList = loc.nearby.join(", ");
    variants.push({
      query: join([criteria.title, "open to relocation", `based in ${nearbyList}`]),
      rung: "broad_location_nearby",
      evidence: `Location widened to nearby tech hubs (${nearbyList}) -- candidates there are plausible relocation candidates for ${loc.city}, not people who already live there, so treat this as a "worth asking" signal, not a location match.`,
    });
  }

  // Rung 5 -- broad_both: the widest net. Title AND location both relaxed,
  // down to a single core skill -- catches someone a narrower query would
  // miss entirely, at the cost of being the least targeted rung.
  if (skillPool.length > 0) {
    const broadTitle = synonyms[0] ?? criteria.title;
    variants.push({
      query: join([broadTitle, `with ${skillPool[0]} experience`]),
      rung: "broad_both",
      evidence: `Widest net this run -- both title and location relaxed, searched only on "${skillPool[0]}" experience. Verify title/location fit yourself before treating this as a strong match.`,
    });
  }

  if (variants.length === 0 && criteria.title) {
    variants.push({ query: criteria.title, rung: "narrow", evidence: null });
  }

  return variants.slice(0, maxVariants);
}

type ExaResult = { id: string; title: string; url: string; highlights?: string[] };

// One Exa search call, optionally scoped to a category and a domain
// allowlist. Same endpoint/shape as source-candidates-exa's searchExa --
// duplicated (not imported) per this repo's edge-function convention (no
// shared package between function directories).
async function runExaQuery(
  query: string,
  options: { category?: "people"; includeDomains: string[] },
): Promise<ExaResult[]> {
  if (!EXA_API_KEY) {
    throw new Error("EXA_API_KEY not set -- required for X-ray search.");
  }
  const response = await fetch(EXA_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": EXA_API_KEY },
    body: JSON.stringify({
      query,
      type: "auto",
      ...(options.category ? { category: options.category } : {}),
      includeDomains: options.includeDomains,
      numResults: MAX_RESULTS_PER_QUERY,
      contents: { highlights: true },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Exa API error (${response.status}): ${body.slice(0, 300)}`);
  }
  const result = await response.json();
  return result?.results ?? [];
}

type TaggedResult = { result: ExaResult; variant: QueryVariant };

// Runs every rung of the ladder for one portal, paced with a small delay
// (EXA_QUERY_DELAY_MS) as a courtesy -- Exa doesn't document a strict
// per-second limit for this volume, but there's no reason to burst. Each
// result is tagged with the QueryVariant (rung + evidence) that produced
// it -- variants run narrowest-first, so a later dedup-by-URL that keeps
// the FIRST tag seen naturally keeps the narrowest available evidence for
// any candidate more than one rung would have surfaced anyway.
async function runPortalQueries(
  variants: QueryVariant[],
  options: { category?: "people"; includeDomains: string[] },
): Promise<{ tagged: TaggedResult[]; errors: string[] }> {
  const tagged: TaggedResult[] = [];
  const errors: string[] = [];
  for (let i = 0; i < variants.length; i++) {
    try {
      const results = await runExaQuery(variants[i].query, options);
      for (const result of results) tagged.push({ result, variant: variants[i] });
    } catch (error) {
      errors.push(`"${variants[i].query}" (${variants[i].rung}): ${error instanceof Error ? error.message : String(error)}`);
    }
    if (i < variants.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, EXA_QUERY_DELAY_MS));
    }
  }
  return { tagged, errors };
}

// --- GitHub cross-reference for CodeChef/HackerRank handles (free) ---
// Same free, official API as source-candidates-free-portals' searchGithub,
// but a direct GET /users/{login} lookup since we already have a specific
// handle to check -- more precise than a keyword search.
async function lookupGithubProfile(
  username: string,
): Promise<{ found: boolean; profile?: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  try {
    const response = await fetch(`${GITHUB_API_URL}/users/${encodeURIComponent(username)}`, {
      headers,
    });
    if (!response.ok) return { found: false };
    const profile = await response.json();
    return { found: true, profile };
  } catch (error) {
    console.error("lookupGithubProfile failed (non-fatal)", username, error);
    return { found: false };
  }
}

function extractUsernameFromUrl(url: string, hostFragment: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes(hostFragment)) return null;
    const segments = parsed.pathname.split("/").filter((s) => s.length > 0);
    return segments.length > 0 ? segments[segments.length - 1] : null;
  } catch {
    return null;
  }
}

async function buildCodePortalCandidates(
  tagged: TaggedResult[],
  hostFragment: string,
  vendorLabel: string,
): Promise<{ candidates: XrayCandidate[]; note: string }> {
  const seen = new Set<string>();
  // handle -> the narrowest rung's variant that surfaced it (tagged is
  // already narrowest-first, so first-seen wins).
  const handleVariants = new Map<string, QueryVariant>();
  for (const item of tagged) {
    const username = extractUsernameFromUrl(item.result.url, hostFragment);
    if (!username || seen.has(username.toLowerCase())) continue;
    seen.add(username.toLowerCase());
    handleVariants.set(username, item.variant);
    if (handleVariants.size >= MAX_CODE_PORTAL_CANDIDATES_PER_SITE) break;
  }

  let githubMatches = 0;
  const candidates: XrayCandidate[] = [];
  for (const [handle, variant] of handleVariants) {
    const { found, profile } = await lookupGithubProfile(handle);
    if (found) githubMatches++;
    candidates.push({
      id: `${vendorLabel}:${handle}`,
      full_name:
        found && typeof profile?.name === "string" && profile.name.length > 0
          ? (profile.name as string)
          : handle,
      job_title:
        found && typeof profile?.bio === "string" && profile.bio.length > 0
          ? (profile.bio as string)
          : `${vendorLabel} profile found via X-ray search${found ? " -- cross-referenced with a matching GitHub account" : " -- no matching GitHub account found under this handle"}`,
      job_company_name: found && typeof profile?.company === "string" ? (profile.company as string) : null,
      location_name: found && typeof profile?.location === "string" ? (profile.location as string) : null,
      skills: [],
      linkedin_url: null,
      _source_vendor: found ? `${vendorLabel}+github` : vendorLabel,
      _portal_url: found && typeof profile?.html_url === "string" ? (profile.html_url as string) : null,
      _match_evidence: variant.evidence,
    });
  }

  return {
    candidates,
    note: `${vendorLabel}: ${handleVariants.size} unique profile(s) found across the query ladder, ${githubMatches} cross-referenced with a genuine GitHub account (free -- no extra cost for this cross-reference).`,
  };
}

async function annotateAlreadySaved(
  candidates: XrayCandidate[],
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

function applyLearnedCriteria(
  candidates: XrayCandidate[],
  learnedCriteria: LearnedCriterion[],
): { filtered: XrayCandidate[]; notes: string[] } {
  const requireKeywords = learnedCriteria
    .filter((c) => c.criterionType === "require_keyword" && c.value.keyword)
    .map((c) => c.value.keyword!.toLowerCase());
  const excludeKeywords = learnedCriteria
    .filter((c) => c.criterionType === "exclude_keyword" && c.value.keyword)
    .map((c) => c.value.keyword!.toLowerCase());
  const yearsCriteria = learnedCriteria.filter(
    (c) => c.criterionType === "years_experience_min" || c.criterionType === "years_experience_max",
  );

  const notes: string[] = [];
  if (yearsCriteria.length > 0) {
    notes.push(
      `${yearsCriteria.length} learned years-of-experience criterion/criteria could NOT be applied to X-ray results -- LinkedIn/CodeChef/HackerRank profiles here don't expose a structured total-experience field.`,
    );
  }
  if (requireKeywords.length === 0 && excludeKeywords.length === 0) {
    return { filtered: candidates, notes };
  }
  const filtered = candidates.filter((candidate) => {
    const text = [candidate.full_name, candidate.job_title, candidate.job_company_name, ...(candidate.skills ?? [])]
      .filter((v): v is string => typeof v === "string")
      .join(" ")
      .toLowerCase();
    const meetsRequired = requireKeywords.every((kw) => text.includes(kw));
    const hitsExcluded = excludeKeywords.some((kw) => text.includes(kw));
    return meetsRequired && !hitsExcluded;
  });
  notes.push(
    `Applied ${requireKeywords.length + excludeKeywords.length} learned keyword criterion/criteria from calibration feedback to X-ray results: ${candidates.length} found, ${filtered.length} remain after filtering.`,
  );
  return { filtered, notes };
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

  const roleBrief = await fetchRoleBrief(roleBriefId, authHeader);
  if (!roleBrief) {
    return jsonResponse({ error: "Role brief not found (or you don't have access to it)" }, 404);
  }
  const learnedCriteria = await fetchActiveLearnedCriteria(roleBriefId, authHeader);
  const criteria: XrayCriteria = {
    title: roleBrief.name,
    location: roleBrief.location,
    requiredSkills: roleBrief.required_skills,
    niceToHaveKeywords: roleBrief.nice_to_have_keywords,
  };

  const notes: string[] = [];
  let allCandidates: XrayCandidate[] = [];
  let exaCallCount = 0;

  try {
    const variants = buildQueryLadder(criteria, MAX_QUERY_VARIANTS);
    if (variants.length === 0) {
      return jsonResponse({
        candidates: [],
        notes: ["Role brief has no title/skills to build a query ladder from -- skipped."],
        total: 0,
      });
    }
    notes.push(
      `Query ladder: ${variants.length} rung(s) run per site -- ${variants.map((v) => v.rung).join(" -> ")}. ` +
        `Rungs beyond "narrow" relax one dimension at a time (title synonym, then location) rather than searching every platform the same way -- see each candidate's evidence note below for exactly what was relaxed to find them.`,
    );

    const [linkedinAgg, codechefAgg, hackerrankAgg] = await Promise.allSettled([
      runPortalQueries(variants, { category: "people", includeDomains: ["linkedin.com"] }),
      runPortalQueries(variants, { includeDomains: ["codechef.com"] }),
      runPortalQueries(variants, { includeDomains: ["hackerrank.com"] }),
    ]);

    // --- LinkedIn: Exa people-search scoped to linkedin.com ---
    if (linkedinAgg.status === "fulfilled") {
      const { tagged, errors } = linkedinAgg.value;
      exaCallCount += variants.length;
      const skillHaystack = [...(criteria.requiredSkills ?? []), ...(criteria.niceToHaveKeywords ?? [])];
      const seen = new Set<string>();
      const linkedinCandidates: XrayCandidate[] = [];
      for (const item of tagged) {
        const { result, variant } = item;
        if (!/linkedin\.com\/in\//i.test(result.url) || seen.has(result.url)) continue;
        seen.add(result.url);
        const highlight = result.highlights?.[0];
        const headline = highlight?.split("\n")[0]?.trim() ?? null;
        const fullText = (highlight ?? "").toLowerCase();
        const matchedSkills = skillHaystack.filter((s) => fullText.includes(s.toLowerCase()));
        linkedinCandidates.push({
          id: `xray:linkedin:${encodeURIComponent(result.url)}`,
          full_name: result.title || null,
          job_title: headline,
          job_company_name: null,
          location_name: null,
          skills: matchedSkills,
          linkedin_url: result.url,
          _source_vendor: "xray+exa",
          _portal_url: result.url,
          _match_evidence: variant.evidence,
        });
      }
      allCandidates.push(...linkedinCandidates);
      notes.push(
        `LinkedIn X-ray: ${variants.length} quer${variants.length === 1 ? "y" : "ies"} run across the ladder via Exa people-search (includeDomains: linkedin.com) -- ${tagged.length} raw result(s), ${linkedinCandidates.length} unique LinkedIn profile(s).`,
      );
      if (errors.length > 0) {
        notes.push(`LinkedIn X-ray: ${errors.length} rung(s) failed (non-fatal): ${errors.join("; ")}`);
      }
    } else {
      notes.push(`LinkedIn X-ray search failed (non-fatal): ${linkedinAgg.reason?.message ?? linkedinAgg.reason}`);
    }

    // --- CodeChef / HackerRank: Exa scoped to each site, cross-ref with GitHub (free) ---
    if (codechefAgg.status === "fulfilled") {
      exaCallCount += variants.length;
      const { candidates, note } = await buildCodePortalCandidates(
        codechefAgg.value.tagged,
        "codechef.com",
        "codechef",
      );
      allCandidates.push(...candidates);
      notes.push(`CodeChef X-ray: ${variants.length} quer${variants.length === 1 ? "y" : "ies"} run across the ladder (includeDomains: codechef.com). ${note}`);
      if (codechefAgg.value.errors.length > 0) {
        notes.push(`CodeChef X-ray: some rungs failed (non-fatal): ${codechefAgg.value.errors.join("; ")}`);
      }
    } else {
      notes.push(`CodeChef X-ray search failed (non-fatal): ${codechefAgg.reason?.message ?? codechefAgg.reason}`);
    }

    if (hackerrankAgg.status === "fulfilled") {
      exaCallCount += variants.length;
      const { candidates, note } = await buildCodePortalCandidates(
        hackerrankAgg.value.tagged,
        "hackerrank.com",
        "hackerrank",
      );
      allCandidates.push(...candidates);
      notes.push(`HackerRank X-ray: ${variants.length} quer${variants.length === 1 ? "y" : "ies"} run across the ladder (includeDomains: hackerrank.com). ${note}`);
      if (hackerrankAgg.value.errors.length > 0) {
        notes.push(`HackerRank X-ray: some rungs failed (non-fatal): ${hackerrankAgg.value.errors.join("; ")}`);
      }
    } else {
      notes.push(`HackerRank X-ray search failed (non-fatal): ${hackerrankAgg.reason?.message ?? hackerrankAgg.reason}`);
    }

    const estimatedCost = (exaCallCount * 0.015).toFixed(3);
    notes.push(
      `Cost: ${exaCallCount} Exa search call(s) this run across ${variants.length} ladder rung(s) x 3 sites, roughly $${estimatedCost} total (~$0.015/search) -- no BrightData, no new vendor, no payment method needed. ${allCandidates.length} candidate(s) returned.`,
    );

    const { filtered, notes: filterNotes } = applyLearnedCriteria(allCandidates, learnedCriteria);
    notes.push(...filterNotes);
    await annotateAlreadySaved(filtered, authHeader);

    return jsonResponse({ candidates: filtered, notes, total: filtered.length });
  } catch (error) {
    console.error("source-candidates-xray failed", error);
    const detail = error instanceof Error ? error.message : "Failed to run X-ray search";
    return jsonResponse({ error: detail }, 502);
  }
});
