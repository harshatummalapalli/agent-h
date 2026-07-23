// Agent H Stage 5: Scheduling -- generate a self-service candidate booking
// link.
//
// Agent H does not implement Google/Outlook OAuth itself (kickoff decision
// for this stage): recruiters connect their own calendar inside a
// self-hosted Cal.com instance (open source), and this function just builds
// a personalized link to that instance's booking page -- name/email
// pre-filled as query params, plus candidate_id/deal_id stashed in Cal.com's
// metadata prefill so the webhook receiver can correlate a booking back to
// the right Agent H row without guessing (see cal-webhook-receiver).
//
// If the candidate already has a live booking (status booked/rescheduled/
// completed), this returns that existing booking instead of generating a
// fresh link -- re-clicking "send booking link" on someone who already
// booked shouldn't silently reset their state.
//
// Required secrets (Project Settings > Edge Functions > Secrets):
//   CAL_BASE_URL        e.g. https://cal.yourdomain.com
//   CAL_EVENT_SLUG      the Cal.com event type slug to book (e.g. "screening-interview")
//   CAL_DEFAULT_USERNAME  fallback Cal.com username/team-slug when the
//                         owning recruiter has no sales.cal_username set
//   RESEND_API_KEY / RESEND_FROM_EMAIL  optional -- if unset, the link is
//                         still generated and returned, just not emailed
//                         (recruiter can copy/share it manually).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_JWT_ISSUER = Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`));

const CAL_BASE_URL = Deno.env.get("CAL_BASE_URL");
const CAL_EVENT_SLUG = Deno.env.get("CAL_EVENT_SLUG");
const CAL_DEFAULT_USERNAME = Deno.env.get("CAL_DEFAULT_USERNAME");

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST",
};

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });

async function requireAuth(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return jsonResponse({ error: "Missing authorization header" }, 401);
  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer" || !token) return jsonResponse({ error: "Invalid authorization header" }, 401);
  try {
    await jose.jwtVerify(token, SUPABASE_JWT_KEYS, { issuer: SUPABASE_JWT_ISSUER });
    return null;
  } catch {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
}

async function restFetch(path: string, authHeader: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_ANON_KEY ?? "",
      Authorization: authHeader,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

// Sends a single templated email via Resend. Duplicated (not shared) into
// cal-webhook-receiver too -- same rationale as this project's other
// Stage 3/4 functions: each caller is meant to evolve its own template
// independently, and Supabase edge functions deploy as standalone bundles.
async function sendResendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: [to], subject, html }),
    });
    if (!res.ok) {
      console.error("create-booking-link: Resend send failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("create-booking-link: Resend send threw", error);
    return false;
  }
}

const LIVE_STATUSES = new Set(["booked", "rescheduled", "completed"]);

const createBookingLinkHandler = async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);

  if (!CAL_BASE_URL || !CAL_EVENT_SLUG) {
    return jsonResponse(
      { error: "Scheduling isn't configured yet -- CAL_BASE_URL and CAL_EVENT_SLUG must be set as Edge Function secrets first." },
      500,
    );
  }

  let candidateId: number | undefined;
  let dealId: number | undefined;
  try {
    const body = await req.json();
    candidateId = body?.candidate_id;
    dealId = body?.deal_id;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!candidateId || !dealId) return jsonResponse({ error: "candidate_id and deal_id are required" }, 400);

  const authHeader = req.headers.get("authorization")!;

  const [candidateRes, dealRes, existingRes] = await Promise.all([
    restFetch(`candidates?id=eq.${candidateId}&select=id,first_name,last_name,email_jsonb`, authHeader),
    restFetch(`deals?id=eq.${dealId}&select=id,name,sales_id`, authHeader),
    restFetch(`interviews?candidate_id=eq.${candidateId}&deal_id=eq.${dealId}&select=*`, authHeader),
  ]);

  if (!candidateRes.ok) return jsonResponse({ error: "Failed to load candidate" }, 502);
  if (!dealRes.ok) return jsonResponse({ error: "Failed to load role brief" }, 502);
  if (!existingRes.ok) return jsonResponse({ error: "Failed to check existing booking state" }, 502);

  const candidate = (await candidateRes.json())?.[0];
  const deal = (await dealRes.json())?.[0];
  const existing = (await existingRes.json())?.[0];

  if (!candidate) return jsonResponse({ error: "Candidate not found (or you don't have access to it)" }, 404);
  if (!deal) return jsonResponse({ error: "Role brief not found (or you don't have access to it)" }, 404);

  // Already has a live booking -- don't regenerate/reset, just hand back
  // what's already known.
  if (existing && LIVE_STATUSES.has(existing.status)) {
    return jsonResponse({
      already_booked: true,
      status: existing.status,
      scheduled_at: existing.scheduled_at,
      scheduled_end_at: existing.scheduled_end_at,
      booking_link_url: existing.booking_link_url,
    });
  }

  let recruiterCalUsername: string | null = null;
  if (deal.sales_id) {
    const salesRes = await restFetch(`sales?id=eq.${deal.sales_id}&select=id,cal_username`, authHeader);
    if (salesRes.ok) {
      recruiterCalUsername = (await salesRes.json())?.[0]?.cal_username ?? null;
    }
  }
  const calUsername = recruiterCalUsername || CAL_DEFAULT_USERNAME;
  if (!calUsername) {
    return jsonResponse(
      { error: "No Cal.com username configured -- set CAL_DEFAULT_USERNAME, or set cal_username on the owning recruiter's sales row." },
      500,
    );
  }

  const candidateName = [candidate.first_name, candidate.last_name].filter(Boolean).join(" ") || "Candidate";
  const candidateEmail: string | null = candidate.email_jsonb?.[0]?.address ?? null;

  const linkParams = new URLSearchParams();
  linkParams.set("name", candidateName);
  if (candidateEmail) linkParams.set("email", candidateEmail);
  linkParams.set("metadata[candidateId]", String(candidateId));
  linkParams.set("metadata[dealId]", String(dealId));

  const bookingLinkUrl = `${CAL_BASE_URL.replace(/\/$/, "")}/${calUsername}/${CAL_EVENT_SLUG}?${linkParams.toString()}`;

  const row = {
    deal_id: dealId,
    candidate_id: candidateId,
    status: "link_sent",
    booking_link_url: bookingLinkUrl,
    cal_event_type_slug: CAL_EVENT_SLUG,
    recruiter_sales_id: deal.sales_id ?? null,
  };

  const upsertRes = await restFetch(`interviews?on_conflict=deal_id,candidate_id`, authHeader, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });

  if (!upsertRes.ok) {
    const errorBody = await upsertRes.text();
    console.error("create-booking-link: upsert failed", upsertRes.status, errorBody);
    return jsonResponse({ error: "Generated the link, but failed to save it" }, 502);
  }
  const saved = (await upsertRes.json())?.[0];

  let emailSent = false;
  if (candidateEmail) {
    emailSent = await sendResendEmail(
      candidateEmail,
      `Schedule your interview -- ${deal.name ?? "role"}`,
      `<p>Hi ${candidateName},</p><p>Please pick a time that works for you for your interview for <strong>${deal.name ?? "the role"}</strong>:</p><p><a href="${bookingLinkUrl}">${bookingLinkUrl}</a></p>`,
    );
  }

  return jsonResponse({
    already_booked: false,
    interview_id: saved?.id ?? null,
    status: "link_sent",
    booking_link_url: bookingLinkUrl,
    candidate_email: candidateEmail,
    email_sent: emailSent,
  });
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  const authError = await requireAuth(req);
  if (authError) return authError;
  return createBookingLinkHandler(req);
});
