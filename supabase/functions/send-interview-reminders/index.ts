// Agent H Stage 5: Scheduling -- day-before reminder sweep.
//
// Not called by the frontend. Meant to be invoked on a schedule (once
// Harsha has a real Cal.com instance producing real bookings to remind
// people about -- wiring the actual schedule, e.g. Supabase's pg_cron +
// pg_net, or an n8n cron job once that host exists for the Sourcing stage,
// is a one-line follow-up once there's something real to test it against;
// deliberately not wired blind against zero live bookings).
//
// verify_jwt is OFF because this is meant to be invoked by a scheduler with
// a service-role bearer token, not a recruiter session -- callers must pass
// `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` themselves; this
// function checks for that explicitly since disabling platform JWT
// verification alone would otherwise leave it fully open.
//
// Picks up any interview that is booked (or rescheduled), starts within the
// next REMINDER_WINDOW_HOURS, and has not already had a reminder sent --
// sends one email, then stamps reminder_sent_at so the same booking is
// never reminded twice by a later run of this same sweep.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL");

// Wide-ish window (not exactly 24h) so an hourly sweep can't miss a booking
// that falls between two runs.
const REMINDER_WINDOW_HOURS = 26;

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

function requireServiceAuth(req: Request): Response | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return jsonResponse({ error: "Unauthorized -- this endpoint is for scheduled service calls only" }, 401);
  }
  return null;
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

// Duplicated from create-booking-link / cal-webhook-receiver deliberately --
// see create-booking-link's header comment for why.
async function sendResendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: [to], subject, html }),
    });
    if (!res.ok) {
      console.error("send-interview-reminders: Resend send failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("send-interview-reminders: Resend send threw", error);
    return false;
  }
}

const sendRemindersHandler = async () => {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 60 * 60 * 1000);

  const dueRes = await serviceRestFetch(
    `interviews?status=in.(booked,rescheduled)&reminder_sent_at=is.null&scheduled_at=gte.${now.toISOString()}&scheduled_at=lte.${windowEnd.toISOString()}&select=id,deal_id,candidate_id,scheduled_at`,
  );
  if (!dueRes.ok) {
    const errorBody = await dueRes.text();
    console.error("send-interview-reminders: failed to query due interviews", dueRes.status, errorBody);
    return jsonResponse({ error: "Failed to query due interviews" }, 502);
  }
  const due = (await dueRes.json()) as Array<{ id: number; deal_id: number; candidate_id: number; scheduled_at: string }>;

  let sent = 0;
  let skippedNoEmail = 0;
  const failures: number[] = [];

  for (const interview of due) {
    const [candidateRes, dealRes] = await Promise.all([
      serviceRestFetch(`candidates?id=eq.${interview.candidate_id}&select=first_name,email_jsonb`),
      serviceRestFetch(`deals?id=eq.${interview.deal_id}&select=name`),
    ]);
    const candidate = candidateRes.ok ? (await candidateRes.json())?.[0] : null;
    const deal = dealRes.ok ? (await dealRes.json())?.[0] : null;
    const email: string | null = candidate?.email_jsonb?.[0]?.address ?? null;

    if (!email) {
      skippedNoEmail += 1;
      continue;
    }

    const formattedTime = new Date(interview.scheduled_at).toUTCString();
    const ok = await sendResendEmail(
      email,
      `Reminder: your interview for ${deal?.name ?? "the role"} is coming up`,
      `<p>Hi ${candidate?.first_name ?? "there"},</p><p>Quick reminder -- your interview for <strong>${deal?.name ?? "the role"}</strong> is scheduled for <strong>${formattedTime}</strong>.</p>`,
    );

    if (!ok) {
      failures.push(interview.id);
      continue;
    }

    const patchRes = await serviceRestFetch(`interviews?id=eq.${interview.id}`, {
      method: "PATCH",
      body: JSON.stringify({ reminder_sent_at: new Date().toISOString() }),
    });
    if (!patchRes.ok) {
      console.error("send-interview-reminders: failed to stamp reminder_sent_at", interview.id, await patchRes.text());
      failures.push(interview.id);
      continue;
    }
    sent += 1;
  }

  return jsonResponse({ checked: due.length, sent, skipped_no_email: skippedNoEmail, failed: failures });
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);
  const authError = requireServiceAuth(req);
  if (authError) return authError;
  return sendRemindersHandler();
});
