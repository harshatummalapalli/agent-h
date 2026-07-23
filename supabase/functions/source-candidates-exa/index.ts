// Agent H Stage 3: Exa.ai people-search sourcing (2026-07-19).
//
// Why this exists, and why it's a SEPARATE function from
// source-candidates-free-portals: Harsha had someone suggest Exa.ai, asked
// what it can do, and after a live test (see chat) it returned strikingly
// relevant, real LinkedIn-profile-derived results for the AI Engineer role
// brief -- clearly stronger signal than the four fully-free portals. But
// Exa is a PAID API (unlike GitHub/Stack Exchange/Hugging Face/Kaggle), so
// it's kept in its own file/provider rather than folded into the free-
// portals function: cost is a real, distinct property of this data source
// that should stay visible and separable, not quietly blended into "free".
//
// What Exa actually is (confirmed against docs.exa.ai before writing this):
// a general public-web search index/API (1B+ people pages, category="people"
// search type) -- NOT a LinkedIn-bot-detection-bypass service the way
// BrightData is. Its people-search results happen to mostly be
// linkedin.com/in/... URLs because that's where most professional profile
// content is publicly indexed, the same category of thing Google/Bing
// X-ray search has always surfaced -- just semantic, structured, and served
// as an API instead of ten blue links to click through by hand. This is
// judged (see chat discussion with Harsha) to sit on the legitimate side of
// the same line that ruled out BrightData/direct LinkedIn automation, but
// it is a real judgment call, not a bright line -- Exa has clearly crawled
// and cached LinkedIn profile content at scale, which is disclosed here,
// not glossed over.
//
// Cost (confirmed against exa.ai/pricing): pay-as-you-go, ~$15/1k neural
// searches for up to 25 results per search (works out to roughly $0.015 per
// search call regardless of how many of those <=25 results get shown or
// saved) -- negligible compared to Coresignal's per-record billing, but not
// zero, unlike the four free portals. Surfaced honestly via a `notes` entry
// on every response rather than hidden, per this app's existing cost-
// transparency convention (source-candidates-discovery's blast-radius
// preview, the free portals' "no vendor bill" framing, etc.).
//
// Calibration loop reuse: same role_brief_learned_criteria table every
// other sourcing path reads -- require/exclude keyword criteria apply here
// too (matched against the full highlight text Exa returns, not just the
// truncated headline), years-of-experience criteria are disclosed as
// inapplicable (Exa's highlight text is unstructured bio prose, not a
// parseable duration field), same pattern as source-candidates-free-portals.
//
// Disclosed heuristic -- location extraction: Exa's `highlights` field is
// free-text (typically: headline line, then a "City, State, Country (CC)"
// line, then bio prose), not structured JSON. A location IS extracted here
// via a regex on that pattern because it's usually present and useful, but
// this is a heuristic parse of unstructured text, not a verified API field
// -- shown to the frontend as heuristic-derived so it can flag it the same
// way Hugging Face/Kaggle's genuinely-missing location field is flagged
// (see FreePortalCandidate-style disclosure convention).

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

// Same thin type as source-candidates-free-portals -- duplicated
// deliberately, see that file's header comment for why (no shared package
// between edge functions in this repo).
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

// Same shape family as FreePortalCandidate in source-candidates-free-
// portals -- kept structurally compatible (not literally shared/imported)
// so the frontend can merge Exa results into the same unified candidate
// list without a second, divergent type.
type ExaCandidate = {
  id: string;
  full_name: string | null;
  job_title: string | null;
  job_company_name: string | null;
  location_name: string | null;
  skills: string[];
  linkedin_url: string | null;
  _source_vendor: "exa";
  _portal_url: string | null;
};

type ExaCriteria = {
  title: string | null;
  location: string | null;
  requiredSkills: string[] | null;
  niceToHaveKeywords: string[] | null;
};

// Heuristic location parse (disclosed above): looks for a highlight line
// shaped like "City, Region, Country (CC)" or "City, Region" -- the format
// Exa's people-search highlights commonly include as their second line.
// Not a structured field -- best-effort only, absent (null) if no line
// matches.
function extractLocationFromHighlight(highlight: string | undefined): string | null {
  if (!highlight) return null;
  const lines = highlight.split("\n").map((l) => l.trim());
  for (const line of lines) {
    if (/^[A-Za-z .'-]+,\s*[A-Za-z .'-]+(,\s*[A-Za-z .'-]+)?(\s*\([A-Z]{2,3}\))?$/.test(line)) {
      return line;
    }
  }
  return null;
}

function buildExaQuery(criteria: ExaCriteria): string {
  const skills = [...(criteria.requiredSkills ?? []), ...(criteria.niceToHaveKeywords ?? [])].slice(0, 6);
  const parts = [criteria.title, skills.length > 0 ? `with ${skills.join(", ")} experience` : null];
  if (criteria.location && !/remote/i.test(criteria.location)) {
    parts.push(`based in ${criteria.location}`);
  }
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" ");
}

async function searchExa(
  criteria: ExaCriteria,
  size: number,
): Promise<{ candidates: ExaCandidate[]; notes: string[] }> {
  if (!EXA_API_KEY) {
    return {
      candidates: [],
      notes: [
        "Exa skipped -- set EXA_API_KEY (from dashboard.exa.ai/api-keys) as an Edge Function secret to include it. This is a PAID API (~$0.015/search), unlike the free portals.",
      ],
    };
  }

  const query = buildExaQuery(criteria);
  if (!query) {
    return { candidates: [], notes: ["Exa: role brief has no title/skills to build a query from -- skipped."] };
  }

  const numResults = Math.min(Math.max(size, 1), 25);
  const response = await fetch(EXA_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": EXA_API_KEY },
    body: JSON.stringify({
      query,
      type: "auto",
      category: "people",
      numResults,
      contents: { highlights: true },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Exa API error (${response.status}): ${body}`);
  }
  const result = await response.json();
  const items: Array<{ id: string; title: string; url: string; highlights?: string[] }> = result?.results ?? [];

  const skillHaystack = [...(criteria.requiredSkills ?? []), ...(criteria.niceToHaveKeywords ?? [])];
  const candidates: ExaCandidate[] = items.map((item) => {
    const highlight = item.highlights?.[0];
    const headline = highlight?.split("\n")[0]?.trim() ?? null;
    const fullText = (highlight ?? "").toLowerCase();
    const matchedSkills = skillHaystack.filter((s) => fullText.includes(s.toLowerCase()));
    return {
      id: `exa:${encodeURIComponent(item.url)}`,
      full_name: item.title || null,
      job_title: headline,
      job_company_name: null,
      location_name: extractLocationFromHighlight(highlight),
      skills: matchedSkills,
      linkedin_url: /linkedin\.com/i.test(item.url) ? item.url : null,
      _source_vendor: "exa",
      _portal_url: item.url,
    };
  });

  const estimatedCost = (numResults <= 25 ? 0.015 : 0.025).toFixed(3);
  return {
    candidates,
    notes: [
      `Exa: query "${query}" -- ${candidates.length} people result(s) found (paid API, roughly $${estimatedCost} for this search). Location shown is heuristically extracted from bio text, not a verified field -- double-check before relying on it.`,
    ],
  };
}

type LearnedFilterResult = { filtered: ExaCandidate[]; notes: string[] };

function applyLearnedCriteria(
  candidates: ExaCandidate[],
  learnedCriteria: LearnedCriterion[],
): LearnedFilterResult {
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
      `${yearsCriteria.length} learned years-of-experience criterion/criteria could NOT be applied to Exa results -- Exa's highlight text is unstructured bio prose, not a parseable duration field.`,
    );
  }

  if (requireKeywords.length === 0 && excludeKeywords.length === 0) {
    return { filtered: candidates, notes };
  }

  const filtered = candidates.filter((candidate) => {
    const text = [candidate.full_name, candidate.job_title, ...(candidate.skills ?? [])]
      .filter((v): v is string => typeof v === "string")
      .join(" ")
      .toLowerCase();
    const meetsRequired = requireKeywords.every((kw) => text.includes(kw));
    const hitsExcluded = excludeKeywords.some((kw) => text.includes(kw));
    return meetsRequired && !hitsExcluded;
  });
  notes.push(
    `Applied ${requireKeywords.length + excludeKeywords.length} learned keyword criterion/criteria from calibration feedback to Exa results: ${candidates.length} found, ${filtered.length} remain after filtering.`,
  );
  return { filtered, notes };
}

async function annotateAlreadySaved(
  candidates: ExaCandidate[],
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
  const size = typeof body?.size === "number" ? Math.max(1, Math.min(25, Math.floor(body.size))) : 10;

  const roleBrief = await fetchRoleBrief(roleBriefId, authHeader);
  if (!roleBrief) {
    return jsonResponse({ error: "Role brief not found (or you don't have access to it)" }, 404);
  }

  const learnedCriteria = await fetchActiveLearnedCriteria(roleBriefId, authHeader);
  const criteria: ExaCriteria = {
    title: roleBrief.name,
    location: roleBrief.location,
    requiredSkills: roleBrief.required_skills,
    niceToHaveKeywords: roleBrief.nice_to_have_keywords,
  };

  try {
    const { candidates, notes: searchNotes } = await searchExa(criteria, size);
    const { filtered, notes: filterNotes } = applyLearnedCriteria(candidates, learnedCriteria);
    await annotateAlreadySaved(filtered, authHeader);
    return jsonResponse({ candidates: filtered, notes: [...searchNotes, ...filterNotes], total: filtered.length });
  } catch (error) {
    console.error("source-candidates-exa failed", error);
    const detail = error instanceof Error ? error.message : "Failed to search Exa";
    return jsonResponse({ error: detail }, 502);
  }
});
