// Agent H Unipile Phase 3: solve LinkedIn auth checkpoint (2FA, OTP, etc.).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getUserSaleFromRequest } from "../_shared/getUserSale.ts";
import {
  detectLinkedInSeatType,
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
    return jsonResponse({ error: "Unipile is not configured" }, 500);
  }

  let code: string | undefined;
  let tryAnotherWay = false;
  try {
    const body = await req.json();
    code = typeof body?.code === "string" ? body.code.trim() : undefined;
    tryAnotherWay = Boolean(body?.try_another_way);
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!code) {
    return jsonResponse({ error: "code is required" }, 400);
  }

  const sale = await getUserSaleFromRequest(req);
  if (!sale) return jsonResponse({ error: "Sales profile not found" }, 404);

  const accountId = sale.unipile_account_id as string | undefined;
  if (!accountId) {
    return jsonResponse({ error: "No LinkedIn account connected yet" }, 400);
  }

  const authHeader = req.headers.get("authorization")!;

  const response = await unipileFetch("/accounts/checkpoint", {
    method: "POST",
    body: JSON.stringify({
      account_id: accountId,
      provider: "LINKEDIN",
      code: tryAnotherWay ? "TRY_ANOTHER_WAY" : code,
    }),
  });

  const result = await response.json().catch(() => ({}));

  if (
    response.status === 202 &&
    (result as Record<string, unknown>)?.object === "Checkpoint"
  ) {
    const checkpoint = (result as Record<string, unknown>).checkpoint as
      | Record<string, unknown>
      | undefined;
    const checkpointType = String(checkpoint?.type ?? "unknown");
    await restFetch(`sales?id=eq.${sale.id}`, authHeader, {
      method: "PATCH",
      body: JSON.stringify({
        unipile_account_status: "checkpoint_pending",
        unipile_checkpoint_type: checkpointType,
        unipile_last_sync_at: new Date().toISOString(),
      }),
    });
    return jsonResponse(
      {
        status: "checkpoint_pending",
        checkpoint_type: checkpointType,
        message: "LinkedIn needs another verification step.",
      },
      202,
    );
  }

  if (!response.ok) {
    console.error("solve-unipile-checkpoint failed", response.status, result);
    return jsonResponse(
      {
        error:
          (result as Record<string, unknown>)?.detail ??
          "Checkpoint code was rejected — try again.",
      },
      response.status === 401 ? 401 : 502,
    );
  }

  const seatType = detectLinkedInSeatType(result as Record<string, unknown>);
  const mapped = mapUnipileAccountStatus(result as Record<string, unknown>);
  const now = new Date().toISOString();

  await restFetch(`sales?id=eq.${sale.id}`, authHeader, {
    method: "PATCH",
    body: JSON.stringify({
      unipile_linkedin_seat_type: seatType,
      unipile_account_status:
        mapped.status === "unknown" ? "connected" : mapped.status,
      unipile_checkpoint_type: null,
      unipile_last_sync_at: now,
      unipile_metadata: { checkpoint_result: result },
    }),
  });

  return jsonResponse({
    status: "connected",
    seat_type: seatType,
    message: "LinkedIn account verified.",
  });
};

serveCandidateFacingFunction(handler);
