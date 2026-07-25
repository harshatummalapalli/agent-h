// Agent H Phase C: append an agent-authored turn to role_conversation_turns.
// Recruiter JWT is verified; insert uses service role so speaker='agent'
// passes the client-side trigger guard. See ADR Phase C approval model.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

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

async function requireAuth(
  req: Request,
): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader)
    return jsonResponse({ error: "Missing authorization header" }, 401);
  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer" || !token) {
    return jsonResponse({ error: "Invalid authorization header" }, 401);
  }
  try {
    const { payload } = await jose.jwtVerify(token, SUPABASE_JWT_KEYS, {
      issuer: SUPABASE_JWT_ISSUER,
    });
    const userId = payload.sub;
    if (!userId) return jsonResponse({ error: "Unauthorized" }, 401);
    return { userId };
  } catch {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
}

const handler = async (req: Request) => {
  if (req.method !== "POST")
    return jsonResponse({ error: "Method Not Allowed" }, 405);

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  let dealId: number | undefined;
  let content: string | undefined;
  let metadata: Record<string, unknown> | undefined;
  let inReplyTo: number | null | undefined;
  let idempotencyKey: string | null | undefined;
  try {
    const body = await req.json();
    dealId = body?.deal_id;
    content = body?.content;
    metadata = body?.metadata ?? {};
    inReplyTo = body?.in_reply_to ?? null;
    idempotencyKey = body?.idempotency_key ?? null;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!dealId || !content?.trim()) {
    return jsonResponse({ error: "deal_id and content are required" }, 400);
  }

  const { data: salesRow, error: salesError } = await supabaseAdmin
    .from("sales")
    .select("id, tenant_id")
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (salesError || !salesRow?.tenant_id) {
    return jsonResponse({ error: "Failed to resolve recruiter tenant" }, 403);
  }

  const { data: dealRow, error: dealError } = await supabaseAdmin
    .from("deals")
    .select("id")
    .eq("id", dealId)
    .eq("tenant_id", salesRow.tenant_id)
    .maybeSingle();

  if (dealError || !dealRow) {
    return jsonResponse(
      { error: "Role brief not found (or access denied)" },
      404,
    );
  }

  const { data, error } = await supabaseAdmin
    .from("role_conversation_turns")
    .insert({
      tenant_id: salesRow.tenant_id,
      deal_id: dealId,
      speaker: "agent",
      actor_sales_id: null,
      content: content.trim(),
      metadata,
      in_reply_to: inReplyTo,
      idempotency_key: idempotencyKey,
    })
    .select("*")
    .single();

  if (error) {
    console.error("append-agent-conversation-turn: insert failed", error);
    return jsonResponse({ error: "Failed to append agent turn" }, 502);
  }

  return jsonResponse({ turn: data });
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return handler(req);
});
