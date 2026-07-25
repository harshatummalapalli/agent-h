// Agent H Unipile Phase 3: generate hosted-auth link for recruiter LinkedIn connect.
// See docs/adr/ADR-unipile-linkedin-outreach.md and Unipile hosted auth docs.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  isUnipileConfigured,
  UNIPILE_DSN,
  unipileFetch,
} from "../_shared/unipileClient.ts";
import {
  jsonResponse,
  restFetch,
  serveCandidateFacingFunction,
} from "../_shared/candidateFacingEdge.ts";

const UNIPILE_WEBHOOK_SECRET = Deno.env.get("UNIPILE_WEBHOOK_SECRET");
const CRM_BASE_URL = Deno.env.get("CRM_BASE_URL") ?? "http://localhost:5173";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");

function hostedAuthExpiresOn(): string {
  return new Date(Date.now() + 30 * 60 * 1000).toISOString();
}

async function getSalesIdForUser(authHeader: string): Promise<number | null> {
  const res = await restFetch(
    "sales?select=id,unipile_account_id&limit=1",
    authHeader,
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0]?.id ?? null;
}

const handler = async (req: Request) => {
  if (req.method !== "POST")
    return jsonResponse({ error: "Method Not Allowed" }, 405);

  if (!isUnipileConfigured()) {
    return jsonResponse(
      {
        error:
          "LinkedIn connection is not configured yet — set UNIPILE_API_KEY and UNIPILE_DSN.",
      },
      500,
    );
  }

  let reconnect = false;
  try {
    const body = await req.json().catch(() => ({}));
    reconnect = Boolean(body?.reconnect);
  } catch {
    reconnect = false;
  }

  const authHeader = req.headers.get("authorization")!;
  const salesId = await getSalesIdForUser(authHeader);
  if (!salesId) {
    return jsonResponse(
      { error: "Sales profile not found for this user" },
      404,
    );
  }

  let reconnectAccountId: string | undefined;
  if (reconnect) {
    const salesRes = await restFetch(
      `sales?id=eq.${salesId}&select=unipile_account_id`,
      authHeader,
    );
    const salesRows = await salesRes.json();
    reconnectAccountId = salesRows?.[0]?.unipile_account_id ?? undefined;
    if (!reconnectAccountId) {
      return jsonResponse(
        { error: "No LinkedIn account on file to reconnect — connect first." },
        400,
      );
    }
  }

  const notifyUrl =
    UNIPILE_WEBHOOK_SECRET && SUPABASE_URL
      ? `${SUPABASE_URL}/functions/v1/unipile-hosted-auth-notify?secret=${encodeURIComponent(UNIPILE_WEBHOOK_SECRET)}`
      : undefined;

  const payload: Record<string, unknown> = {
    type: reconnect ? "reconnect" : "create",
    providers: ["LINKEDIN"],
    api_url: UNIPILE_DSN,
    expiresOn: hostedAuthExpiresOn(),
    name: String(salesId),
    success_redirect_url: `${CRM_BASE_URL}/profile?linkedin=connected`,
    failure_redirect_url: `${CRM_BASE_URL}/profile?linkedin=failed`,
  };
  if (notifyUrl) payload.notify_url = notifyUrl;
  if (reconnectAccountId) payload.reconnect_account = reconnectAccountId;

  const response = await unipileFetch("/hosted/accounts/link", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(
      "create-unipile-hosted-auth-link failed",
      response.status,
      result,
    );
    return jsonResponse(
      { error: "Failed to create LinkedIn connection link" },
      502,
    );
  }

  return jsonResponse({
    url: (result as Record<string, unknown>).url,
    expires_on: payload.expiresOn,
  });
};

serveCandidateFacingFunction(handler);
