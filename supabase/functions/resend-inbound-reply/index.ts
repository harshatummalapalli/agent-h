// Agent H: captures a candidate's reply to either a resume request (task 76)
// or an offer email (Stage 6). Called by Resend (not a recruiter session),
// so verify_jwt is OFF -- auth here is Svix HMAC signature verification
// against RESEND_WEBHOOK_SECRET, the same scheme Resend uses for all its
// webhooks. Do not copy the jose/JWT pattern from this project's other
// functions here.
//
// Correlation: request-candidate-resume sends outreach with a reply_to of
// candidate-<id>-deal-<id>@RESEND_RECEIVING_DOMAIN; send-offer (Stage 6)
// uses a distinct offer-<id>-deal-<id>@... prefix; send-first-outreach
// (Stage 1: Outreach) uses a third distinct outreach-<id>-deal-<id>@...
// prefix. This function reads whichever prefix matches out of the
// webhook's `to` field to know both WHICH kind of reply this is and which
// candidate/deal it belongs to -- no fuzzy email matching, no shared
// prefix between the three flows.
//
// Resend's webhook payload carries METADATA only (from/to/subject/attachment
// names) -- not the email body or attachment bytes. Both are fetched
// separately from Resend's API using RESEND_API_KEY: the body via the
// "retrieve received email" endpoint, attachment bytes (resume flow only)
// via a signed download_url from the "list attachments" endpoint.
//
// Stage 6 addition: an offer reply is captured as free text only
// (response_text/responded_at on public.offers) -- deliberately NOT
// classified into accepted/declined/negotiating by a model. The recruiter
// reads the reply and sets the final status themselves (see offers.status
// comment on the migration). responded_at/response_text update on every
// reply; status only auto-advances sent -> responded once, and is never
// downgraded by a later reply once a recruiter has manually set
// accepted/declined/negotiating.
//
// Stage 1: Outreach addition -- an outreach reply (send-first-outreach) is
// captured the same way as an offer reply: free text only
// (reply_text/responded_at on public.deal_candidates), status only ever
// auto-advances sent -> responded once, same "never downgrade a status
// already advanced" guard as the offer flow.
//
// Bugfix (2026-07-15): the first two live webhook calls both 500'd with no
// visible cause in the HTTP-summary logs. Root cause: verifySvixSignature's
// base64 decode of RESEND_WEBHOOK_SECRET (atob on the secret minus its
// "whsec_" prefix) ran with no try/catch -- any whitespace or copy-paste
// artifact in the pasted secret throws a DOMException there, which
// propagated as an uncaught exception (Deno's default 500), before this
// function's own error handling ever got a chance to log anything useful.
// Fixed by: trimming the secret, wrapping verification in try/catch with a
// clear console.error, AND wrapping the entire handler in a top-level
// try/catch so any future unexpected failure still returns a real error
// body and gets logged, instead of a silent generic 500.
//
// Required secrets:
//   RESEND_API_KEY              same key as request-candidate-resume/send-offer
//   RESEND_WEBHOOK_SECRET        the "whsec_..." signing secret from the
//                                 Resend webhook's details page
//   SUPABASE_SERVICE_ROLE_KEY    used to write regardless of RLS -- there is
//                                 no recruiter session in a webhook call

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET");

const AUTO_SCORE_ON_RESUME_RECEIVED = true;

const RESUME_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/rtf",
]);
const RESUME_FILENAME_PATTERN = /\.(pdf|docx?|rtf)$/i;

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
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

// Best-effort -- never let a logging failure affect the real response.
async function logDiagnostic(reason: string, details: Record<string, unknown>) {
  try {
    await serviceRestFetch(`events`, {
      method: "POST",
      body: JSON.stringify({
        tenant_id: null,
        org_type: "recruiting",
        entity_type: "debug",
        entity_id: 0,
        action: "resend_webhook_diag",
        payload: { reason, ...details, at: new Date().toISOString() },
      }),
    });
  } catch (error) {
    console.error("resend-inbound-reply: failed to write diagnostic event", error instanceof Error ? error.message : error);
  }
}

// Returns a result object (never throws) so the caller can log exactly what
// went wrong -- a malformed secret included -- instead of an opaque 500.
async function verifySvixSignature(
  id: string,
  timestamp: string,
  body: string,
  signatureHeader: string,
): Promise<{ ok: boolean; computed?: string; received?: string; secretByteLength?: number; error?: string }> {
  if (!RESEND_WEBHOOK_SECRET) {
    return { ok: false, error: "RESEND_WEBHOOK_SECRET is not set" };
  }
  try {
    const cleanedSecret = RESEND_WEBHOOK_SECRET.trim().replace(/^whsec_/, "");
    const secretBytes = base64ToBytes(cleanedSecret);
    const signedContent = `${id}.${timestamp}.${body}`;
    const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
    const computedB64 = bytesToBase64(new Uint8Array(sigBytes));
    const candidates = signatureHeader.split(" ").map((s) => s.split(",")[1]).filter(Boolean);
    return {
      ok: candidates.includes(computedB64),
      computed: computedB64,
      received: signatureHeader,
      secretByteLength: secretBytes.length,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Distinguishes a resume reply (candidate-<id>-deal-<id>@...) from an offer
// reply (offer-<id>-deal-<id>@...) -- two different prefixes, deliberately
// not sharing one pattern, so there's no ambiguity about which flow a given
// reply belongs to.
function parseReplyCorrelation(
  toAddresses: string[],
):
  | { kind: "resume"; candidateId: number; dealId: number }
  | { kind: "offer"; candidateId: number; dealId: number }
  | { kind: "outreach"; candidateId: number; dealId: number }
  | null {
  for (const addr of toAddresses ?? []) {
    const resumeMatch = addr.match(/candidate-(\d+)-deal-(\d+)@/);
    if (resumeMatch) return { kind: "resume", candidateId: Number(resumeMatch[1]), dealId: Number(resumeMatch[2]) };
    const offerMatch = addr.match(/offer-(\d+)-deal-(\d+)@/);
    if (offerMatch) return { kind: "offer", candidateId: Number(offerMatch[1]), dealId: Number(offerMatch[2]) };
    const outreachMatch = addr.match(/outreach-(\d+)-deal-(\d+)@/);
    if (outreachMatch) return { kind: "outreach", candidateId: Number(outreachMatch[1]), dealId: Number(outreachMatch[2]) };
  }
  return null;
}

async function handleResumeReply(emailId: string, candidateId: number, dealId: number) {
  const [emailRes, attachmentsRes, candidateRes] = await Promise.all([
    fetch(`https://api.resend.com/emails/receiving/${emailId}`, { headers: { Authorization: `Bearer ${RESEND_API_KEY}` } }),
    fetch(`https://api.resend.com/emails/receiving/${emailId}/attachments`, { headers: { Authorization: `Bearer ${RESEND_API_KEY}` } }),
    serviceRestFetch(`candidates?id=eq.${candidateId}&select=id,tenant_id,org_type`),
  ]);

  if (!emailRes.ok) {
    console.error("resend-inbound-reply: failed to fetch email content", emailRes.status, await emailRes.text());
    return jsonResponse({ error: "Failed to fetch email content from Resend" }, 502);
  }
  if (!candidateRes.ok) {
    console.error("resend-inbound-reply: failed to load candidate", candidateRes.status, await candidateRes.text());
    return jsonResponse({ error: "Failed to load candidate" }, 502);
  }

  const email = await emailRes.json();
  const candidate = (await candidateRes.json())?.[0];
  if (!candidate) return jsonResponse({ error: `Candidate ${candidateId} not found` }, 404);

  const attachmentsList = attachmentsRes.ok ? ((await attachmentsRes.json())?.data ?? []) : [];
  const resumeAttachment = attachmentsList.find(
    (a: any) => RESUME_CONTENT_TYPES.has(a.content_type) || RESUME_FILENAME_PATTERN.test(a.filename ?? ""),
  );

  const replyText: string | null = typeof email?.text === "string" ? email.text.slice(0, 2000) : null;

  let resumeCaptured = false;
  const patch: Record<string, unknown> = { resume_reply_text: replyText };

  if (resumeAttachment?.download_url) {
    try {
      const fileRes = await fetch(resumeAttachment.download_url);
      if (!fileRes.ok) throw new Error(`download failed: ${fileRes.status}`);
      const fileBytes = await fileRes.arrayBuffer();
      const storagePath = `${candidateId}/${Date.now()}-${resumeAttachment.filename}`;

      const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/resumes/${storagePath}`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY ?? "",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": resumeAttachment.content_type ?? "application/octet-stream",
        },
        body: fileBytes,
      });

      if (uploadRes.ok) {
        resumeCaptured = true;
        patch.resume_status = "received";
        patch.resume_storage_path = storagePath;
        patch.resume_original_filename = resumeAttachment.filename;
        patch.resume_received_at = new Date().toISOString();
      } else {
        console.error("resend-inbound-reply: storage upload failed", uploadRes.status, await uploadRes.text());
      }
    } catch (error) {
      console.error("resend-inbound-reply: attachment download/upload threw", error instanceof Error ? error.message : error);
    }
  }

  const patchRes = await serviceRestFetch(`candidates?id=eq.${candidateId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!patchRes.ok) {
    console.error("resend-inbound-reply: failed to update candidate", patchRes.status, await patchRes.text());
    return jsonResponse({ error: "Captured the reply, but failed to save it" }, 502);
  }

  const eventRes = await serviceRestFetch(`events`, {
    method: "POST",
    body: JSON.stringify({
      tenant_id: candidate.tenant_id,
      org_type: candidate.org_type,
      entity_type: "candidate",
      entity_id: candidateId,
      action: resumeCaptured ? "resume_received" : "resume_reply_received",
      payload: { deal_id: dealId, has_attachment: resumeCaptured, filename: resumeAttachment?.filename ?? null },
    }),
  });
  if (!eventRes.ok) {
    console.error("resend-inbound-reply: event log insert failed (non-fatal)", eventRes.status, await eventRes.text());
  }

  if (resumeCaptured && AUTO_SCORE_ON_RESUME_RECEIVED) {
    try {
      const scoreRes = await fetch(`${SUPABASE_URL}/functions/v1/score-candidate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_id: candidateId, deal_id: dealId }),
      });
      if (!scoreRes.ok) {
        console.error("resend-inbound-reply: auto-score call failed", scoreRes.status, await scoreRes.text());
      }
    } catch (error) {
      console.error("resend-inbound-reply: auto-score call threw", error instanceof Error ? error.message : error);
    }
  }

  return jsonResponse({ ok: true, kind: "resume", resume_captured: resumeCaptured });
}

// Stage 6: an offer reply. Captures response_text/responded_at always;
// only auto-advances status sent -> responded, and only via a
// status=eq.sent filter so a recruiter's own accepted/declined/negotiating
// call is never clobbered by a later reply on the same thread.
async function handleOfferReply(emailId: string, candidateId: number, dealId: number) {
  const emailRes = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
  });
  if (!emailRes.ok) {
    console.error("resend-inbound-reply: failed to fetch email content", emailRes.status, await emailRes.text());
    return jsonResponse({ error: "Failed to fetch email content from Resend" }, 502);
  }
  const email = await emailRes.json();
  const replyText: string | null = typeof email?.text === "string" ? email.text.slice(0, 2000) : null;

  const textPatchRes = await serviceRestFetch(`offers?deal_id=eq.${dealId}&candidate_id=eq.${candidateId}`, {
    method: "PATCH",
    body: JSON.stringify({ response_text: replyText, responded_at: new Date().toISOString() }),
  });
  if (!textPatchRes.ok) {
    console.error("resend-inbound-reply: failed to update offer reply text", textPatchRes.status, await textPatchRes.text());
    return jsonResponse({ error: "Captured the reply, but failed to save it" }, 502);
  }

  // Only flips status if it's still "sent" -- never downgrades a status a
  // recruiter has already set manually.
  const statusPatchRes = await serviceRestFetch(
    `offers?deal_id=eq.${dealId}&candidate_id=eq.${candidateId}&status=eq.sent`,
    { method: "PATCH", body: JSON.stringify({ status: "responded" }) },
  );
  if (!statusPatchRes.ok) {
    console.error("resend-inbound-reply: failed to advance offer status (non-fatal)", statusPatchRes.status, await statusPatchRes.text());
  }

  return jsonResponse({ ok: true, kind: "offer" });
}

// Stage 1: Outreach -- a reply to send-first-outreach's email. Modeled
// closely on handleOfferReply: captures reply_text/responded_at on
// public.deal_candidates (filtered by deal_id+candidate_id, the
// composite key for that table), then a second PATCH that only flips
// response_status from 'sent' to 'responded' -- never overwrites a
// status a recruiter or later logic may have already advanced.
async function handleOutreachReply(emailId: string, candidateId: number, dealId: number) {
  const emailRes = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
  });
  if (!emailRes.ok) {
    console.error("resend-inbound-reply: failed to fetch email content", emailRes.status, await emailRes.text());
    return jsonResponse({ error: "Failed to fetch email content from Resend" }, 502);
  }
  const email = await emailRes.json();
  const replyText: string | null = typeof email?.text === "string" ? email.text.slice(0, 2000) : null;

  const textPatchRes = await serviceRestFetch(`deal_candidates?deal_id=eq.${dealId}&candidate_id=eq.${candidateId}`, {
    method: "PATCH",
    body: JSON.stringify({ reply_text: replyText, responded_at: new Date().toISOString() }),
  });
  if (!textPatchRes.ok) {
    console.error("resend-inbound-reply: failed to update outreach reply text", textPatchRes.status, await textPatchRes.text());
    return jsonResponse({ error: "Captured the reply, but failed to save it" }, 502);
  }

  // Only flips response_status if it's still "sent" -- never downgrades a
  // status already advanced elsewhere.
  const statusPatchRes = await serviceRestFetch(
    `deal_candidates?deal_id=eq.${dealId}&candidate_id=eq.${candidateId}&response_status=eq.sent`,
    { method: "PATCH", body: JSON.stringify({ response_status: "responded" }) },
  );
  if (!statusPatchRes.ok) {
    console.error("resend-inbound-reply: failed to advance response_status (non-fatal)", statusPatchRes.status, await statusPatchRes.text());
  }

  return jsonResponse({ ok: true, kind: "outreach" });
}

const inboundReplyHandler = async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);

  const rawBody = await req.text();
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    await logDiagnostic("missing_headers", {
      hasId: !!svixId, hasTimestamp: !!svixTimestamp, hasSignature: !!svixSignature,
    });
    return jsonResponse({ error: "Missing Svix signature headers" }, 400);
  }
  const verification = await verifySvixSignature(svixId, svixTimestamp, rawBody, svixSignature);
  if (!verification.ok) {
    await logDiagnostic("signature_mismatch", {
      computed: verification.computed ?? null,
      received: verification.received ?? null,
      secretByteLength: verification.secretByteLength ?? null,
      verifyError: verification.error ?? null,
      bodyLength: rawBody.length,
    });
    return jsonResponse({ error: "Invalid signature" }, 400);
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (body?.type !== "email.received") {
    return jsonResponse({ ignored: true, type: body?.type ?? null });
  }

  const emailId: string | undefined = body?.data?.email_id;
  const toAddresses: string[] = body?.data?.to ?? [];
  const correlation = parseReplyCorrelation(toAddresses);
  if (!emailId || !correlation) {
    await logDiagnostic("correlation_failed", { emailId: emailId ?? null, toAddresses });
    return jsonResponse({ error: "Could not correlate this reply to a candidate/deal -- no matching address in 'to'" }, 400);
  }

  if (!RESEND_API_KEY) return jsonResponse({ error: "RESEND_API_KEY is not set" }, 500);

  if (correlation.kind === "resume") {
    return handleResumeReply(emailId, correlation.candidateId, correlation.dealId);
  }
  if (correlation.kind === "outreach") {
    return handleOutreachReply(emailId, correlation.candidateId, correlation.dealId);
  }
  return handleOfferReply(emailId, correlation.candidateId, correlation.dealId);
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  try {
    return await inboundReplyHandler(req);
  } catch (error) {
    console.error("resend-inbound-reply: unhandled exception", error instanceof Error ? (error.stack ?? error.message) : error);
    return jsonResponse({ error: "Internal error processing this webhook" }, 500);
  }
});
