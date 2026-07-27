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
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_SCORING_MODEL") || "claude-haiku-4-5-20251001";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

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
  if (!authHeader)
    return jsonResponse({ error: "Missing authorization header" }, 401);
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
          "create_role",
          "start_sourcing",
          "continue_sourcing",
          "calibration_yes",
          "calibration_no",
          "show_more_like_this",
          "relax_and_research",
          "relax_criterion",
          "request_resume",
          "send_first_outreach",
          "reject_candidates",
          "show_candidates",
          "show_roles",
          "refine_search_intent",
          "unknown",
        ],
        description:
          "create_role: recruiter wants to START A NEW ROLE/JOB/REQ -- phrases like 'create a new role', 'I need to hire a...', 'start sourcing for a new position'. Navigates home; no deal_id needed. start_sourcing: recruiter signals they are done with intake and wants to search NOW for the current role -- phrases like 'start sourcing', 'find candidates', 'search now', 'that\\'s enough', 'go ahead', 'begin'. Triggers the calibration pull for current_deal_id. continue_sourcing: run another sourcing pass for a role (legacy, kept for backward compat). calibration_yes: recruiter signals the shown candidates look good -- 'yes', 'looks good', 'good fit', 'they look right', 'approved'. Show the next batch from the ranked cache. calibration_no: recruiter signals the shown candidates are NOT a fit -- 'no', 'not a fit', 'wrong profile', 'pass', 'none of these'. Will prompt for a reason then rerank. show_more_like_this: recruiter wants more candidates similar to the ones already shown positively -- 'show more like this', 'more of these', 'keep going'. relax_and_research: recruiter wants to loosen a criterion and run a fresh search -- 'relax [criterion] and search again', 'widen the search', 'broaden the criteria'. relax_criterion: turn off one active must-have/exclude criterion for a role. request_resume: ask selected candidate(s) to send a resume. send_first_outreach: send first contact to a candidate (LinkedIn/email). reject_candidates: remove selected candidate(s) from pipeline. show_candidates: SEE/browse candidates for a specific role. show_roles: see all roles/jobs. refine_search_intent: recruiter wants to add, change, or exclude something about who the search looks for — a requirement, an exclusion, a company, a skill, anything that updates search criteria via free text (not a workflow action like starting sourcing or reviewing candidates). Examples: 'exclude Google and Meta', 'require 5+ years Python', 'only remote candidates'. unknown: none of the above.",
      },
      deal_id: {
        type: ["number", "null"],
        description:
          "The id of the role brief (deal) this command refers to, resolved from the open_deals list in context. Null if it can't be determined or isn't needed.",
      },
      criterion_id: {
        type: ["number", "null"],
        description:
          "For relax_criterion only: the id of the matching criterion from the active_criteria list in context, matched by meaning not exact wording. Null otherwise or if no confident match exists.",
      },
      candidate_id: {
        type: ["number", "null"],
        description:
          "For request_resume, send_first_outreach, and other Tier-3 candidate actions: the id of exactly one candidate this command targets. Resolve from selected_candidates when the recruiter means 'these/selected' and exactly one row is selected; from pipeline_candidates when they name someone (e.g. 'ask Alex for their resume', 'reach out to Priya'); null if ambiguous, none selected, or the action doesn't need a candidate.",
      },
      use_selected_candidates: {
        type: "boolean",
        description:
          "For request_resume/send_first_outreach/reject_candidates: true if the command refers to 'selected'/'these' candidates in the table rather than naming someone specific. When exactly one candidate is selected, also set candidate_id to that candidate's id.",
      },
      explanation: {
        type: "string",
        description:
          "One short plain-language sentence describing what this command will do, to show the recruiter before/while it runs. If action is 'unknown', explain briefly why nothing matched.",
      },
    },
    required: ["action", "explanation"],
  },
};

type CandidateRef = { id: number; name: string };

type CommandContext = {
  view: "inbox" | "canvas";
  open_deals: Array<{ id: number; name: string }>;
  current_deal_id?: number | null;
  active_criteria?: Array<{ id: number; label: string }>;
  selected_candidate_count?: number;
  selected_candidates?: CandidateRef[];
  pipeline_candidates?: CandidateRef[];
};

const buildPrompt = (commandText: string, context: CommandContext) =>
  `
A recruiter typed this into Agent H's command bar: "${commandText}"

Context:
- Current view: ${context.view}
- Currently open role (if any): ${context.current_deal_id ?? "none -- recruiter is on the Inbox, not scoped to one role"}
- Open roles available to reference by name: ${JSON.stringify(context.open_deals)}
- Active criteria on the currently open role (if any): ${JSON.stringify(context.active_criteria ?? [])}
- Candidates currently selected in the table (if any): ${JSON.stringify(context.selected_candidates ?? [])}
- All candidates in this role's pipeline (for name matching): ${JSON.stringify(context.pipeline_candidates ?? [])}

Classify this into exactly one supported action using submit_parsed_command. Resolve role names (e.g. "the AI Engineer role") against open_deals by meaning, not exact string match. If the recruiter clearly means "the role I'm currently looking at" and current_deal_id is set, use that instead of guessing from open_deals.

For request_resume and send_first_outreach: set candidate_id when you can identify exactly one person — from selected_candidates when they say "these/selected" and one row is checked, or from pipeline_candidates when they name someone (first name, full name, or close match). Set use_selected_candidates true when they mean the current table selection. Leave candidate_id null only when no single candidate can be resolved.

For send_first_outreach: use when the recruiter wants to initiate first contact with a candidate (LinkedIn or email outreach), not when they only want to browse candidates or request a resume.
`.trim();

const parseCommandHandler = async (req: Request) => {
  if (req.method !== "POST")
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  if (!ANTHROPIC_API_KEY) {
    return jsonResponse(
      { error: "ANTHROPIC_API_KEY is not set for this project." },
      500,
    );
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
    return jsonResponse(
      { error: "command_text and context are required" },
      400,
    );
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
    console.error(
      "parse-agent-command: Anthropic API error",
      anthropicResponse.status,
      errorBody,
    );
    return jsonResponse(
      { error: `Command parsing model error (${anthropicResponse.status})` },
      502,
    );
  }

  const anthropicResult = await anthropicResponse.json();
  const toolUseBlock = anthropicResult?.content?.find(
    (b: any) => b.type === "tool_use",
  );
  if (!toolUseBlock) {
    console.error("parse-agent-command: no tool_use block", anthropicResult);
    return jsonResponse(
      { error: "Command parsing model did not return structured output" },
      502,
    );
  }

  return jsonResponse(toolUseBlock.input);
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  const authError = await requireAuth(req);
  if (authError) return authError;
  return parseCommandHandler(req);
});
