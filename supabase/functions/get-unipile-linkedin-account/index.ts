// Agent H Unipile Phase 3: read/sync recruiter LinkedIn connection state from Unipile.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
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

  const authHeader = req.headers.get("authorization")!;

  const salesRes = await restFetch(
    "sales?select=id,unipile_account_id,unipile_linkedin_seat_type,unipile_account_status,unipile_checkpoint_type,unipile_connected_at,unipile_last_sync_at&limit=1",
    authHeader,
  );
  if (!salesRes.ok)
    return jsonResponse({ error: "Failed to load profile" }, 502);

  const sales = (await salesRes.json())?.[0];
  if (!sales) return jsonResponse({ error: "Sales profile not found" }, 404);

  const base = {
    configured: isUnipileConfigured(),
    account_id: sales.unipile_account_id as string | null,
    seat_type: sales.unipile_linkedin_seat_type as string | null,
    status: (sales.unipile_account_status as string | null) ?? "disconnected",
    checkpoint_type: sales.unipile_checkpoint_type as string | null,
    connected_at: sales.unipile_connected_at as string | null,
    last_sync_at: sales.unipile_last_sync_at as string | null,
  };

  if (!base.account_id || !isUnipileConfigured()) {
    return jsonResponse(base);
  }

  try {
    const account = await fetchUnipileAccount(base.account_id);
    const mapped = mapUnipileAccountStatus(account);
    const seatType = detectLinkedInSeatType(account);
    const now = new Date().toISOString();

    await restFetch(`sales?id=eq.${sales.id}`, authHeader, {
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
