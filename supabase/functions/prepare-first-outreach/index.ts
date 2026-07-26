// Agent H Unipile Phase 4: prepare first outreach (LinkedIn or email).
//
// Human-in-the-loop draft only — no message is sent here.
// The recruiter reviews and edits the proposed message in the UI before
// calling send-first-outreach with the approved body.
//
// Channel routing:
//   linkedin_url present + Unipile configured + account connected
//     → is_open_profile=true  → linkedin_inmail (free InMail, no char limit enforced)
//     → is_open_profile=false → linkedin_connection (≤300 chars enforced)
//   Otherwise → email (falls back to legacy Resend path)
//
// Required secrets: ANTHROPIC_API_KEY (optional, falls back), RESEND_RECEIVING_DOMAIN (email fallback)
// LinkedIn secrets: UNIPILE_API_KEY, UNIPILE_DSN

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getUserSaleFromRequest } from "../_shared/getUserSale.ts";
import {
  checkDailyCap,
  extractLinkedInSlug,
  fetchUnipileUserProfile,
  isUnipileConfigured,
} from "../_shared/unipileClient.ts";
import {
  jsonResponse,
  restFetch,
  serveCandidateFacingFunction,
} from "../_shared/candidateFacingEdge.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const RESEND_RECEIVING_DOMAIN = Deno.env.get("RESEND_RECEIVING_DOMAIN");

const CONNECTION_CHAR_LIMIT = 300;

type FitEvidence = {
  score: Record<string, unknown> | null;
  assessment: Record<string, unknown> | null;
};

async function fetchFitEvidence(
  candidateId: number,
  dealId: number,
  authHeader: string,
): Promise<FitEvidence> {
  const [scoreRes, assessmentRes] = await Promise.all([
    restFetch(
      `candidate_scores?candidate_id=eq.${candidateId}&deal_id=eq.${dealId}&order=created_at.desc&limit=1&select=overall_score,verdict,green_flags,watch_signals,recommended_action,recommended_action_reasons`,
      authHeader,
    ).catch(() => null),
    restFetch(
      `candidate_fit_assessments?candidate_id=eq.${candidateId}&deal_id=eq.${dealId}&order=created_at.desc&limit=1&select=fit_bucket,summary,matches,clear_gaps`,
      authHeader,
    ).catch(() => null),
  ]);
  const score = scoreRes?.ok ? ((await scoreRes.json())?.[0] ?? null) : null;
  const assessment = assessmentRes?.ok
    ? ((await assessmentRes.json())?.[0] ?? null)
    : null;
  return { score, assessment };
}

function buildEvidenceLines(evidence: FitEvidence): string[] {
  const lines: string[] = [];
  if (evidence.score) {
    const s = evidence.score as Record<string, unknown>;
    if (Array.isArray(s.green_flags) && s.green_flags.length > 0) {
      lines.push(`Green flags: ${JSON.stringify(s.green_flags)}`);
    }
    if (s.verdict) lines.push(`Verdict: ${s.verdict}`);
    if (s.recommended_action)
      lines.push(`Recommended action: ${s.recommended_action}`);
  }
  if (evidence.assessment) {
    const a = evidence.assessment as Record<string, unknown>;
    if (a.summary) lines.push(`Fit summary: ${a.summary}`);
    if (Array.isArray(a.matches) && a.matches.length > 0) {
      lines.push(`Matches: ${JSON.stringify(a.matches)}`);
    }
    if (a.fit_bucket) lines.push(`Fit bucket: ${a.fit_bucket}`);
  }
  return lines;
}

async function draftLinkedInMessage(
  candidateName: string,
  dealName: string,
  evidenceLines: string[],
  maxChars: number | null,
): Promise<{
  message_body: string;
  drafted_by: "claude" | "fallback_template";
}> {
  const charInstruction = maxChars
    ? `CRITICAL: The message MUST be ${maxChars} characters or fewer (LinkedIn connection note limit). Count carefully.`
    : "Keep it concise — 3-5 sentences maximum.";

  const fallbackBody = maxChars
    ? `Hi ${candidateName}, your background looks like a strong fit for the ${dealName} role I'm hiring for. Would love to connect!`
    : `Hi ${candidateName},\n\nYour profile caught my eye for the ${dealName} role we're actively hiring for. I'd love to share some details and hear your thoughts.\n\nLooking forward to connecting!`;

  const fallback = () => ({
    message_body: fallbackBody.slice(0, maxChars ?? undefined),
    drafted_by: "fallback_template" as const,
  });

  if (!ANTHROPIC_API_KEY || evidenceLines.length === 0) return fallback();

  const DRAFT_TOOL = {
    name: "draft_linkedin_message",
    description:
      "Draft a short LinkedIn outreach message personalized with specific evidence about the candidate's fit.",
    input_schema: {
      type: "object",
      properties: {
        message_body: {
          type: "string",
          description: maxChars
            ? `Plain text LinkedIn connection note. ${charInstruction} Ground it in 1-2 SPECIFIC details from the evidence. Professional, friendly, no generic filler.`
            : `Plain text LinkedIn InMail body. ${charInstruction} Ground it in 1-2 SPECIFIC details from the evidence. Professional, friendly, 3-5 sentences, sign off inviting a reply.`,
        },
      },
      required: ["message_body"],
    },
  };

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
        max_tokens: 256,
        tools: [DRAFT_TOOL],
        tool_choice: { type: "tool", name: "draft_linkedin_message" },
        messages: [
          {
            role: "user",
            content: `Draft a LinkedIn ${maxChars ? "connection note" : "InMail"} to "${candidateName}" for the "${dealName}" role.\n\nFit evidence:\n${evidenceLines.join("\n")}\n\n${charInstruction}`,
          },
        ],
      }),
    });

    if (!response.ok) return fallback();

    const result = await response.json();
    const toolBlock = result?.content?.find(
      (b: Record<string, unknown>) => b.type === "tool_use",
    );
    const body = toolBlock?.input?.message_body;
    if (typeof body !== "string" || !body) return fallback();

    // Hard-enforce char limit on the output
    return {
      message_body: maxChars ? body.slice(0, maxChars) : body,
      drafted_by: "claude",
    };
  } catch {
    return fallback();
  }
}

async function draftEmailFallback(
  candidateName: string,
  dealName: string,
  evidenceLines: string[],
): Promise<{
  subject: string;
  html: string;
  drafted_by: "claude" | "fallback_template";
}> {
  const fallback = () => ({
    subject: `Interested in the ${dealName} role?`,
    html: `<p>Hi ${candidateName},</p><p>Your background caught our eye for the <strong>${dealName}</strong> role. Would you be open to a quick chat?</p><p>Thanks!</p>`,
    drafted_by: "fallback_template" as const,
  });

  if (!ANTHROPIC_API_KEY || evidenceLines.length === 0) return fallback();

  const DRAFT_TOOL = {
    name: "draft_email",
    description: "Draft a short outreach email.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string" },
        body_html: {
          type: "string",
          description:
            "Simple HTML, 4-6 sentences max, grounded in 1-2 specific evidence details.",
        },
      },
      required: ["subject", "body_html"],
    },
  };

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
        tools: [DRAFT_TOOL],
        tool_choice: { type: "tool", name: "draft_email" },
        messages: [
          {
            role: "user",
            content: `Draft first-outreach recruiting email to "${candidateName}" for the "${dealName}" role.\n\nFit evidence:\n${evidenceLines.join("\n")}\n\nGround the email in 1-2 specific details. No generic flattery.`,
          },
        ],
      }),
    });
    if (!response.ok) return fallback();
    const result = await response.json();
    const block = result?.content?.find(
      (b: Record<string, unknown>) => b.type === "tool_use",
    );
    const subject = block?.input?.subject;
    const bodyHtml = block?.input?.body_html;
    if (
      typeof subject !== "string" ||
      typeof bodyHtml !== "string" ||
      !subject ||
      !bodyHtml
    )
      return fallback();
    return { subject, html: bodyHtml, drafted_by: "claude" };
  } catch {
    return fallback();
  }
}

const handler = async (req: Request) => {
  if (req.method !== "POST")
    return jsonResponse({ error: "Method Not Allowed" }, 405);

  let candidateId: number | undefined;
  let dealId: number | undefined;
  try {
    const body = await req.json();
    candidateId = body?.candidate_id;
    dealId = body?.deal_id;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!candidateId || !dealId)
    return jsonResponse(
      { error: "candidate_id and deal_id are required" },
      400,
    );

  const authHeader = req.headers.get("authorization")!;

  const [candidateRes, dealRes] = await Promise.all([
    restFetch(
      `candidates?id=eq.${candidateId}&select=id,first_name,last_name,email_jsonb,linkedin_url`,
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
  if (!candidate) return jsonResponse({ error: "Candidate not found" }, 404);
  if (!deal) return jsonResponse({ error: "Role brief not found" }, 404);

  const candidateName =
    [candidate.first_name, candidate.last_name].filter(Boolean).join(" ") ||
    "there";
  const dealName = deal.name ?? "this role";
  const linkedInUrl: string | null = candidate.linkedin_url ?? null;
  const candidateEmail: string | null =
    candidate.email_jsonb?.[0]?.address ?? null;

  const evidence = await fetchFitEvidence(candidateId, dealId, authHeader);
  const evidenceLines = buildEvidenceLines(evidence);

  // Try LinkedIn path when URL is present and Unipile is configured
  if (linkedInUrl && isUnipileConfigured()) {
    const sale = await getUserSaleFromRequest(req);

    if (
      sale?.unipile_account_id &&
      (sale as Record<string, unknown>).unipile_account_status === "connected"
    ) {
      const slug = extractLinkedInSlug(linkedInUrl);
      if (slug) {
        // Check daily cap before doing the Unipile profile fetch (fast-fail)
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
          const profile = await fetchUnipileUserProfile(
            sale.unipile_account_id as string,
            slug,
          );
          const channel = profile.is_open_profile
            ? "linkedin_inmail"
            : "linkedin_connection";
          const maxChars =
            channel === "linkedin_connection" ? CONNECTION_CHAR_LIMIT : null;
          const draft = await draftLinkedInMessage(
            candidateName,
            dealName,
            evidenceLines,
            maxChars,
          );

          // Dual-channel (B3): also draft email when candidate has one —
          // recruiter can approve sending both LinkedIn + email in parallel.
          let emailDraft: { subject: string; html: string } | null = null;
          if (candidateEmail && RESEND_RECEIVING_DOMAIN) {
            try {
              emailDraft = await draftEmailFallback(
                candidateName,
                dealName,
                evidenceLines,
              );
            } catch {
              // non-blocking — LinkedIn draft is already ready
            }
          }

          return jsonResponse({
            channel,
            linkedin_provider_id: profile.provider_id,
            message_body: draft.message_body,
            char_count: draft.message_body.length,
            is_open_profile: profile.is_open_profile ?? false,
            cap_remaining: capInfo.cap_remaining,
            drafted_by: draft.drafted_by,
            email_preview: emailDraft
              ? {
                  to: candidateEmail,
                  subject: emailDraft.subject,
                  html: emailDraft.html,
                }
              : null,
            // dual_channel signals the UI to show both LinkedIn + email panels
            dual_channel: emailDraft !== null,
          });
        } catch (err) {
          // Profile fetch failure → fall through to email path with a note
          console.warn(
            "prepare-first-outreach: Unipile profile fetch failed, falling back to email",
            err,
          );
        }
      }
    }
  }

  // Email fallback path
  if (!candidateEmail) {
    return jsonResponse(
      {
        error:
          "This candidate has no email and LinkedIn outreach is unavailable. Add contact details first.",
      },
      400,
    );
  }

  if (!RESEND_RECEIVING_DOMAIN) {
    return jsonResponse(
      {
        error:
          "Email outreach isn't configured on this server yet. Ask your admin to add email outreach secrets in Supabase Edge Function settings.",
      },
      500,
    );
  }

  const emailDraft = await draftEmailFallback(
    candidateName,
    dealName,
    evidenceLines,
  );
  const replyTo = `outreach-${candidateId}-deal-${dealId}@${RESEND_RECEIVING_DOMAIN}`;

  return jsonResponse({
    channel: "email",
    linkedin_provider_id: null,
    message_body: null,
    char_count: null,
    is_open_profile: null,
    cap_remaining: null,
    drafted_by: emailDraft.drafted_by,
    email_preview: {
      to: candidateEmail,
      reply_to: replyTo,
      subject: emailDraft.subject,
      html: emailDraft.html,
    },
  });
};

serveCandidateFacingFunction(handler);
