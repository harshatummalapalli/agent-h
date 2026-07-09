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
const EXTRACTION_TOOL = {
  name: "extract_role_brief",
  description:
    "Extract a structured recruiting role brief from a natural-language job description.",
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
          "Primary work location as stated or implied (city/region/country, or 'Remote').",
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
          "Minimum years of experience required, if stated. Null if not stated.",
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
          "Concrete skills/technologies/tools mentioned (e.g. 'Python', 'AWS', 'stakeholder management'). Short keyword form, not full sentences.",
      },
      must_have_keywords: {
        type: "array",
        items: { type: "string" },
        description:
          "Hard requirements explicitly framed as required/must-have. Short keyword/phrase form.",
      },
      nice_to_have_keywords: {
        type: "array",
        items: { type: "string" },
        description:
          "Preferred-but-not-required qualifications (framed as 'nice to have', 'bonus', 'preferred'). Short keyword/phrase form.",
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
        max_tokens: 1024,
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

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
