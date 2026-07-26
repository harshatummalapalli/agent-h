// Agent H Unipile Phase 4: send first outreach (LinkedIn or email).
//
// Phase 4 refactor: accepts a `channel` param to route between:
//   email              — legacy Resend path (unchanged; default when channel absent)
//   linkedin_connection — Unipile POST /users/invite with ≤300-char note
//   linkedin_inmail     — Unipile POST /chats with inmail=true (open-profile)
//
// Human-in-the-loop contract (Phase C): this function ONLY sends the
// recruiter-approved message. The recruiter must call prepare-first-outreach,
// review/edit the preview, then explicitly approve before this runs.
//
// LinkedIn path requires: UNIPILE_API_KEY, UNIPILE_DSN
// Email path requires: RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_RECEIVING_DOMAIN

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getUserSaleFromRequest } from "../_shared/getUserSale.ts";
import {
  checkDailyCap,
  extractLinkedInSlug,
  fetchUnipileUserProfile,
  isUnipileConfigured,
  sendUnipileConnectionInvite,
  sendUnipileInMail,
} from "../_shared/unipileClient.ts";
import {
  jsonResponse,
  restFetch,
  sendResendEmail,
  serveCandidateFacingFunction,
} from "../_shared/candidateFacingEdge.ts";

const RESEND_RECEIVING_DOMAIN = Deno.env.get("RESEND_RECEIVING_DOMAIN");

type OutreachChannel = "email" | "linkedin_connection" | "linkedin_inmail";

const handler = async (req: Request) => {
  if (req.method !== "POST")
    return jsonResponse({ error: "Method Not Allowed" }, 405);

  let candidateId: number | undefined;
  let dealId: number | undefined;
  let channel: OutreachChannel = "email";
  let messagebody: string | undefined;
  let linkedinProviderId: string | undefined;
  let approvedSubject: string | undefined;
  let approvedHtml: string | undefined;
  // Dual-channel (B3): if also_send_email=true AND email fields present,
  // send email in parallel with the LinkedIn send.
  let alsoSendEmail = false;
  let emailTo: string | undefined;
  let emailSubject: string | undefined;
  let emailHtml: string | undefined;
  try {
    const body = await req.json();
    candidateId = body?.candidate_id;
    dealId = body?.deal_id;
    channel = body?.channel ?? "email";
    messagebody = body?.message_body;
    linkedinProviderId = body?.linkedin_provider_id;
    approvedSubject = body?.subject;
    approvedHtml = body?.html;
    alsoSendEmail = Boolean(body?.also_send_email);
    emailTo = body?.email_to;
    emailSubject = body?.email_subject;
    emailHtml = body?.email_html;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!candidateId || !dealId)
    return jsonResponse(
      { error: "candidate_id and deal_id are required" },
      400,
    );

  const authHeader = req.headers.get("authorization")!;

  // --- LinkedIn channels ---
  if (channel === "linkedin_connection" || channel === "linkedin_inmail") {
    if (!isUnipileConfigured()) {
      return jsonResponse(
        {
          error:
            "LinkedIn outreach isn't configured — UNIPILE_API_KEY and UNIPILE_DSN must be set.",
        },
        500,
      );
    }
    if (!messagebody)
      return jsonResponse(
        { error: "message_body is required for LinkedIn outreach" },
        400,
      );
    if (channel === "linkedin_connection" && messagebody.length > 300) {
      return jsonResponse(
        { error: "Connection note exceeds 300-character LinkedIn limit" },
        400,
      );
    }

    const sale = await getUserSaleFromRequest(req);
    if (!sale) return jsonResponse({ error: "Sales profile not found" }, 404);
    if (!sale.unipile_account_id) {
      return jsonResponse(
        {
          error:
            "No LinkedIn account connected — connect via your Profile page first.",
        },
        400,
      );
    }

    const candidateRes = await restFetch(
      `candidates?id=eq.${candidateId}&select=id,linkedin_url`,
      authHeader,
    );
    if (!candidateRes.ok)
      return jsonResponse({ error: "Failed to load candidate" }, 502);
    const candidate = (await candidateRes.json())?.[0];
    if (!candidate) return jsonResponse({ error: "Candidate not found" }, 404);

    const linkedInUrl: string | null = candidate.linkedin_url ?? null;
    if (!linkedInUrl) {
      return jsonResponse(
        { error: "This candidate has no LinkedIn URL on file" },
        400,
      );
    }

    const slug = extractLinkedInSlug(linkedInUrl);
    if (!slug) {
      return jsonResponse(
        { error: "Could not parse LinkedIn profile URL for this candidate" },
        400,
      );
    }

    try {
      const profile = await fetchUnipileUserProfile(
        sale.unipile_account_id as string,
        slug,
      );
      linkedinProviderId = profile.provider_id;
    } catch (err) {
      console.error(
        "send-first-outreach: failed to resolve LinkedIn provider_id",
        err,
      );
      return jsonResponse(
        {
          error:
            err instanceof Error
              ? err.message
              : "Failed to resolve LinkedIn profile for this candidate",
        },
        502,
      );
    }

    const capInfo = checkDailyCap(
      sale as {
        linkedin_daily_send_cap?: number | null;
        linkedin_sends_today?: number | null;
        linkedin_sends_reset_date?: string | null;
      },
    );
    if (!capInfo.can_send) {
      return jsonResponse(
        {
          error: `Daily LinkedIn send cap reached (${capInfo.cap}/day). Resets tomorrow.`,
        },
        429,
      );
    }

    try {
      if (channel === "linkedin_connection") {
        await sendUnipileConnectionInvite(
          sale.unipile_account_id as string,
          linkedinProviderId,
          messagebody,
        );
      } else {
        await sendUnipileInMail(
          sale.unipile_account_id as string,
          linkedinProviderId,
          messagebody,
        );
      }
    } catch (err) {
      console.error("send-first-outreach: Unipile send failed", err);
      return jsonResponse(
        { error: err instanceof Error ? err.message : "LinkedIn send failed" },
        502,
      );
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const newSendsToday = capInfo.sends_today + 1;
    await restFetch(`sales?id=eq.${(sale as { id: number }).id}`, authHeader, {
      method: "PATCH",
      body: JSON.stringify({
        linkedin_sends_today: newSendsToday,
        linkedin_sends_reset_date: todayStr,
      }),
    }).catch((err) =>
      console.warn(
        "send-first-outreach: failed to increment daily counter",
        err,
      ),
    );

    const now = new Date().toISOString();
    const dcPatch = await restFetch(
      `deal_candidates?deal_id=eq.${dealId}&candidate_id=eq.${candidateId}`,
      authHeader,
      {
        method: "PATCH",
        body: JSON.stringify({
          response_status: "sent",
          contacted_at: now,
          outreach_channel: channel,
          outreach_message_body: messagebody,
          outreach_sent_at: now,
          linkedin_provider_id: linkedinProviderId,
        }),
      },
    );
    if (!dcPatch.ok) {
      console.error(
        "send-first-outreach: failed to update deal_candidates",
        dcPatch.status,
        await dcPatch.text(),
      );
      return jsonResponse(
        {
          error: "LinkedIn message sent, but failed to update candidate status",
        },
        502,
      );
    }

    // Queue a follow-up stub (7 days) — cron processing is Phase 4 deferred
    const followUpType =
      channel === "linkedin_connection"
        ? "connection_reminder"
        : "inmail_follow_up";
    const scheduledFor = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const dcRow = await restFetch(
      `deal_candidates?deal_id=eq.${dealId}&candidate_id=eq.${candidateId}&select=id`,
      authHeader,
    )
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const dealCandidateId = dcRow?.[0]?.id;
    if (dealCandidateId) {
      await restFetch("linkedin_outreach_follow_ups", authHeader, {
        method: "POST",
        body: JSON.stringify({
          deal_candidate_id: dealCandidateId,
          scheduled_for: scheduledFor,
          follow_up_type: followUpType,
          status: "pending",
        }),
      }).catch((err) =>
        console.warn("send-first-outreach: failed to queue follow-up", err),
      );
    }

    // Dual-channel (B3): also send email when recruiter approved both
    let emailSent = false;
    if (
      alsoSendEmail &&
      emailTo &&
      emailSubject &&
      emailHtml &&
      RESEND_RECEIVING_DOMAIN
    ) {
      try {
        await sendResendEmail({
          to: emailTo,
          subject: emailSubject,
          html: emailHtml,
          logLabel: "send-first-outreach dual-channel",
        });
        emailSent = true;
      } catch (err) {
        // Non-blocking — LinkedIn was already sent; log and continue
        console.warn(
          "send-first-outreach: dual-channel email send failed",
          err,
        );
      }
    }

    return jsonResponse({
      sent: true,
      channel,
      linkedin_provider_id: linkedinProviderId,
      response_status: "sent",
      cap_remaining: Math.max(0, capInfo.cap_remaining - 1),
      email_sent: emailSent,
    });
  }

  // --- Email path (unchanged legacy behaviour) ---
  if (!RESEND_RECEIVING_DOMAIN) {
    return jsonResponse(
      {
        error:
          "Outreach isn't configured yet — RESEND_RECEIVING_DOMAIN must be set as an Edge Function secret first.",
      },
      500,
    );
  }

  const candidateRes = await restFetch(
    `candidates?id=eq.${candidateId}&select=id,first_name,last_name,email_jsonb`,
    authHeader,
  );
  const dealRes = await restFetch(
    `deals?id=eq.${dealId}&select=id,name`,
    authHeader,
  );
  if (!candidateRes.ok)
    return jsonResponse({ error: "Failed to load candidate" }, 502);
  if (!dealRes.ok)
    return jsonResponse({ error: "Failed to load role brief" }, 502);

  const candidate = (await candidateRes.json())?.[0];
  const deal = (await dealRes.json())?.[0];
  if (!candidate) return jsonResponse({ error: "Candidate not found" }, 404);
  if (!deal) return jsonResponse({ error: "Role brief not found" }, 404);

  const candidateEmail: string | null =
    candidate.email_jsonb?.[0]?.address ?? null;
  if (!candidateEmail) {
    return jsonResponse(
      {
        error:
          "This candidate has no email on file — run contact enrichment first.",
      },
      400,
    );
  }

  const candidateName =
    [candidate.first_name, candidate.last_name].filter(Boolean).join(" ") ||
    "there";
  const dealName = deal.name ?? "this role";
  const replyToAddress = `outreach-${candidateId}-deal-${dealId}@${RESEND_RECEIVING_DOMAIN}`;

  // Use approved preview when provided (Phase C path); fall back to inline drafting for direct callers.
  let subject = approvedSubject;
  let html = approvedHtml;
  let draftedBy: "approved" | "inline_fallback" = "approved";

  if (!subject || !html) {
    // Direct send without a prepare step — inline draft (legacy compatibility)
    const { subject: s, html: h } = await draftEmailInline(
      candidateName,
      dealName,
      candidateId,
      dealId,
      authHeader,
    );
    subject = s;
    html = h;
    draftedBy = "inline_fallback";
  }

  const emailSent = await sendResendEmail({
    to: candidateEmail,
    subject: subject!,
    html: html!,
    replyTo: replyToAddress,
    logLabel: "send-first-outreach",
  });
  if (!emailSent)
    return jsonResponse({ error: "Failed to send the outreach email" }, 502);

  const now = new Date().toISOString();
  const patchRes = await restFetch(
    `deal_candidates?deal_id=eq.${dealId}&candidate_id=eq.${candidateId}`,
    authHeader,
    {
      method: "PATCH",
      body: JSON.stringify({
        response_status: "sent",
        contacted_at: now,
        outreach_channel: "email",
        outreach_sent_at: now,
      }),
    },
  );
  if (!patchRes.ok) {
    console.error(
      "send-first-outreach: failed to update response_status",
      patchRes.status,
      await patchRes.text(),
    );
    return jsonResponse(
      { error: "Outreach email sent, but failed to update candidate status" },
      502,
    );
  }

  return jsonResponse({
    email_sent: true,
    channel: "email",
    candidate_email: candidateEmail,
    response_status: "sent",
    subject,
    drafted_by: draftedBy,
  });
};

// Inline email drafting for backward-compat direct callers (no prepare step).
// Mirrors the original send-first-outreach Claude draft logic.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

async function draftEmailInline(
  candidateName: string,
  dealName: string,
  candidateId: number,
  dealId: number,
  authHeader: string,
): Promise<{ subject: string; html: string }> {
  const fallback = () => ({
    subject: `Interested in the ${dealName} role?`,
    html: `<p>Hi ${candidateName},</p><p>Your background caught our eye for the <strong>${dealName}</strong> role. Would you be open to a quick chat?</p><p>Thanks!</p>`,
  });

  const [scoreRes, assessmentRes] = await Promise.all([
    restFetch(
      `candidate_scores?candidate_id=eq.${candidateId}&deal_id=eq.${dealId}&order=created_at.desc&limit=1&select=verdict,green_flags,recommended_action`,
      authHeader,
    ).catch(() => null),
    restFetch(
      `candidate_fit_assessments?candidate_id=eq.${candidateId}&deal_id=eq.${dealId}&order=created_at.desc&limit=1&select=fit_bucket,summary,matches`,
      authHeader,
    ).catch(() => null),
  ]);
  const score = scoreRes?.ok ? ((await scoreRes.json())?.[0] ?? null) : null;
  const assessment = assessmentRes?.ok
    ? ((await assessmentRes.json())?.[0] ?? null)
    : null;

  const lines: string[] = [];
  if (score?.green_flags?.length)
    lines.push(`Green flags: ${JSON.stringify(score.green_flags)}`);
  if (score?.verdict) lines.push(`Verdict: ${score.verdict}`);
  if (assessment?.summary) lines.push(`Fit summary: ${assessment.summary}`);
  if (assessment?.matches?.length)
    lines.push(`Matches: ${JSON.stringify(assessment.matches)}`);

  if (!ANTHROPIC_API_KEY || lines.length === 0) return fallback();

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 512,
        tools: [
          {
            name: "draft_outreach_email",
            description: "Draft a short outreach email.",
            input_schema: {
              type: "object",
              properties: {
                subject: { type: "string" },
                body_html: { type: "string" },
              },
              required: ["subject", "body_html"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "draft_outreach_email" },
        messages: [
          {
            role: "user",
            content: `Draft a first-outreach recruiting email to "${candidateName}" for the "${dealName}" role.\n\nFit evidence:\n${lines.join("\n")}\n\nGround in 1-2 specific details. 4-6 sentences max. No generic flattery.`,
          },
        ],
      }),
    });
    if (!response.ok) return fallback();
    const result = await response.json();
    const block = result?.content?.find(
      (b: Record<string, unknown>) => b.type === "tool_use",
    );
    const s = block?.input?.subject;
    const h = block?.input?.body_html;
    return typeof s === "string" && typeof h === "string" && s && h
      ? { subject: s, html: h }
      : fallback();
  } catch {
    return fallback();
  }
}

serveCandidateFacingFunction(handler);
