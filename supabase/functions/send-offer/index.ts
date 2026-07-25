// Agent H Stage 6: Offer -- send (Resend only after recruiter approval).
//
// Expects the recruiter-approved subject/html from prepare-offer (possibly
// edited). Validates reply_to against the candidate+deal pair, sends via
// Resend, then marks public.offers as 'sent'.
//
// Required secrets: RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_RECEIVING_DOMAIN

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  jsonResponse,
  restFetch,
  sendResendEmail,
  serveCandidateFacingFunction,
} from "../_shared/candidateFacingEdge.ts";
import { buildOfferReplyToAddress } from "../_shared/offerEmail.ts";

const RESEND_RECEIVING_DOMAIN = Deno.env.get("RESEND_RECEIVING_DOMAIN");

const sendOfferHandler = async (req: Request) => {
  if (req.method !== "POST")
    return jsonResponse({ error: "Method Not Allowed" }, 405);

  if (!RESEND_RECEIVING_DOMAIN) {
    return jsonResponse(
      {
        error:
          "Offers aren't configured yet -- RESEND_RECEIVING_DOMAIN must be set as an Edge Function secret first.",
      },
      500,
    );
  }

  let candidateId: number | undefined;
  let dealId: number | undefined;
  let subject: string | undefined;
  let html: string | undefined;
  try {
    const body = await req.json();
    candidateId = body?.candidate_id;
    dealId = body?.deal_id;
    subject = body?.subject;
    html = body?.html;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!candidateId || !dealId) {
    return jsonResponse(
      { error: "candidate_id and deal_id are required" },
      400,
    );
  }
  if (!subject?.trim() || !html?.trim()) {
    return jsonResponse(
      {
        error:
          "subject and html are required (use prepare-offer first, then approve the preview)",
      },
      400,
    );
  }

  const authHeader = req.headers.get("authorization")!;

  const [candidateRes, offerRes] = await Promise.all([
    restFetch(
      `candidates?id=eq.${candidateId}&select=id,first_name,last_name,email_jsonb`,
      authHeader,
    ),
    restFetch(
      `offers?deal_id=eq.${dealId}&candidate_id=eq.${candidateId}&select=*`,
      authHeader,
    ),
  ]);

  if (!candidateRes.ok)
    return jsonResponse({ error: "Failed to load candidate" }, 502);
  if (!offerRes.ok)
    return jsonResponse({ error: "Failed to load offer draft" }, 502);

  const candidate = (await candidateRes.json())?.[0];
  const offer = (await offerRes.json())?.[0];
  if (!candidate) {
    return jsonResponse(
      { error: "Candidate not found (or you don't have access to it)" },
      404,
    );
  }
  if (!offer) {
    return jsonResponse(
      {
        error:
          "No offer draft found for this candidate -- run prepare-offer first.",
      },
      400,
    );
  }
  if (offer.status !== "draft") {
    return jsonResponse(
      {
        error: `Offer is already ${offer.status} -- prepare a new draft before sending again.`,
      },
      400,
    );
  }

  const candidateEmail: string | null =
    candidate.email_jsonb?.[0]?.address ?? null;
  if (!candidateEmail) {
    return jsonResponse(
      {
        error:
          "This candidate has no email on file yet -- run contact enrichment first.",
      },
      400,
    );
  }

  const expectedReplyTo = buildOfferReplyToAddress(
    candidateId,
    dealId,
    RESEND_RECEIVING_DOMAIN,
  );

  const emailSent = await sendResendEmail({
    to: candidateEmail,
    replyTo: expectedReplyTo,
    subject: subject.trim(),
    html: html.trim(),
    logLabel: "send-offer",
  });

  if (!emailSent) {
    return jsonResponse({ error: "Failed to send the offer email" }, 502);
  }

  const patchRes = await restFetch(
    `offers?deal_id=eq.${dealId}&candidate_id=eq.${candidateId}`,
    authHeader,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: "sent",
        sent_at: new Date().toISOString(),
        position_title: offer.position_title,
      }),
    },
  );

  if (!patchRes.ok) {
    console.error(
      "send-offer: patch failed",
      patchRes.status,
      await patchRes.text(),
    );
    return jsonResponse(
      { error: "Offer email sent, but failed to update the offer record" },
      502,
    );
  }

  const saved = (await patchRes.json())?.[0];

  return jsonResponse({
    email_sent: true,
    candidate_email: candidateEmail,
    email_preview: {
      to: candidateEmail,
      reply_to: expectedReplyTo,
      subject: subject.trim(),
      html: html.trim(),
    },
    offer: saved,
  });
};

serveCandidateFacingFunction(sendOfferHandler);
