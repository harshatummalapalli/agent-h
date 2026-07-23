// Agent H, Stage 1: Outreach -- the bridge between "candidate sourced" and
// "actively being contacted" (see AGENT_H_HANDOFF_2026-07-21.md Section 7,
// "Outreach -- findings, not yet built"). A genuine third email flow
// alongside task 76's resume request and Stage 6's offer, with its own
// reply_to prefix (outreach-<id>-deal-<id>@RESEND_RECEIVING_DOMAIN) so
// resend-inbound-reply can tell all three apart with zero ambiguity.
//
// The one thing this flow does differently from its two siblings: the
// handoff explicitly rejects a hand-written fill-in-the-blank template
// ("the generic template Dover's own demo shows") in favor of a real
// drafting call grounded in this candidate's actual fit evidence
// (candidate_scores / candidate_fit_assessments). If neither exists yet
// for this candidate+deal (sourcing doesn't guarantee scoring has run) or
// ANTHROPIC_API_KEY isn't set, this falls back to a clearly-labeled
// generic-but-role-personalized template rather than failing the whole
// request -- see draftOutreachEmail below.
//
// Required secrets: same three as request-candidate-resume/send-offer
//   RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_RECEIVING_DOMAIN
// Plus (optional -- see draftOutreachEmail):
//   ANTHROPIC_API_KEY, ANTHROPIC_MODEL

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_JWT_ISSUER = Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`));

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL");
const RESEND_RECEIVING_DOMAIN = Deno.env.get("RESEND_RECEIVING_DOMAIN");

// Same Claude call shape as expandTitle in source-candidates-discovery/
// index.ts -- forced tool-use, same env vars, same model default.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

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
      console.error("send-first-outreach: Resend send failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("send-first-outreach: Resend send threw", error);
    return false;
  }
}

// Best-effort evidence lookup -- either or both of these may not exist yet
// for a given candidate+deal (sourcing doesn't guarantee scoring has run).
// Never throws; a failed fetch is treated the same as "no evidence yet".
async function fetchFitEvidence(candidateId: number, dealId: number, authHeader: string) {
  const [scoreRes, assessmentRes] = await Promise.all([
    restFetch(
      `candidate_scores?candidate_id=eq.${candidateId}&deal_id=eq.${dealId}&order=created_at.desc&limit=1&select=overall_score,verdict,dimension_scores,green_flags,watch_signals,recruiter_card,recommended_action,recommended_action_reasons`,
      authHeader,
    ).catch(() => null),
    restFetch(
      `candidate_fit_assessments?candidate_id=eq.${candidateId}&deal_id=eq.${dealId}&order=created_at.desc&limit=1&select=fit_bucket,summary,matches,worth_verifying,clear_gaps`,
      authHeader,
    ).catch(() => null),
  ]);

  const score = scoreRes?.ok ? (await scoreRes.json())?.[0] ?? null : null;
  const assessment = assessmentRes?.ok ? (await assessmentRes.json())?.[0] ?? null : null;
  return { score, assessment };
}

// Drafts the actual outreach email body. Grounds the message in 1-2
// SPECIFIC concrete details pulled from the candidate's fit evidence (a
// green_flag, a matches entry, a piece of the summary) -- deliberately
// NOT vague flattery ("your impressive background"), per the handoff's
// explicit rejection of a generic template. Falls back to a simple,
// clearly-labeled generic-but-role-personalized template when
// ANTHROPIC_API_KEY isn't set or the call fails, so a missing key never
// hard-fails the whole request.
async function draftOutreachEmail(
  candidateName: string,
  dealName: string,
  evidence: { score: any; assessment: any },
): Promise<{ subject: string; html: string; drafted_by: "claude" | "fallback_template" }> {
  const fallback = () => ({
    subject: `Interested in the ${dealName} role?`,
    html: `<p>Hi ${candidateName},</p><p>Your background caught our eye for the <strong>${dealName}</strong> role we're hiring for right now. Would you be open to a quick chat?</p><p>Thanks!</p>`,
    drafted_by: "fallback_template" as const,
  });

  if (!ANTHROPIC_API_KEY) return fallback();

  const evidenceLines: string[] = [];
  if (evidence.score) {
    if (Array.isArray(evidence.score.green_flags) && evidence.score.green_flags.length > 0) {
      evidenceLines.push(`Green flags: ${JSON.stringify(evidence.score.green_flags)}`);
    }
    if (evidence.score.verdict) evidenceLines.push(`Verdict: ${evidence.score.verdict}`);
    if (evidence.score.recommended_action) evidenceLines.push(`Recommended action: ${evidence.score.recommended_action}`);
  }
  if (evidence.assessment) {
    if (evidence.assessment.summary) evidenceLines.push(`Fit summary: ${evidence.assessment.summary}`);
    if (Array.isArray(evidence.assessment.matches) && evidence.assessment.matches.length > 0) {
      evidenceLines.push(`Matches: ${JSON.stringify(evidence.assessment.matches)}`);
    }
    if (evidence.assessment.fit_bucket) evidenceLines.push(`Fit bucket: ${evidence.assessment.fit_bucket}`);
  }

  if (evidenceLines.length === 0) return fallback();

  const DRAFT_TOOL = {
    name: "draft_outreach_email",
    description: "Draft a short, professional first-outreach recruiting email personalized with specific evidence about the candidate's fit for the role.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "A short, specific email subject line (no generic 'Exciting opportunity!' filler)." },
        body_html: {
          type: "string",
          description:
            "The email body as simple HTML (a few <p> tags, no inline styles). Professional, concise (4-6 sentences max), and grounded in 1-2 SPECIFIC concrete details from the provided evidence -- e.g. name an actual green flag or matched skill, not vague flattery like 'your impressive background'. Signs off inviting a reply.",
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
        tool_choice: { type: "tool", name: "draft_outreach_email" },
        messages: [
          {
            role: "user",
            content: `Draft a first-outreach recruiting email to a candidate named "${candidateName}" for the "${dealName}" role.

Fit evidence gathered on this candidate for this role:
${evidenceLines.join("\n")}

Ground the email in 1-2 of the SPECIFIC details above -- do not invent details not present here, and do not use vague flattery.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("send-first-outreach: Anthropic API error", response.status, await response.text());
      return fallback();
    }

    const result = await response.json();
    const toolUseBlock = result?.content?.find((block: any) => block.type === "tool_use");
    const subject = toolUseBlock?.input?.subject;
    const bodyHtml = toolUseBlock?.input?.body_html;
    if (typeof subject !== "string" || typeof bodyHtml !== "string" || !subject || !bodyHtml) {
      return fallback();
    }
    return { subject, html: bodyHtml, drafted_by: "claude" };
  } catch (error) {
    console.error("send-first-outreach: Anthropic call threw", error);
    return fallback();
  }
}

const sendFirstOutreachHandler = async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);

  if (!RESEND_RECEIVING_DOMAIN) {
    return jsonResponse(
      { error: "Outreach isn't configured yet -- RESEND_RECEIVING_DOMAIN must be set as an Edge Function secret first." },
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
  const dealName = deal.name ?? "this role";
  const replyToAddress = `outreach-${candidateId}-deal-${dealId}@${RESEND_RECEIVING_DOMAIN}`;

  const evidence = await fetchFitEvidence(candidateId, dealId, authHeader);
  const draft = await draftOutreachEmail(candidateName, dealName, evidence);

  const emailSent = await sendResendEmail(candidateEmail, replyToAddress, draft.subject, draft.html);
  if (!emailSent) {
    return jsonResponse({ error: "Failed to send the outreach email" }, 502);
  }

  const patchRes = await restFetch(`deal_candidates?deal_id=eq.${dealId}&candidate_id=eq.${candidateId}`, authHeader, {
    method: "PATCH",
    body: JSON.stringify({ response_status: "sent", contacted_at: new Date().toISOString() }),
  });
  if (!patchRes.ok) {
    console.error("send-first-outreach: failed to update response_status", patchRes.status, await patchRes.text());
    return jsonResponse({ error: "Outreach email sent, but failed to update this candidate's status" }, 502);
  }

  return jsonResponse({
    email_sent: true,
    candidate_email: candidateEmail,
    response_status: "sent",
    subject: draft.subject,
    body_html: draft.html,
    drafted_by: draft.drafted_by,
  });
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  const authError = await requireAuth(req);
  if (authError) return authError;
  return sendFirstOutreachHandler(req);
});
