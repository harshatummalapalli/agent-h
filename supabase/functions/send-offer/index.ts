// Agent H Stage 6: Offer -- create + send.
//
// Deliberately minimal, mirroring task 76's outreach pattern exactly: ONE
// templated email, recruiter-initiated, no threads/inbox (PRD Section 3
// defers messaging-as-a-first-class-entity). The reply_to address encodes
// candidate_id/deal_id (offer-<id>-deal-<id>@RESEND_RECEIVING_DOMAIN) --
// a distinct prefix from task 76's candidate-<id>-deal-<id>@... so
// resend-inbound-reply can tell an offer reply from a resume reply without
// any ambiguity.
//
// This function both creates AND sends in one step -- there is no separate
// "save draft" step in v1 (offers.status still has a 'draft' value reserved
// for that, unreachable from the UI today). Re-sending (e.g. revised terms)
// upserts the same row rather than creating a new one, same "current state"
// convention as candidate_scores/interviews.
//
// Required secrets: same three as request-candidate-resume
//   RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_RECEIVING_DOMAIN

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_JWT_ISSUER = Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`));

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL");
const RESEND_RECEIVING_DOMAIN = Deno.env.get("RESEND_RECEIVING_DOMAIN");

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

async function sendResendEmail(to: string, replyTo: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: [to], reply_to: [replyTo], subject, html }),
    });
    if (!res.ok) {
      console.error("send-offer: Resend send failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("send-offer: Resend send threw", error);
    return false;
  }
}

function formatCompensation(amount: number | null, currency: string, frequency: string): string | null {
  if (amount === null || amount === undefined) return null;
  const formattedAmount = new Intl.NumberFormat("en-US").format(amount);
  return `${currency} ${formattedAmount} / ${frequency}`;
}

const sendOfferHandler = async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);

  if (!RESEND_RECEIVING_DOMAIN) {
    return jsonResponse(
      { error: "Offers aren't configured yet -- RESEND_RECEIVING_DOMAIN must be set as an Edge Function secret first." },
      500,
    );
  }

  let candidateId: number | undefined;
  let dealId: number | undefined;
  let positionTitle: string | undefined;
  let compensationAmount: number | null | undefined;
  let compensationCurrency: string | undefined;
  let compensationFrequency: string | undefined;
  let startDate: string | null | undefined;
  let expiryDate: string | null | undefined;
  let benefitsSummary: string | null | undefined;
  try {
    const body = await req.json();
    candidateId = body?.candidate_id;
    dealId = body?.deal_id;
    positionTitle = body?.position_title;
    compensationAmount = body?.compensation_amount ?? null;
    compensationCurrency = body?.compensation_currency || "INR";
    compensationFrequency = body?.compensation_frequency || "annual";
    startDate = body?.start_date ?? null;
    expiryDate = body?.expiry_date ?? null;
    benefitsSummary = body?.benefits_summary ?? null;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!candidateId || !dealId) return jsonResponse({ error: "candidate_id and deal_id are required" }, 400);
  if (!positionTitle) return jsonResponse({ error: "position_title is required" }, 400);

  const authHeader = req.headers.get("authorization")!;

  const [candidateRes, dealRes] = await Promise.all([
    restFetch(`candidates?id=eq.${candidateId}&select=id,first_name,last_name,email_jsonb`, authHeader),
    restFetch(`deals?id=eq.${dealId}&select=id,name`, authHeader),
  ]);
  if (!candidateRes.ok) return jsonResponse({ error: "Failed to load candidate" }, 502);
  if (!dealRes.ok) return jsonResponse({ error: "Failed to load role brief" }, 502);

  const candidate = (await candidateRes.json())?.[0];
  const deal = (await dealRes.json())?.[0];
  if (!candidate) return jsonResponse({ error: "Candidate not found (or you don't have access to it)" }, 404);
  if (!deal) return jsonResponse({ error: "Role brief not found (or you don't have access to it)" }, 404);

  const candidateEmail: string | null = candidate.email_jsonb?.[0]?.address ?? null;
  if (!candidateEmail) {
    return jsonResponse(
      { error: "This candidate has no email on file yet -- run contact enrichment first." },
      400,
    );
  }

  const candidateName = [candidate.first_name, candidate.last_name].filter(Boolean).join(" ") || "there";
  const replyToAddress = `offer-${candidateId}-deal-${dealId}@${RESEND_RECEIVING_DOMAIN}`;
  const compensationLine = formatCompensation(compensationAmount ?? null, compensationCurrency!, compensationFrequency!);

  const bodyLines = [
    `<p>Hi ${candidateName},</p>`,
    `<p>We'd like to offer you the <strong>${positionTitle}</strong> role${deal.name ? ` (${deal.name})` : ""}.</p>`,
    "<ul>",
    compensationLine ? `<li>Compensation: ${compensationLine}</li>` : "",
    startDate ? `<li>Start date: ${startDate}</li>` : "",
    expiryDate ? `<li>This offer is valid until: ${expiryDate}</li>` : "",
    "</ul>",
    benefitsSummary ? `<p>${benefitsSummary}</p>` : "",
    "<p>Please reply to this email to let us know if you'd like to accept, decline, or discuss the terms further.</p>",
    "<p>Congratulations, and we look forward to hearing from you!</p>",
  ].filter(Boolean);

  const emailSent = await sendResendEmail(
    candidateEmail,
    replyToAddress,
    `Your offer for ${positionTitle}${deal.name ? ` at ${deal.name}` : ""}`,
    bodyLines.join(""),
  );

  if (!emailSent) {
    return jsonResponse({ error: "Failed to send the offer email" }, 502);
  }

  const row = {
    deal_id: dealId,
    candidate_id: candidateId,
    status: "sent",
    position_title: positionTitle,
    compensation_amount: compensationAmount,
    compensation_currency: compensationCurrency,
    compensation_frequency: compensationFrequency,
    start_date: startDate,
    expiry_date: expiryDate,
    benefits_summary: benefitsSummary,
    sent_at: new Date().toISOString(),
  };

  const upsertRes = await restFetch(`offers?on_conflict=deal_id,candidate_id`, authHeader, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });

  if (!upsertRes.ok) {
    console.error("send-offer: upsert failed", upsertRes.status, await upsertRes.text());
    return jsonResponse({ error: "Offer email sent, but failed to save the offer record" }, 502);
  }

  const saved = (await upsertRes.json())?.[0];

  return jsonResponse({
    email_sent: true,
    candidate_email: candidateEmail,
    offer: saved,
  });
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  const authError = await requireAuth(req);
  if (authError) return authError;
  return sendOfferHandler(req);
});
