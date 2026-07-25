// Agent H task 76: send resume request — Resend only after recruiter approval.
// Call prepare-request-resume first for the editable email preview.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  jsonResponse,
  restFetch,
  sendResendEmail,
  serveCandidateFacingFunction,
} from "../_shared/candidateFacingEdge.ts";
import { buildResumeRequestReplyTo } from "../_shared/resumeRequestEmail.ts";

const RESEND_RECEIVING_DOMAIN = Deno.env.get("RESEND_RECEIVING_DOMAIN");

const sendRequestResumeHandler = async (req: Request) => {
  if (req.method !== "POST")
    return jsonResponse({ error: "Method Not Allowed" }, 405);

  if (!RESEND_RECEIVING_DOMAIN) {
    return jsonResponse(
      {
        error:
          "Resume requests aren't configured yet -- RESEND_RECEIVING_DOMAIN must be set as an Edge Function secret first.",
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
          "subject and html are required (use prepare-request-resume first, then approve the preview)",
      },
      400,
    );
  }

  const authHeader = req.headers.get("authorization")!;

  const candidateRes = await restFetch(
    `candidates?id=eq.${candidateId}&select=id,first_name,last_name,email_jsonb,resume_status`,
    authHeader,
  );
  if (!candidateRes.ok)
    return jsonResponse({ error: "Failed to load candidate" }, 502);

  const candidate = (await candidateRes.json())?.[0];
  if (!candidate) {
    return jsonResponse(
      { error: "Candidate not found (or you don't have access to it)" },
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

  const expectedReplyTo = buildResumeRequestReplyTo(
    candidateId,
    dealId,
    RESEND_RECEIVING_DOMAIN,
  );

  const emailSent = await sendResendEmail({
    to: candidateEmail,
    replyTo: expectedReplyTo,
    subject: subject.trim(),
    html: html.trim(),
    logLabel: "request-candidate-resume",
  });

  if (!emailSent) {
    return jsonResponse(
      { error: "Failed to send the resume request email" },
      502,
    );
  }

  let resumeStatus = candidate.resume_status;
  if (candidate.resume_status !== "received") {
    const patchRes = await restFetch(
      `candidates?id=eq.${candidateId}`,
      authHeader,
      {
        method: "PATCH",
        body: JSON.stringify({
          resume_status: "requested",
          resume_requested_at: new Date().toISOString(),
        }),
      },
    );
    if (!patchRes.ok) {
      console.error(
        "request-candidate-resume: failed to update resume_status",
        await patchRes.text(),
      );
    } else {
      resumeStatus = "requested";
    }
  }

  return jsonResponse({
    email_sent: true,
    candidate_email: candidateEmail,
    resume_status: resumeStatus,
    email_preview: {
      to: candidateEmail,
      reply_to: expectedReplyTo,
      subject: subject.trim(),
      html: html.trim(),
    },
  });
};

serveCandidateFacingFunction(sendRequestResumeHandler);
