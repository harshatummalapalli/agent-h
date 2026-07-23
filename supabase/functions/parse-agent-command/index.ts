// Agent H, Triage Inbox + Command Canvas: the free-text half of the
// command bar. Slash commands (/reject, /relax, /request-resume) already
// map directly to a known action client-side -- this function exists for
// everything else a recruiter might just type, e.g. "continue sourcing on
// the AI Engineer role" or "relax the Python requirement for DevOps". It
// does NOT execute anything itself: it classifies the free text into one
// of a small, fixed set of actions this app can actually perform, resolves
// which role/criterion/candidates it refers to using the context passed
// in, and hands that back as structured params. The client (InboxPage /
// CanvasPage) is responsible for calling the real dataProvider methods --
// this function has no side effects of its own, so a misclassification
// costs one wasted round trip, never a wrong action taken silently.
//
// Deliberately narrow tool schema: "unknown" is a first-class, expected
// result, not a failure -- most free text a recruiter types will NOT map
// to one of the real actions this app supports today, and the UI should
// say so plainly rather than the model forcing a guess.
//
// show_candidates/show_roles are navigation intents, not mutations --
// added after a live test where "show me the resumes sourced" came back
// "unknown" because there was no action for browsing/viewing anything.
// They resolve to a client-side navigate() to the existing Canvas page
// (per-role candidate table) or the existing Roles/deals list -- both
// already built, this just gives the command bar a way to route there.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_JWT_ISSUER = Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_SCORING_MODEL") || "claude-haiku-4-5-20251001";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST",
};

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });

async function requireAuth(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return jsonResponse({ error: "Missing authorization header" }, 401);
  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer" || !token) {
    return jsonResponse({ error: "Invalid authorization header" }, 401);
  }
  try {
    await jose.jwtVerify(token, SUPABASE_JWT_KEYS, { issuer: SUPABASE_JWT_ISSUER });
    return null;
  } catch {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
}

const PARSE_COMMAND_TOOL = {
  name: "submit_parsed_command",
  description:
    "Classify a recruiter's free-text request into one of this app's real supported actions, resolving which role/criterion/candidates it refers to from the given context. Use 'unknown' whenever the request doesn't clearly map to a supported action -- do not force a guess.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "continue_sourcing",
          "relax_criterion",
          "request_resume",
          "reject_candidates",
          "show_candidates",
          "show_roles",
          "unknown",
        ],
        description:
          "continue_sourcing: run another sourcing pass for a role. relax_criterion: turn off one active must-have/exclude criterion for a role. request_resume: ask selected candidate(s) to send a resume. reject_candidates: remove selected candidate(s) from a role's pipeline. show_candidates: the recruiter wants to SEE/browse/list the candidates or resumes sourced for one specific role (navigates there, resolve deal_id from open_deals or current_deal_id). show_roles: the recruiter wants to see/browse/list all roles/jobs, not scoped to one role. unknown: none of the above apply.",
      },
      deal_id: {
        type: ["number", "null"],
        description: "The id of the role brief (deal) this command refers to, resolved from the open_deals list in context. Null if it can't be determined or isn't needed.",
      },
      criterion_id: {
        type: ["number", "null"],
        description: "For relax_criterion only: the id of the matching criterion from the active_criteria list in context, matched by meaning not exact wording. Null otherwise or if no confident match exists.",
      },
      use_selected_candidates: {
        type: "boolean",
        description: "For request_resume/reject_candidates: true if the command refers to 'selected'/'these' candidates (use the selected_candidate_ids from context) rather than naming someone specific.",
      },
      explanation: {
        type: "string",
        description: "One short plain-language sentence describing what this command will do, to show the recruiter before/while it runs. If action is 'unknown', explain briefly why nothing matched.",
      },
    },
    required: ["action", "explanation"],
  },
};

type CommandContext = {
  view: "inbox" | "canvas";
  open_deals: Array<{ id: number; name: string }>;
  current_deal_id?: number | null;
  active_criteria?: Array<{ id: number; label: string }>;
  selected_candidate_count?: number;
};

const buildPrompt = (commandText: string, context: CommandContext) => `
A recruiter typed this into Agent H's command bar: "${commandText}"

Context:
- Current view: ${context.view}
- Currently open role (if any): ${context.current_deal_id ?? "none -- recruiter is on the Inbox, not scoped to one role"}
- Open roles available to reference by name: ${JSON.stringify(context.open_deals)}
- Active criteria on the currently open role (if any): ${JSON.stringify(context.active_criteria ?? [])}
- Candidates currently selected in the table (if any): ${context.selected_candidate_count ?? 0}

Classify this into exactly one supported action using submit_parsed_command. Resolve role names (e.g. "the AI Engineer role") against open_deals by meaning, not exact string match. If the recruiter clearly means "the role I'm currently looking at" and current_deal_id is set, use that instead of guessing from open_deals.
`.trim();

const parseCommandHandler = async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);
  if (!ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "ANTHROPIC_API_KEY is not set for this project." }, 500);
  }

  let commandText: string | undefined;
  let context: CommandContext | undefined;
  try {
    const body = await req.json();
    commandText = body?.command_text;
    context = body?.context;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!commandText || typeof commandText !== "string" || !context) {
    return jsonResponse({ error: "command_text and context are required" }, 400);
  }

  const anthropicResponse = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 512,
      tools: [PARSE_COMMAND_TOOL],
      tool_choice: { type: "tool", name: "submit_parsed_command" },
      messages: [{ role: "user", content: buildPrompt(commandText, context) }],
    }),
  });

  if (!anthropicResponse.ok) {
    const errorBody = await anthropicResponse.text();
    console.error("parse-agent-command: Anthropic API error", anthropicResponse.status, errorBody);
    return jsonResponse({ error: `Command parsing model error (${anthropicResponse.status})` }, 502);
  }

  const anthropicResult = await anthropicResponse.json();
  const toolUseBlock = anthropicResult?.content?.find((b: any) => b.type === "tool_use");
  if (!toolUseBlock) {
    console.error("parse-agent-command: no tool_use block", anthropicResult);
    return jsonResponse({ error: "Command parsing model did not return structured output" }, 502);
  }

  return jsonResponse(toolUseBlock.input);
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  const authError = await requireAuth(req);
  if (authError) return authError;
  return parseCommandHandler(req);
});
