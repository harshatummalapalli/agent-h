// Agent H task 76: prepare resume request — draft email preview only.
// send via request-candidate-resume after recruiter approval (Phase C).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  jsonResponse,
  restFetch,
  serveCandidateFacingFunction,
} from "../_shared/candidateFacingEdge.ts";
import { buildResumeRequestEmailPreview } from "../_shared/resumeRequestEmail.ts";

const RESEND_RECEIVING_DOMAIN = Deno.env.get("RESEND_RECEIVING_DOMAIN");

const prepareRequestResumeHandler = async (req: Request) => {
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
  try {
    const body = await req.json();
    candidateId = body?.candidate_id;
    dealId = body?.deal_id;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!candidateId || !dealId) {
    return jsonResponse(
      { error: "candidate_id and deal_id are required" },
      400,
    );
  }

  const authHeader = req.headers.get("authorization")!;

  const [candidateRes, dealRes] = await Promise.all([
    restFetch(
      `candidates?id=eq.${candidateId}&select=id,first_name,last_name,email_jsonb,resume_status`,
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
        error: candidate.linkedin_url
          ? "This candidate has no email — use LinkedIn outreach instead (they have a LinkedIn URL)."
          : "This candidate has no email on file. Add an email via contact enrichment first, or use LinkedIn outreach if they have a LinkedIn URL.",
      },
      400,
    );
  }

  const candidateName =
    [candidate.first_name, candidate.last_name].filter(Boolean).join(" ") ||
    "there";

  const emailPreview = buildResumeRequestEmailPreview({
    candidateId,
    dealId,
    candidateName,
    candidateEmail,
    dealName: deal.name ?? null,
    receivingDomain: RESEND_RECEIVING_DOMAIN,
  });

  return jsonResponse({
    prepared: true,
    email_sent: false,
    candidate_email: candidateEmail,
    resume_status: candidate.resume_status,
    email_preview: emailPreview,
  });
};

serveCandidateFacingFunction(prepareRequestResumeHandler);
