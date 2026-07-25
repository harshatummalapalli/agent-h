// Agent H Stage 6: Offer -- prepare (draft only, no Resend call).
//
// Composes the offer email preview and upserts public.offers as status
// 'draft'. The recruiter must explicitly approve via send-offer before any
// candidate-facing email is sent (Phase C human-in-the-loop contract).
//
// Required secrets for preview reply_to: RESEND_RECEIVING_DOMAIN

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  jsonResponse,
  restFetch,
  serveCandidateFacingFunction,
} from "../_shared/candidateFacingEdge.ts";
import {
  buildOfferEmailPreview,
  type OfferTerms,
} from "../_shared/offerEmail.ts";

const RESEND_RECEIVING_DOMAIN = Deno.env.get("RESEND_RECEIVING_DOMAIN");

const prepareOfferHandler = async (req: Request) => {
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
  let terms: OfferTerms | undefined;
  try {
    const body = await req.json();
    candidateId = body?.candidate_id;
    dealId = body?.deal_id;
    terms = {
      position_title: body?.position_title,
      compensation_amount: body?.compensation_amount ?? null,
      compensation_currency: body?.compensation_currency || "INR",
      compensation_frequency: body?.compensation_frequency || "annual",
      start_date: body?.start_date ?? null,
      expiry_date: body?.expiry_date ?? null,
      benefits_summary: body?.benefits_summary ?? null,
    };
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!candidateId || !dealId) {
    return jsonResponse(
      { error: "candidate_id and deal_id are required" },
      400,
    );
  }
  if (!terms?.position_title) {
    return jsonResponse({ error: "position_title is required" }, 400);
  }

  const authHeader = req.headers.get("authorization")!;

  const [candidateRes, dealRes] = await Promise.all([
    restFetch(
      `candidates?id=eq.${candidateId}&select=id,first_name,last_name,email_jsonb`,
      authHeader,
    ),
    restFetch(`deals?id=eq.${dealId}&select=id,name`, authHeader),
  ]);
  if (!candidateRes.ok)
    return jsonResponse({ error: "Failed to load candidate" }, 502);
  if (!dealRes.ok)
    return jsonResponse({ error: "Failed to load role brief" }, 502);

  const candidate = (await candidateRes.json())?.[0];
  const deal = (await dealRes.json())?.[0];
  if (!candidate) {
    return jsonResponse(
      { error: "Candidate not found (or you don't have access to it)" },
      404,
    );
  }
  if (!deal) {
    return jsonResponse(
      { error: "Role brief not found (or you don't have access to it)" },
      404,
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

  const candidateName =
    [candidate.first_name, candidate.last_name].filter(Boolean).join(" ") ||
    "there";

  const emailPreview = buildOfferEmailPreview({
    candidateId,
    dealId,
    candidateName,
    candidateEmail,
    dealName: deal.name ?? null,
    receivingDomain: RESEND_RECEIVING_DOMAIN,
    terms,
  });

  const row = {
    deal_id: dealId,
    candidate_id: candidateId,
    status: "draft",
    position_title: terms.position_title,
    compensation_amount: terms.compensation_amount,
    compensation_currency: terms.compensation_currency,
    compensation_frequency: terms.compensation_frequency,
    start_date: terms.start_date,
    expiry_date: terms.expiry_date,
    benefits_summary: terms.benefits_summary,
    sent_at: null,
  };

  const upsertRes = await restFetch(
    `offers?on_conflict=deal_id,candidate_id`,
    authHeader,
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    },
  );

  if (!upsertRes.ok) {
    console.error(
      "prepare-offer: upsert failed",
      upsertRes.status,
      await upsertRes.text(),
    );
    return jsonResponse({ error: "Failed to save the offer draft" }, 502);
  }

  const saved = (await upsertRes.json())?.[0];

  return jsonResponse({
    prepared: true,
    email_sent: false,
    candidate_email: candidateEmail,
    email_preview: emailPreview,
    offer: saved,
  });
};

serveCandidateFacingFunction(prepareOfferHandler);
