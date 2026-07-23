// Agent H Stage 5: Scheduling -- receives Cal.com booking webhooks.
//
// This function is called by Cal.com itself, not by a signed-in recruiter,
// so verify_jwt is OFF for this function (see deploy config) -- auth here
// is a webhook HMAC signature instead of a Supabase user JWT. Do not copy
// the jose/JWT auth pattern from the rest of this project's functions here.
//
// Cal.com's actual events (BOOKING_CREATED / _RESCHEDULED / _CANCELLED /
// MEETING_ENDED) all carry the candidateId/dealId we stamped into the
// booking's metadata at link-creation time (see create-booking-link) --
// that's what lets this receiver find the right public.interviews row
// directly, instead of trying to match on Cal.com's own booking uid (which
// changes across a reschedule).
//
// Required secrets:
//   CAL_WEBHOOK_SECRET           the signing secret configured on the
//                                 Cal.com webhook subscription
//   SUPABASE_SERVICE_ROLE_KEY    used to write regardless of RLS -- there is
//                                 no recruiter session in a webhook call
//   RESEND_API_KEY / RESEND_FROM_EMAIL  optional booking-confirmation email
//
// NOTE for whoever wires up the actual Cal.com webhook subscription: the
// signature header name below (x-cal-signature-256) matches Cal.com's
// documented HMAC-SHA256-over-raw-body scheme as of this writing. If
// Cal.com's self-hosted webhook settings screen shows a different header
// name for your instance/version, update SIGNATURE_HEADER accordingly --
// this was not hand-verified against a live webhook call yet (no Cal.com
// instance existed at build time), so treat it as a first-pass assumption,
// not a confirmed fact.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CAL_WEBHOOK_SECRET = Deno.env.get("CAL_WEBHOOK_SECRET");

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL");

const SIGNATURE_HEADER = "x-cal-signature-256";

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

async function verifySignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!CAL_WEBHOOK_SECRET) {
    console.error("cal-webhook-receiver: CAL_WEBHOOK_SECRET is not set -- refusing to process unsigned webhooks");
    return false;
  }
  if (!signatureHeader) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(CAL_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computedHex = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return computedHex === signatureHeader.toLowerCase();
}

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

// Duplicated from create-booking-link deliberately -- see that file's
// header comment for why these two functions each keep their own copy.
async function sendResendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: [to], subject, html }),
    });
    if (!res.ok) {
      console.error("cal-webhook-receiver: Resend send failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("cal-webhook-receiver: Resend send threw", error);
    return false;
  }
}

const TRIGGER_TO_STATUS: Record<string, string> = {
  BOOKING_CREATED: "booked",
  BOOKING_RESCHEDULED: "rescheduled",
  BOOKING_CANCELLED: "cancelled",
  MEETING_ENDED: "completed",
};

const calWebhookHandler = async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);

  const rawBody = await req.text();
  const signatureOk = await verifySignature(rawBody, req.headers.get(SIGNATURE_HEADER));
  if (!signatureOk) {
    console.error("cal-webhook-receiver: signature verification failed");
    return jsonResponse({ error: "Invalid signature" }, 400);
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const triggerEvent: string | undefined = body?.triggerEvent;
  const status = triggerEvent ? TRIGGER_TO_STATUS[triggerEvent] : undefined;
  if (!status) {
    // Not an event we act on (e.g. a form-submitted or ping event) -- ack
    // and move on rather than erroring, since Cal.com may send event types
    // this integration doesn't need to handle.
    return jsonResponse({ ignored: true, triggerEvent: triggerEvent ?? null });
  }

  const payload = body?.payload ?? {};
  const candidateId = Number(payload?.metadata?.candidateId);
  const dealId = Number(payload?.metadata?.dealId);

  if (!candidateId || !dealId) {
    console.error("cal-webhook-receiver: missing candidateId/dealId metadata on booking", payload?.uid);
    return jsonResponse({ error: "Booking has no candidateId/dealId metadata -- can't correlate it to an Agent H record" }, 400);
  }

  // tenant_id/org_type must be set explicitly here -- there is no
  // auth.uid() to resolve them from (this write happens under service_role,
  // not a recruiter session), so the usual set_candidate_scores_tenant_defaults
  // trigger has nothing to look up. Resolve them from the deal instead.
  const dealRes = await serviceRestFetch(`deals?id=eq.${dealId}&select=id,tenant_id,org_type,sales_id`);
  if (!dealRes.ok) return jsonResponse({ error: "Failed to load role brief for tenant resolution" }, 502);
  const deal = (await dealRes.json())?.[0];
  if (!deal) return jsonResponse({ error: "Role brief not found" }, 404);

  const row = {
    deal_id: dealId,
    candidate_id: candidateId,
    tenant_id: deal.tenant_id,
    org_type: deal.org_type,
    recruiter_sales_id: deal.sales_id ?? null,
    status,
    cal_booking_uid: payload?.uid ?? null,
    scheduled_at: payload?.startTime ?? null,
    scheduled_end_at: payload?.endTime ?? null,
    candidate_timezone: payload?.attendees?.[0]?.timeZone ?? null,
    cancellation_reason: payload?.cancellationReason ?? null,
    raw_booking_payload: body,
    ...(status === "booked" || status === "rescheduled" ? { confirmation_sent_at: new Date().toISOString() } : {}),
  };

  const upsertRes = await serviceRestFetch(`interviews?on_conflict=deal_id,candidate_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });

  if (!upsertRes.ok) {
    const errorBody = await upsertRes.text();
    console.error("cal-webhook-receiver: upsert failed", upsertRes.status, errorBody);
    // 502 (not 400) -- this is a transient/our-side failure, worth a Cal.com retry.
    return jsonResponse({ error: "Failed to record booking update" }, 502);
  }

  if ((status === "booked" || status === "rescheduled") && payload?.attendees?.[0]?.email && payload?.startTime) {
    const attendeeEmail = payload.attendees[0].email;
    const attendeeName = payload.attendees[0].name ?? "there";
    const formattedTime = new Date(payload.startTime).toUTCString();
    await sendResendEmail(
      attendeeEmail,
      status === "rescheduled" ? "Your interview has been rescheduled" : "Your interview is confirmed",
      `<p>Hi ${attendeeName},</p><p>Your interview is confirmed for <strong>${formattedTime}</strong>.</p>`,
    );
  }

  return jsonResponse({ ok: true, status });
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  return calWebhookHandler(req);
});
