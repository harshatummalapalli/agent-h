// Agent H Unipile Phase 3: hosted-auth notify_url callback from Unipile.
// verify_jwt is OFF — authenticated via UNIPILE_WEBHOOK_SECRET query param.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  detectLinkedInSeatType,
  fetchUnipileAccount,
  mapUnipileAccountStatus,
} from "../_shared/unipileClient.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const UNIPILE_WEBHOOK_SECRET = Deno.env.get("UNIPILE_WEBHOOK_SECRET");

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function serviceRestFetch(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY ?? "",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function verifyWebhookSecret(req: Request): boolean {
  if (!UNIPILE_WEBHOOK_SECRET) {
    console.error("unipile-hosted-auth-notify: UNIPILE_WEBHOOK_SECRET not set");
    return false;
  }
  const url = new URL(req.url);
  return url.searchParams.get("secret") === UNIPILE_WEBHOOK_SECRET;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }
  if (!verifyWebhookSecret(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const status = String(payload.status ?? "");
  const accountId = payload.account_id as string | undefined;
  const salesIdRaw = payload.name as string | undefined;
  const salesId = salesIdRaw ? Number(salesIdRaw) : NaN;

  if (!accountId || !Number.isFinite(salesId)) {
    return jsonResponse(
      { error: "account_id and name (sales id) are required" },
      400,
    );
  }

  if (status !== "CREATION_SUCCESS" && status !== "RECONNECTED") {
    console.warn("unipile-hosted-auth-notify: unexpected status", status);
    return jsonResponse({ received: true, ignored: true });
  }

  let seatType: string | null = null;
  let accountStatus = "connected";
  let checkpointType: string | null = null;
  let metadata: Record<string, unknown> = { notify_status: status };

  try {
    const account = await fetchUnipileAccount(accountId);
    seatType = detectLinkedInSeatType(account);
    const mapped = mapUnipileAccountStatus(account);
    accountStatus = mapped.status;
    checkpointType = mapped.checkpoint_type;
    metadata = { ...metadata, account_snapshot: account };
  } catch (error) {
    console.error(
      "unipile-hosted-auth-notify: account fetch failed (non-fatal)",
      error,
    );
  }

  const now = new Date().toISOString();
  const patchRes = await serviceRestFetch(`sales?id=eq.${salesId}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      unipile_account_id: accountId,
      unipile_linkedin_seat_type: seatType,
      unipile_account_status: accountStatus,
      unipile_checkpoint_type: checkpointType,
      unipile_connected_at: now,
      unipile_last_sync_at: now,
      unipile_metadata: metadata,
    }),
  });

  if (!patchRes.ok) {
    console.error(
      "unipile-hosted-auth-notify: failed to update sales",
      await patchRes.text(),
    );
    return jsonResponse({ error: "Failed to save LinkedIn connection" }, 502);
  }

  return jsonResponse({
    received: true,
    sales_id: salesId,
    account_id: accountId,
  });
});
