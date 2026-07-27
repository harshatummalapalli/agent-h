// resolve-search-intent — taxonomy-aware LLM step that produces a versioned
// SearchIntent from accumulated context (JD, refinements, calibration feedback).
//
// Called at INTAKE (when a role brief is created/sourcing starts) and at every
// RECALIBRATION (not-a-fit, refine, show-more-like-this). Same code path; only
// the input context differs.
//
// Output is persisted on deals.role_brief_search_intent as
//   { current: VersionedSearchIntent, history: VersionedSearchIntent[] }
//
// Forced tool-use guarantees structured output; the LLM cannot free-text around
// the schema. Manifest is embedded in the system prompt so the model only
// proposes filterable conditions.
//
// SECURITY INVARIANT: all PostgREST reads/writes ride the caller's Authorization
// JWT so Postgres RLS enforces tenant isolation. Service-role is never used for
// deal/transcript access — a cross-tenant deal_id returns 0 rows (404) rather
// than leaking data.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";
import {
  makeInitialIntent,
  bumpIntent,
  updateSearchIntentRecord,
} from "../_shared/searchIntent.ts";
import type {
  VersionedSearchIntent,
  SearchIntentRecord,
} from "../_shared/searchIntent.ts";
import {
  RESOLVE_INTENT_TOOL,
  buildSystemPrompt,
  buildUserMessage,
  parseToolOutput,
} from "./resolveSearchIntentPrompt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";
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

// Returns the raw Authorization header (e.g. "Bearer <token>") after verifying
// the JWT signature, or a Response on failure. All DB calls must use this header
// so RLS scopes reads/writes to the caller's tenant.
async function requireAuth(req: Request): Promise<string | Response> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader)
    return jsonResponse({ error: "Missing authorization header" }, 401);
  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer" || !token)
    return jsonResponse({ error: "Invalid authorization header" }, 401);
  try {
    await jose.jwtVerify(token, SUPABASE_JWT_KEYS, {
      issuer: SUPABASE_JWT_ISSUER,
    });
    return authHeader;
  } catch {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
}

// ─── Fetch existing search intent + tenant from deals ────────────────────────
// Rides the caller's JWT — RLS ensures only the caller's tenant rows are visible.
// Returns null for both fields when deal_id doesn't exist or belongs to another tenant.

async function fetchDealRow(
  dealId: number,
  authHeader: string,
): Promise<{ intent: SearchIntentRecord | null; tenantId: number | null }> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/deals?id=eq.${dealId}&select=role_brief_search_intent,tenant_id`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: authHeader,
      },
    },
  );
  if (!res.ok) return { intent: null, tenantId: null };
  const rows = await res.json();
  return {
    intent:
      (rows[0]?.role_brief_search_intent as SearchIntentRecord | null) ?? null,
    tenantId: (rows[0]?.tenant_id as number | null) ?? null,
  };
}

// ─── Write intent-update turn to transcript ───────────────────────────────────
// Rides the caller's JWT — RLS ensures inserts land in the caller's tenant.

async function writeIntentTurn(
  dealId: number,
  tenantId: number | null,
  next: VersionedSearchIntent,
  authHeader: string,
): Promise<void> {
  const required = next.conditions.filter((c) => c.disposition === "require");
  const excluded = next.conditions.filter((c) => c.disposition === "exclude");
  const preferred = next.conditions.filter((c) => c.disposition === "prefer");
  const lines: string[] = [
    "Sourcing understanding updated (v" + next.version + "):",
  ];
  if (required.length)
    lines.push(`Require: ${required.map((c) => c.value).join(", ")}`);
  if (excluded.length)
    lines.push(`Exclude: ${excluded.map((c) => c.value).join(", ")}`);
  if (preferred.length)
    lines.push(`Prefer: ${preferred.map((c) => c.value).join(", ")}`);
  if (next.unenforceable_constraints?.length) {
    lines.push(
      `Approximate only: ${next.unenforceable_constraints.map((u) => u.description).join(", ")}`,
    );
  }
  await fetch(`${SUPABASE_URL}/rest/v1/role_conversation_turns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: authHeader,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      deal_id: dealId,
      speaker: "agent",
      content: lines.join("\n"),
      idempotency_key: `intent-v${next.version}-deal-${dealId}`,
      metadata: { kind: "intent_update", intent_version: next.version },
    }),
  });
}

// ─── Persist updated intent to deals ─────────────────────────────────────────
// Rides the caller's JWT — RLS blocks cross-tenant writes automatically.

async function persistIntent(
  dealId: number,
  record: SearchIntentRecord,
  authHeader: string,
): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/deals?id=eq.${dealId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: authHeader,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ role_brief_search_intent: record }),
  });
}

// ─── LLM call ─────────────────────────────────────────────────────────────────

async function callLLM(params: {
  jd_text?: string;
  refine_history?: string[];
  calibration_feedback?: string[];
  previous_intent?: VersionedSearchIntent | null;
}): Promise<{
  conditions: Parameters<typeof makeInitialIntent>[0];
  unenforceable_constraints: Parameters<typeof makeInitialIntent>[1];
}> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      system: buildSystemPrompt(),
      tools: [RESOLVE_INTENT_TOOL],
      tool_choice: { type: "tool", name: "resolve_search_intent" },
      messages: [
        {
          role: "user",
          content: buildUserMessage(params),
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${err}`);
  }

  const result = await response.json();
  const toolBlock = result?.content?.find(
    (b: { type: string }) => b.type === "tool_use",
  );
  if (!toolBlock?.input) {
    throw new Error("No tool_use block in LLM response");
  }
  return parseToolOutput(toolBlock.input);
}

// ─── Main handler ─────────────────────────────────────────────────────────────

async function handleResolveSearchIntent(
  req: Request,
  authHeader: string,
): Promise<Response> {
  let body: {
    deal_id?: number;
    jd_text?: string;
    refine_history?: string[];
    calibration_feedback?: string[];
    previous_intent?: VersionedSearchIntent | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { deal_id, jd_text, refine_history, calibration_feedback } = body;
  if (!deal_id) return jsonResponse({ error: "deal_id is required" }, 400);
  if (!jd_text && !refine_history?.length && !calibration_feedback?.length) {
    return jsonResponse(
      {
        error:
          "At least one of jd_text, refine_history, or calibration_feedback is required",
      },
      400,
    );
  }

  // Fetch existing record under the caller's JWT (RLS enforces tenant ownership).
  // Empty rows[] means deal_id doesn't exist or belongs to another tenant — return 404.
  const { intent: existingRecord, tenantId } = await fetchDealRow(
    deal_id,
    authHeader,
  );
  if (tenantId === null) {
    return jsonResponse({ error: "Deal not found" }, 404);
  }
  const previous_intent =
    body.previous_intent ?? existingRecord?.current ?? null;

  // Call the LLM to produce updated conditions.
  const { conditions, unenforceable_constraints } = await callLLM({
    jd_text,
    refine_history,
    calibration_feedback,
    previous_intent,
  });

  // Build new versioned intent.
  const next: VersionedSearchIntent = previous_intent
    ? bumpIntent(previous_intent, conditions, unenforceable_constraints)
    : makeInitialIntent(conditions, unenforceable_constraints);

  // Persist, write transcript turn (non-fatal), and return.
  const updatedRecord = updateSearchIntentRecord(existingRecord, next);
  await persistIntent(deal_id, updatedRecord, authHeader);
  void writeIntentTurn(deal_id, tenantId, next, authHeader).catch((err) =>
    console.warn("writeIntentTurn failed (non-fatal):", err),
  );

  return jsonResponse({ intent: next, record: updatedRecord });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;
  try {
    return await handleResolveSearchIntent(req, authResult);
  } catch (err) {
    console.error("resolve-search-intent error", err);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
