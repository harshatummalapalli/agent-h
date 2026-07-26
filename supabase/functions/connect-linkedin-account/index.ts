// Native LinkedIn connect — in-app username/password flow (no hosted redirect).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getUserSaleFromRequest } from "../_shared/getUserSale.ts";
import {
  detectLinkedInSeatType,
  fetchUnipileAccount,
  isUnipileConfigured,
  mapUnipileAccountStatus,
  unipileFetch,
} from "../_shared/unipileClient.ts";
import {
  jsonResponse,
  restFetch,
  serveCandidateFacingFunction,
} from "../_shared/candidateFacingEdge.ts";

const handler = async (req: Request) => {
  if (req.method !== "POST")
    return jsonResponse({ error: "Method Not Allowed" }, 405);

  if (!isUnipileConfigured()) {
    return jsonResponse(
      {
        error:
          "LinkedIn outreach isn't configured on this server yet. Ask your admin to add LinkedIn outreach secrets in Supabase Edge Function settings.",
      },
      500,
    );
  }

  let username: string | undefined;
  let password: string | undefined;
  let reconnect = false;
  try {
    const body = await req.json();
    username =
      typeof body?.username === "string" ? body.username.trim() : undefined;
    // Accept password as-is; never log it, never persist it
    password = typeof body?.password === "string" ? body.password : undefined;
    reconnect = Boolean(body?.reconnect);
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!username || !password) {
    return jsonResponse({ error: "username and password are required" }, 400);
  }

  const sale = await getUserSaleFromRequest(req);
  if (!sale) return jsonResponse({ error: "Sales profile not found" }, 404);

  const authHeader = req.headers.get("authorization")!;

  // Call Unipile POST /accounts to initiate native LinkedIn auth
  const connectPayload: Record<string, unknown> = {
    provider: "LINKEDIN",
    username,
    password,
  };
  // If reconnecting, include existing account id so Unipile reuses it
  if (reconnect && sale.unipile_account_id) {
    connectPayload.account_id = sale.unipile_account_id;
  }

  const response = await unipileFetch("/accounts", {
    method: "POST",
    // password is passed to Unipile but never stored on our side
    body: JSON.stringify(connectPayload),
  });

  // Clear sensitive values from memory immediately
  password = undefined;
  connectPayload.password = undefined;

  const result = await response.json().catch(() => ({}));
  const r = result as Record<string, unknown>;

  // 202 Checkpoint — LinkedIn is asking for 2FA/OTP
  if (
    response.status === 202 &&
    (r?.object === "Checkpoint" || r?.checkpoint)
  ) {
    const checkpoint = r.checkpoint as Record<string, unknown> | undefined;
    const checkpointType = String(checkpoint?.type ?? "unknown");
    const accountId = (r.account_id ?? r.id) as string | undefined;

    await restFetch(`sales?id=eq.${sale.id}`, authHeader, {
      method: "PATCH",
      body: JSON.stringify({
        ...(accountId ? { unipile_account_id: accountId } : {}),
        unipile_account_status: "checkpoint_pending",
        unipile_checkpoint_type: checkpointType,
        unipile_last_sync_at: new Date().toISOString(),
      }),
    });

    return jsonResponse(
      {
        status: "checkpoint_pending",
        checkpoint_type: checkpointType,
        message: "LinkedIn needs a verification code before connecting.",
      },
      202,
    );
  }

  if (!response.ok) {
    const detail =
      r?.detail ??
      r?.message ??
      "LinkedIn connection failed — check credentials.";
    return jsonResponse(
      { error: String(detail) },
      response.status >= 500 ? 502 : 400,
    );
  }

  // 201 / 200 success — account created or reconnected
  const accountId = (r.account_id ?? r.id) as string | undefined;
  if (!accountId) {
    return jsonResponse({ error: "Unipile response missing account id" }, 502);
  }

  // Fetch full account details to get seat type and definitive status
  let seatType: string | null = null;
  let accountStatus = "connected";
  let checkpointType: string | null = null;
  try {
    const account = await fetchUnipileAccount(accountId);
    seatType = detectLinkedInSeatType(account);
    const mapped = mapUnipileAccountStatus(account);
    accountStatus = mapped.status;
    checkpointType = mapped.checkpoint_type;
  } catch {
    // Non-fatal: persist what we have; user can refresh status
  }

  const now = new Date().toISOString();
  await restFetch(`sales?id=eq.${sale.id}`, authHeader, {
    method: "PATCH",
    body: JSON.stringify({
      unipile_account_id: accountId,
      unipile_linkedin_seat_type: seatType,
      unipile_account_status: accountStatus,
      unipile_checkpoint_type: checkpointType,
      unipile_connected_at: now,
      unipile_last_sync_at: now,
    }),
  });

  return jsonResponse({
    status: accountStatus,
    seat_type: seatType,
    checkpoint_type: checkpointType,
    message:
      accountStatus === "connected"
        ? "LinkedIn account connected."
        : "LinkedIn account registered — check status.",
  });
};

serveCandidateFacingFunction(handler);
