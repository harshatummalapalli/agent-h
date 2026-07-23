// Agent H, task 76: candidate outreach -- "please send your resume".
//
// Deliberately minimal: ONE templated email, recruiter-initiated, no
// threads/inbox (PRD Section 3 defers messaging-as-a-first-class-entity).
// The only clever part is the reply_to address: it encodes candidate_id and
// deal_id directly (candidate-<id>-deal-<id>@RESEND_RECEIVING_DOMAIN) so
// resend-inbound-reply can correlate the candidate's reply back to this
// exact request without fuzzy-matching by sender email, which may differ
// from whatever email is already on file for them.
//
// Required secrets:
//   RESEND_API_KEY            same key used by Stage 5's booking emails
//   RESEND_FROM_EMAIL          same sender used by Stage 5
//   RESEND_RECEIVING_DOMAIN    the Resend receiving domain, e.g.
//                              "abc123.resend.app" or a verified custom
//                              domain -- found under Resend > Emails >
//                              Receiving > "Receiving address"

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
      console.error("request-candidate-resume: Resend send failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("request-candidate-resume: Resend send threw", error);
    return false;
  }
}

const requestResumeHandler = async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);

  if (!RESEND_RECEIVING_DOMAIN) {
    return jsonResponse(
      { error: "Resume requests aren't configured yet -- RESEND_RECEIVING_DOMAIN must be set as an Edge Function secret first." },
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

  const [candidateRes, dealRes] = await Promise.all([
    restFetch(`candidates?id=eq.${candidateId}&select=id,first_name,last_name,email_jsonb,resume_status`, authHeader),
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
  const replyToAddress = `candidate-${candidateId}-deal-${dealId}@${RESEND_RECEIVING_DOMAIN}`;

  const emailSent = await sendResendEmail(
    candidateEmail,
    replyToAddress,
    `Quick ask -- could you send your resume?`,
    `<p>Hi ${candidateName},</p><p>We'd love to move forward with you for the <strong>${deal.name ?? "role"}</strong> role. Could you reply to this email with your resume attached?</p><p>Thanks!</p>`,
  );

  if (!emailSent) {
    return jsonResponse({ error: "Failed to send the resume request email" }, 502);
  }

  // Don't downgrade a candidate who already has a resume on file -- re-requesting
  // (e.g. to get an updated version) still sends the email but doesn't reset
  // resume_status away from "received".
  if (candidate.resume_status !== "received") {
    const patchRes = await restFetch(`candidates?id=eq.${candidateId}`, authHeader, {
      method: "PATCH",
      body: JSON.stringify({ resume_status: "requested", resume_requested_at: new Date().toISOString() }),
    });
    if (!patchRes.ok) {
      console.error("request-candidate-resume: failed to update resume_status", await patchRes.text());
    }
  }

  return jsonResponse({ email_sent: true, candidate_email: candidateEmail, resume_status: candidate.resume_status === "received" ? "received" : "requested" });
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  const authError = await requireAuth(req);
  if (authError) return authError;
  return requestResumeHandler(req);
});
