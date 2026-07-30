// Agent H Stage 2: JD intake parsing.
//
// Takes free-text job description, returns a structured role brief via a
// single, forced tool-use call to Claude. The fields returned here match
// exactly what was added onto public.deals in
// supabase/schemas/15_agent_h_structured_role_brief_fields.sql -- this is
// the "NL-query translation" pattern from kharta-sourcing-engine-architecture.md
// (Section 1/2), run once at intake time so the sourcing engine (Stage 3)
// never has to re-parse the JD text later.
//
// Requires ANTHROPIC_API_KEY to be set:
//   - Cloud: Project Settings > Edge Functions > Secrets
//   - Local: supabase/functions/.env (gitignored, never committed)
//
// Ranked preference tiers (2026-07-22, live-demo follow-up): some JDs
// describe a real primary-vs-fallback candidate profile -- Epiq's own brief:
// "PRIMARY PREFERENCE: .NET/C# engineers who organically picked up AI/ML
// engineering... SECONDARY/ACCEPTABLE: AI/ML engineers with genuine .NET/C#
// exposure." Before this, there was nowhere structured to put that -- the
// whole tiered paragraph got crammed into a single must_have_keywords
// string, which is why the role brief panel showed one giant run-on
// sentence instead of two clean tiers. preference_tiers (see the
// 2026-07-22 migration on public.deals) is additive: a flat-requirement JD
// returns an empty array and required_skills/must_have_keywords behave
// exactly as before; only a JD that ACTUALLY describes ranked fallback
// preferences populates it. The prompt is deliberately conservative --
// most JDs are flat, and inventing tiers where none exist would be worse
// than not having the feature.
//
// Clarifying questions (2026-07-22, same follow-up, task #30): rather than
// only learning about JD ambiguity after the fact through "not a fit"
// calibration feedback, this asks the model to flag genuine ambiguities up
// front -- conflicting seniority signals, unclear remote/relocation policy,
// two different tech stacks described, a vague/missing location, etc.
// Deliberately capped small and conservative -- most JDs aren't ambiguous.
// v1 scope is a read-only/dismissible advisory in the UI, not a back-and-
// forth conversation -- see JdIntakePage.tsx's own comment for why.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";

// Self-contained auth check (rather than importing Atomic's
// supabase/functions/_shared/authentication.ts) so this function has no
// relative-path dependencies to get wrong across the two different ways
// it gets deployed (Supabase MCP direct deploy vs. local `supabase start`
// picking it up from the repo).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

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
    return null; // authorized
  } catch {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
}

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// Forcing a tool_use call (rather than asking Claude to "return JSON" in
// plain text) is what guarantees the response is always valid, correctly
// shaped JSON -- no parsing-a-string-that-might-not-be-JSON risk.

// System prompt instructs the model on atomic skill extraction rules.
// These rules are the primary defence against prose fragments ending up as
// skill chips (e.g. "Enterprise applications with C#/.NET" → ["C#", ".NET"]).
// A deterministic normalizer in parsedBriefToConditions.ts is the second
// layer of defence so even older parse results stay clean.
const EXTRACTION_SYSTEM_PROMPT = `You are a recruiting data extractor. Your task is to produce a structured role brief that will be used to drive people-search filters in a sourcing tool.

CRITICAL RULES FOR SKILL FIELDS (required_skills, must_have_keywords, nice_to_have_keywords, preference_tiers[*].keywords):

1. ATOMIC TOKENS ONLY. Every entry must be a single searchable skill token (language, framework, tool, domain, certification). NOT a sentence fragment from the JD.
   ✓ Good: "Python", "C#", ".NET", "RAG", "Azure", "Kubernetes", "SQL Server"
   ✗ Bad: "Enterprise applications with C#/.NET", "5+ years Python programming experience", "knowledge of databases"

2. SPLIT ALTERNATIVES. When the JD uses "X/Y", "X or Y", or "X and Y" for technologies, emit SEPARATE entries for each — do not concatenate them.
   "C#/.NET" → ["C#", ".NET"]
   "Python or Java" → ["Python", "Java"]
   "SQL Server and PostgreSQL" → ["SQL Server", "PostgreSQL"]

3. STRIP FILLER. Remove suffixes like "programming", "development", "experience", "knowledge of", "familiarity with", "applications with", "proficiency in", "working knowledge of". Extract only the core skill name.
   "Python programming" → "Python"
   "ASP.NET Core development" → "ASP.NET Core"
   "knowledge of Kubernetes" → "Kubernetes"

4. EXPERIENCE BELONGS IN years_experience_min/max ONLY. Any phrase containing "years", "YoE", "experience", or seniority qualifiers (e.g. "5+ years software development", "3-5 years backend experience") must NOT appear in skill arrays. Put numeric YoE in years_experience_min/max instead.

5. SOFT SKILLS AND DEGREE REQUIREMENTS are never skill tokens. "excellent communication", "bachelor's degree", "team player", "problem solving" — omit these entirely from skill arrays.

6. KEEP MUST-HAVES TIGHT. JDs dump everything as "required". For sourcing, cap required_skills + must_have_keywords to ≤8-10 true hard requirements. Move the long laundry list into nice_to_have_keywords.

7. LOCATION: If the location is unknown, ambiguous, or not stated, return an empty string "" — NEVER return "<UNKNOWN>", "unknown", "N/A", "TBD", or any placeholder string.`;

const EXTRACTION_TOOL = {
  name: "extract_role_brief",
  description:
    "Extract a structured recruiting role brief from a natural-language job description. All skill entries must be atomic searchable tokens — not prose phrases.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "The role's job title, cleaned up (e.g. 'Senior Backend Engineer').",
      },
      seniority: {
        type: "string",
        description:
          "One of: intern, entry_level, mid_level, senior, staff, principal, manager, director, executive. Pick the closest match.",
      },
      location: {
        type: "string",
        description:
          "Primary work location as stated or implied. When remote work is offered but a geographic location is also specified (e.g. 'remote based in India', 'remote candidates from Bangalore only', 'UK remote'), store as 'Remote, <place>' (e.g. 'Remote, India', 'Remote, Bangalore', 'Remote, UK'). Use bare 'Remote' only when no geography is mentioned at all. Return empty string if location is unknown or not stated — NEVER use placeholder values like '<UNKNOWN>', 'N/A', or 'TBD'.",
      },
      industry: {
        type: ["string", "null"],
        description:
          "The hiring company's industry, if inferable from context. Null if not stated.",
      },
      employment_type: {
        type: "string",
        description:
          "One of: full_time, part_time, contract, contract_to_hire, internship.",
      },
      years_experience_min: {
        type: ["integer", "null"],
        description:
          "Minimum years of experience required, if stated. Null if not stated. Do NOT put YoE phrases into skill arrays.",
      },
      years_experience_max: {
        type: ["integer", "null"],
        description:
          "Maximum/preferred years of experience, if stated. Null if not stated.",
      },
      required_skills: {
        type: "array",
        items: { type: "string" },
        description:
          "Atomic skill tokens that are clearly required (e.g. 'Python', 'AWS', 'React'). Each entry must be a single technology/tool name — NOT a sentence fragment. Split 'X/Y' and 'X or Y' into separate entries. Strip filler words like 'programming', 'development', 'knowledge of'. Cap at ≤8 items — move extras to nice_to_have_keywords.",
      },
      must_have_keywords: {
        type: "array",
        items: { type: "string" },
        description:
          "Additional atomic skill tokens explicitly framed as must-have/required, not already in required_skills. Single technology/tool names only — no YoE phrases, no soft skills, no degree requirements. If the JD describes a genuine ranked primary-vs-fallback profile, use preference_tiers instead.",
      },
      nice_to_have_keywords: {
        type: "array",
        items: { type: "string" },
        description:
          "Atomic skill tokens preferred but not required ('nice to have', 'bonus', 'preferred', 'plus'). Also use this for additional skills beyond the ≤8 hard-must cap. Single technology/tool names only.",
      },
      preference_tiers: {
        type: "array",
        description:
          "ONLY populate this when the JD explicitly describes a ranked, primary-vs-fallback candidate profile (e.g. 'ideally X, but Y is also acceptable', 'primary preference... secondary/acceptable...'). Leave as an empty array for the common case of a single flat requirement set -- do not invent tiers that aren't really there. Order by preference, rank 1 = most preferred. Keywords within each tier must be atomic skill tokens (same rules as required_skills).",
        items: {
          type: "object",
          properties: {
            rank: {
              type: "integer",
              description: "1 = most preferred tier, 2 = next fallback, etc.",
            },
            label: {
              type: "string",
              description:
                "Short human label for this tier, e.g. 'Primary preference' or 'Secondary / acceptable'.",
            },
            keywords: {
              type: "array",
              items: { type: "string" },
              description:
                "Atomic skill tokens defining this tier. Same rules as required_skills — no prose fragments, split X/Y alternatives.",
            },
            condition: {
              type: ["string", "null"],
              description:
                "Any extra qualifying condition for this tier stated in the JD (e.g. 'must be currently hands-on in AI engineering work'), or null if the keywords alone fully describe it.",
            },
          },
          required: ["rank", "label", "keywords"],
        },
      },
      clarifying_questions: {
        type: "array",
        items: { type: "string" },
        description:
          "A SHORT list (0-3) of genuine ambiguities in this JD worth confirming with the hiring team before sourcing starts -- e.g. conflicting seniority signals, an unclear remote/relocation policy, two different tech stacks both described, a vague or missing location. Leave empty for a clear, unambiguous JD -- do not manufacture questions just to fill the list.",
      },
    },
    required: [
      "title",
      "seniority",
      "location",
      "employment_type",
      "required_skills",
      "must_have_keywords",
      "nice_to_have_keywords",
      "preference_tiers",
      "clarifying_questions",
    ],
  },
};

const parseJobDescription = async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  if (!ANTHROPIC_API_KEY) {
    return jsonResponse(
      {
        error:
          "ANTHROPIC_API_KEY is not set for this project. Add it under Project Settings > Edge Functions > Secrets (cloud) or supabase/functions/.env (local).",
      },
      500,
    );
  }

  let jd_text: string | undefined;
  try {
    const body = await req.json();
    jd_text = body?.jd_text;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!jd_text || typeof jd_text !== "string" || jd_text.trim().length === 0) {
    return jsonResponse({ error: "jd_text is required" }, 400);
  }

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1536,
        system: EXTRACTION_SYSTEM_PROMPT,
        tools: [EXTRACTION_TOOL],
        tool_choice: { type: "tool", name: "extract_role_brief" },
        messages: [
          {
            role: "user",
            content: `Extract a structured role brief from this job description:\n\n${jd_text}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Anthropic API error", response.status, errorBody);
      return jsonResponse(
        { error: `Anthropic API error (${response.status})` },
        502,
      );
    }

    const result = await response.json();
    const toolUseBlock = result?.content?.find(
      (block: any) => block.type === "tool_use",
    );

    if (!toolUseBlock) {
      console.error("No tool_use block in Anthropic response", result);
      return jsonResponse(
        {
          error: "Failed to extract structured fields from the job description",
        },
        502,
      );
    }

    return jsonResponse({ data: toolUseBlock.input });
  } catch (error) {
    console.error("parse-job-description failed", error);
    return jsonResponse({ error: "Failed to parse job description" }, 500);
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST",
      },
    });
  }
  const authError = await requireAuth(req);
  if (authError) return authError;
  return parseJobDescription(req);
});

// Bugfix: CORS headers were only being sent on the OPTIONS preflight
// response, not on the actual POST/error responses. Browsers require the
// Access-Control-Allow-Origin header on the real response too, not just
// the preflight -- without it, the browser silently blocks the frontend
// from ever reading the (successful!) response, which is exactly what
// happened during Stage 2 integration testing.
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
