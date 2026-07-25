// Agent H Unipile Phase 3: read/sync recruiter LinkedIn connection state from Unipile.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getUserSaleFromRequest } from "../_shared/getUserSale.ts";
import {
  detectLinkedInSeatType,
  fetchUnipileAccount,
  isUnipileConfigured,
  mapUnipileAccountStatus,
} from "../_shared/unipileClient.ts";
import {
  jsonResponse,
  restFetch,
  serveCandidateFacingFunction,
} from "../_shared/candidateFacingEdge.ts";

const handler = async (req: Request) => {
  if (req.method !== "POST")
    return jsonResponse({ error: "Method Not Allowed" }, 405);

  const sale = await getUserSaleFromRequest(req);
  if (!sale) return jsonResponse({ error: "Sales profile not found" }, 404);

  const authHeader = req.headers.get("authorization")!;

  const base = {
    configured: isUnipileConfigured(),
    account_id: sale.unipile_account_id as string | null,
    seat_type: sale.unipile_linkedin_seat_type as string | null,
    status: (sale.unipile_account_status as string | null) ?? "disconnected",
    checkpoint_type: sale.unipile_checkpoint_type as string | null,
    connected_at: sale.unipile_connected_at as string | null,
    last_sync_at: sale.unipile_last_sync_at as string | null,
  };

  if (!base.account_id || !isUnipileConfigured()) {
    return jsonResponse(base);
  }

  try {
    const account = await fetchUnipileAccount(base.account_id);
    const mapped = mapUnipileAccountStatus(account);
    const seatType = detectLinkedInSeatType(account);
    const now = new Date().toISOString();

    await restFetch(`sales?id=eq.${sale.id}`, authHeader, {
      method: "PATCH",
      body: JSON.stringify({
        unipile_linkedin_seat_type: seatType,
        unipile_account_status: mapped.status,
        unipile_checkpoint_type: mapped.checkpoint_type,
        unipile_last_sync_at: now,
        unipile_metadata: { account_snapshot: account },
      }),
    });

    return jsonResponse({
      ...base,
      seat_type: seatType,
      status: mapped.status,
      checkpoint_type: mapped.checkpoint_type,
      last_sync_at: now,
    });
  } catch (error) {
    console.error("get-unipile-linkedin-account sync failed", error);
    return jsonResponse({
      ...base,
      sync_error: error instanceof Error ? error.message : "Sync failed",
    });
  }
};

serveCandidateFacingFunction(handler);
