// See docs/adr/ADR-617f-phase-c-human-in-the-loop-approval.md

import type { QueryClient } from "@tanstack/react-query";
import type { Identifier } from "ra-core";
import type { CrmDataProvider } from "../providers/types";
import type { Deal, RoleConversationTurn } from "../types";
import {
  type ConversationTurnMetadata,
  getActionTier,
  isLeavesPlatformAction,
} from "./agentActionTiers";

type ParsedCommand = Awaited<ReturnType<CrmDataProvider["parseAgentCommand"]>>;

export type ParseCandidateRef = { id: number; name: string };

export type RoleAgentOrchestratorDeps = {
  dealId: string;
  deal: Deal | undefined;
  openDeals: Deal[];
  dataProvider: CrmDataProvider;
  queryClient: QueryClient;
  navigate: (path: string) => void;
  invalidateTranscript: () => void;
  pipelineCandidates?: ParseCandidateRef[];
  selectedCandidates?: ParseCandidateRef[];
};

function turnIdempotencyKey(dealId: string, suffix: string) {
  return `${dealId}:${suffix}:${crypto.randomUUID()}`;
}

function resolveCandidateId(
  parsed: ParsedCommand,
  selectedCandidates: ParseCandidateRef[],
): number | null {
  if (parsed.candidate_id != null) return parsed.candidate_id;
  if (parsed.use_selected_candidates && selectedCandidates.length === 1) {
    return selectedCandidates[0].id;
  }
  return null;
}

async function appendRecruiterTurn(
  deps: RoleAgentOrchestratorDeps,
  content: string,
  metadata: ConversationTurnMetadata,
  inReplyTo?: Identifier | null,
): Promise<RoleConversationTurn> {
  return (await deps.dataProvider.createRoleConversationTurn(deps.dealId, {
    content,
    metadata,
    in_reply_to: inReplyTo ?? null,
    idempotency_key: turnIdempotencyKey(deps.dealId, "recruiter"),
  })) as RoleConversationTurn;
}

async function appendAgentTurn(
  deps: RoleAgentOrchestratorDeps,
  content: string,
  metadata: ConversationTurnMetadata,
  inReplyTo?: Identifier | null,
): Promise<RoleConversationTurn> {
  return (await deps.dataProvider.appendAgentConversationTurn(deps.dealId, {
    content,
    metadata,
    in_reply_to: inReplyTo ?? null,
    idempotency_key: turnIdempotencyKey(deps.dealId, "agent"),
  })) as RoleConversationTurn;
}

async function executeReversibleOrRead(
  deps: RoleAgentOrchestratorDeps,
  parsed: ParsedCommand,
): Promise<{ summary: string; undo?: ConversationTurnMetadata["undo"] }> {
  if (parsed.action === "create_role") {
    deps.navigate("/");
    return { summary: parsed.explanation };
  }

  if (parsed.action === "show_roles") {
    deps.navigate("/deals");
    return { summary: parsed.explanation };
  }

  if (parsed.action === "show_candidates" && parsed.deal_id != null) {
    deps.navigate(`/roles/${parsed.deal_id}`);
    return { summary: parsed.explanation };
  }

  if (parsed.action === "continue_sourcing" && parsed.deal_id != null) {
    const result = await deps.dataProvider.continueSourcingForDeal(
      parsed.deal_id,
    );
    deps.queryClient.invalidateQueries({ queryKey: ["deals", deps.dealId] });
    deps.queryClient.invalidateQueries({ queryKey: ["deal_candidates"] });
    const filteredNote =
      result.filteredCount > 0
        ? `, ${result.filteredCount} filtered as not relevant`
        : "";
    // TASK-003: append candidate cards after sourcing so recruiter sees them inline.
    if (result.savedCandidates.length > 0) {
      void appendCandidateCardTurns(
        deps,
        result.savedCandidates.map((c) => ({
          id: c.id,
          first_name: c.fullName.split(" ")[0] ?? null,
          last_name: c.fullName.split(" ").slice(1).join(" ") || null,
          job_title: c.title,
          job_company_name: c.company,
          linkedin_url: null,
          match_score: null,
        })),
      );
    }
    return {
      summary: `Found ${result.foundCount}, saved ${result.savedCount} new candidates${filteredNote}.`,
    };
  }

  if (parsed.action === "relax_criterion" && parsed.criterion_id != null) {
    await deps.dataProvider.relaxLearnedCriterion(parsed.criterion_id);
    deps.queryClient.invalidateQueries({
      queryKey: ["inbox_per_deal_signals"],
    });
    return {
      summary: parsed.explanation,
      undo: {
        action: "note_only",
        params: { criterion_id: parsed.criterion_id },
      },
    };
  }

  if (parsed.action === "unknown") {
    return { summary: parsed.explanation };
  }

  return {
    summary:
      parsed.explanation ||
      "I understood the request but can't run that action in this context yet.",
  };
}

async function buildTier3ProposalMetadata(
  deps: RoleAgentOrchestratorDeps,
  parsed: ParsedCommand,
): Promise<ConversationTurnMetadata> {
  const selectedCandidates = deps.selectedCandidates ?? [];
  const candidateId = resolveCandidateId(parsed, selectedCandidates);
  const dealId = (parsed.deal_id as number | undefined) ?? Number(deps.dealId);

  const params: Record<string, unknown> = {
    deal_id: dealId,
    criterion_id: parsed.criterion_id,
    use_selected_candidates: parsed.use_selected_candidates,
    candidate_id: candidateId,
  };

  const base: ConversationTurnMetadata = {
    kind: "proposal",
    tier: "leaves_platform",
    action: parsed.action,
    status: "pending",
    explanation: parsed.explanation,
    params,
  };

  if (parsed.action === "request_resume" && candidateId && dealId) {
    try {
      const result = await deps.dataProvider.prepareRequestResume(
        candidateId,
        dealId,
      );
      return {
        ...base,
        email_preview:
          result.email_preview as ConversationTurnMetadata["email_preview"],
      };
    } catch (error) {
      return {
        ...base,
        explanation: `${parsed.explanation} (${error instanceof Error ? error.message : "Couldn't prepare the email preview"})`,
      };
    }
  }

  if (parsed.action === "send_first_outreach" && candidateId && dealId) {
    try {
      const result = await deps.dataProvider.prepareFirstOutreach(
        candidateId,
        dealId,
      );
      if (result.channel === "email" && result.email_preview) {
        return {
          ...base,
          email_preview:
            result.email_preview as ConversationTurnMetadata["email_preview"],
        };
      }
      if (
        (result.channel === "linkedin_connection" ||
          result.channel === "linkedin_inmail") &&
        result.message_body &&
        result.linkedin_provider_id
      ) {
        return {
          ...base,
          linkedin_preview: {
            channel: result.channel,
            message_body: result.message_body,
            char_count: result.char_count ?? result.message_body.length,
            is_open_profile: result.is_open_profile ?? false,
            linkedin_provider_id: result.linkedin_provider_id,
            cap_remaining: result.cap_remaining ?? undefined,
            drafted_by: result.drafted_by,
          } as ConversationTurnMetadata["linkedin_preview"],
        };
      }
      return base;
    } catch (error) {
      return {
        ...base,
        explanation: `${parsed.explanation} (${error instanceof Error ? error.message : "Couldn't prepare the outreach preview"})`,
      };
    }
  }

  if (isLeavesPlatformAction(parsed.action) && !candidateId) {
    return {
      ...base,
      explanation: `${parsed.explanation} (Select a candidate in the table or name someone from the pipeline so I know who to contact.)`,
    };
  }

  return base;
}

// TASK-002: JD paste detection and conversational intake in role transcript.
// Called when the recruiter pastes a long JD-like text in the role command bar.
// Parses it with Claude, updates the deal, and asks clarifying questions in transcript.
export async function dispatchJdPasteCommand(
  deps: RoleAgentOrchestratorDeps,
  jdText: string,
): Promise<void> {
  // Append the recruiter's text as a command turn (truncated for display).
  const displayText =
    jdText.length > 300
      ? `${jdText.slice(0, 300)}… (${jdText.length - 300} more chars)`
      : jdText;
  await appendRecruiterTurn(deps, displayText, { kind: "command" });

  // Parse the JD.
  let parsed: Awaited<ReturnType<typeof deps.dataProvider.parseJobDescription>>;
  try {
    parsed = await deps.dataProvider.parseJobDescription(jdText);
  } catch (error) {
    await appendAgentTurn(
      deps,
      `Couldn't parse that job description: ${error instanceof Error ? error.message : "unknown error"}. Try shortening it or pasting just the key requirements.`,
      { kind: "result", status: "executed" },
    );
    deps.invalidateTranscript();
    return;
  }

  // Update the deal record with parsed structured fields.
  try {
    await deps.dataProvider.update("deals", {
      id: deps.dealId,
      data: {
        name: parsed.title ?? deps.deal?.name,
        seniority: parsed.seniority,
        location: parsed.location,
        industry: parsed.industry,
        years_experience_min: parsed.years_experience_min,
        years_experience_max: parsed.years_experience_max,
        required_skills: parsed.required_skills,
        must_have_keywords: parsed.must_have_keywords,
        nice_to_have_keywords: parsed.nice_to_have_keywords,
        preference_tiers: parsed.preference_tiers,
        clarifying_questions: parsed.clarifying_questions,
        clarifying_questions_dismissed: false,
      },
      previousData: deps.deal ?? {},
    });
    deps.queryClient.invalidateQueries({ queryKey: ["deals", deps.dealId] });
  } catch {
    // Non-fatal: still show the summary even if the update fails.
  }

  // Build a readable summary of what was parsed.
  const skillsSummary =
    (parsed.required_skills ?? parsed.must_have_keywords ?? [])
      .slice(0, 5)
      .join(", ") || "not specified";
  const expSummary =
    parsed.years_experience_min != null || parsed.years_experience_max != null
      ? `${parsed.years_experience_min ?? 0}–${parsed.years_experience_max ?? "∞"} years`
      : "not specified";
  const summaryLines = [
    `**Role:** ${parsed.title || "untitled"}`,
    `**Seniority:** ${parsed.seniority || "not specified"}`,
    `**Location:** ${parsed.location || "not specified"}`,
    `**Experience:** ${expSummary}`,
    `**Key skills:** ${skillsSummary}`,
  ].join("\n");

  // Build the agent response with summary + questions.
  const questionsBlock = parsed.clarifying_questions?.length
    ? `\n\nA few things I'm less sure about:\n${parsed.clarifying_questions.map((q) => `• ${q}`).join("\n")}\n\nAnswer any of these, or say 'start sourcing' when you're ready.`
    : "\n\nEverything looks clear. Say 'start sourcing' to begin.";

  const agentContent = `Got it \u2014 here's what I parsed:\n\n${summaryLines}${questionsBlock}`;

  await appendAgentTurn(deps, agentContent, {
    kind: "result",
    action: "create_role",
    status: "executed",
  });
  deps.invalidateTranscript();
}

// TASK-003: After sourcing runs (continue_sourcing), append candidate card
// turns to the transcript so the recruiter sees fit signals inline.
export async function appendCandidateCardTurns(
  deps: RoleAgentOrchestratorDeps,
  candidates: Array<{
    id: number;
    first_name: string | null;
    last_name: string | null;
    job_title: string | null;
    job_company_name: string | null;
    linkedin_url: string | null;
    match_score: number | null;
    must_haves_check?: Array<{
      label: string;
      status: "found" | "inferred" | "missing";
    }>;
  }>,
): Promise<void> {
  const dealId = Number(deps.dealId);
  const top = candidates.slice(0, 5);
  for (const c of top) {
    const name =
      [c.first_name, c.last_name].filter(Boolean).join(" ") ||
      `Candidate #${c.id}`;
    const headline = [c.job_title, c.job_company_name]
      .filter(Boolean)
      .join(" at ");
    await appendAgentTurn(
      deps,
      `${name}${headline ? ` — ${headline}` : ""}${c.match_score != null ? ` (match ${Math.round(c.match_score * 100)}%)` : ""}`,
      {
        kind: "candidate_card",
        candidate_card: {
          candidate_id: c.id,
          deal_id: dealId,
          name,
          headline: headline || null,
          linkedin_url: c.linkedin_url,
          match_score: c.match_score,
          must_haves: (c.must_haves_check ?? []).slice(0, 3),
        },
      },
    );
  }
  deps.invalidateTranscript();
}

// TASK-004: After a candidate is added to the pipeline, propose outreach
// in the transcript (Tier 3 gate — recruiter must approve before sending).
export async function proposeOutreachAfterPipelineAdd(
  deps: RoleAgentOrchestratorDeps,
  candidateId: number,
  candidateName: string,
): Promise<void> {
  const dealId = Number(deps.dealId);

  let metadata: ConversationTurnMetadata;
  try {
    const result = await deps.dataProvider.prepareFirstOutreach(
      candidateId,
      dealId,
    );

    const base: ConversationTurnMetadata = {
      kind: "proposal",
      tier: "leaves_platform",
      action: "send_first_outreach",
      status: "pending",
      explanation: `${candidateName} is now in the pipeline. Ready to reach out?`,
      params: { candidate_id: candidateId, deal_id: dealId },
    };

    if (
      (result.channel === "linkedin_connection" ||
        result.channel === "linkedin_inmail") &&
      result.message_body &&
      result.linkedin_provider_id
    ) {
      metadata = {
        ...base,
        linkedin_preview: {
          channel: result.channel,
          message_body: result.message_body,
          char_count: result.char_count ?? result.message_body.length,
          is_open_profile: result.is_open_profile ?? false,
          linkedin_provider_id: result.linkedin_provider_id,
          cap_remaining: result.cap_remaining ?? undefined,
          drafted_by: result.drafted_by,
        } as ConversationTurnMetadata["linkedin_preview"],
      };
    } else if (result.channel === "email" && result.email_preview) {
      metadata = {
        ...base,
        email_preview:
          result.email_preview as ConversationTurnMetadata["email_preview"],
      };
    } else {
      metadata = base;
    }
  } catch (err) {
    // Outreach not available — show a friendly message in the transcript
    // without exposing internal error details or vendor names.
    const rawMsg = err instanceof Error ? err.message : "";
    const friendlyMsg = /no email|no contact|linkedin outreach isn/i.test(
      rawMsg,
    )
      ? `${candidateName} is in the pipeline. To reach out, add contact details or connect LinkedIn in Preferences.`
      : `${candidateName} is in the pipeline. Outreach couldn't be prepared automatically — open the candidate record to try manually.`;
    try {
      await appendAgentTurn(deps, friendlyMsg, {
        kind: "result",
        action: "send_first_outreach",
        status: "cancelled",
      });
      deps.invalidateTranscript();
    } catch {
      // If even the transcript write fails, swallow so the caller stays clean.
    }
    return;
  }

  try {
    await appendAgentTurn(
      deps,
      metadata.explanation ?? `Ready to reach out to ${candidateName}?`,
      metadata,
    );
    deps.invalidateTranscript();
  } catch {
    // Non-fatal — outreach was prepared, transcript write failed.
  }
}

export async function dispatchRoleAgentCommand(
  deps: RoleAgentOrchestratorDeps,
  commandText: string,
): Promise<void> {
  const dealIdNum = Number(deps.dealId);
  const selectedCandidates = deps.selectedCandidates ?? [];
  const pipelineCandidates = deps.pipelineCandidates ?? [];

  await appendRecruiterTurn(deps, commandText, { kind: "command" });

  const parsed = await deps.dataProvider.parseAgentCommand(commandText, {
    view: "canvas",
    open_deals: deps.openDeals.map((d) => ({ id: d.id, name: d.name })),
    current_deal_id: Number.isFinite(dealIdNum) ? dealIdNum : null,
    selected_candidates: selectedCandidates.map((c) => ({
      id: c.id,
      name: c.name,
    })),
    pipeline_candidates: pipelineCandidates.map((c) => ({
      id: c.id,
      name: c.name,
    })),
  });

  const tier = getActionTier(parsed.action);
  const proposalContent = parsed.explanation;

  if (isLeavesPlatformAction(parsed.action)) {
    const metadata = await buildTier3ProposalMetadata(deps, parsed);
    await appendAgentTurn(
      deps,
      metadata.explanation ?? proposalContent,
      metadata,
    );
    deps.invalidateTranscript();
    return;
  }

  const proposalTurn = await appendAgentTurn(deps, proposalContent, {
    kind: "proposal",
    tier,
    action: parsed.action,
    status: "executed",
    explanation: parsed.explanation,
    params: {
      deal_id: parsed.deal_id,
      criterion_id: parsed.criterion_id,
      candidate_id: resolveCandidateId(parsed, selectedCandidates),
    },
  });

  const { summary, undo } = await executeReversibleOrRead(deps, parsed);

  await appendAgentTurn(
    deps,
    summary,
    {
      kind: "result",
      tier,
      action: parsed.action,
      status: "executed",
      undo,
    },
    proposalTurn.id,
  );
  deps.invalidateTranscript();
}

export async function approveTier3Proposal(
  deps: RoleAgentOrchestratorDeps,
  proposalTurn: RoleConversationTurn,
  approvedPreview?: ConversationTurnMetadata["email_preview"],
  approvedLinkedInPreview?: ConversationTurnMetadata["linkedin_preview"],
): Promise<void> {
  const metadata = proposalTurn.metadata as
    | ConversationTurnMetadata
    | undefined;
  const action = metadata?.action;
  if (!action || !isLeavesPlatformAction(action)) {
    throw new Error("This turn is not a pending approval.");
  }

  await appendRecruiterTurn(
    deps,
    "Approved — send it.",
    { kind: "decision", outcome: "approved", action },
    proposalTurn.id,
  );

  const params = metadata.params ?? {};
  const candidateId = params.candidate_id as number | undefined;
  const dealId = (params.deal_id as number | undefined) ?? Number(deps.dealId);
  let resultSummary = "Done.";

  if (action === "send_offer" && candidateId && approvedPreview) {
    await deps.dataProvider.sendOffer(candidateId, dealId, {
      subject: approvedPreview.subject,
      html: approvedPreview.html,
    });
    resultSummary = `Offer email sent to ${approvedPreview.to}.`;
  } else if (
    action === "send_booking_link" &&
    candidateId &&
    metadata.booking_link_url
  ) {
    await deps.dataProvider.sendBookingLink(candidateId, dealId, {
      booking_link_url: metadata.booking_link_url,
      subject: approvedPreview?.subject,
      html: approvedPreview?.html,
    });
    resultSummary = "Booking link saved and email sent.";
  } else if (action === "request_resume" && candidateId && approvedPreview) {
    await deps.dataProvider.requestCandidateResume(candidateId, dealId, {
      subject: approvedPreview.subject,
      html: approvedPreview.html,
    });
    resultSummary = `Resume request sent to ${approvedPreview.to}.`;
  } else if (action === "send_first_outreach" && candidateId) {
    const linkedInPreview =
      approvedLinkedInPreview ?? metadata?.linkedin_preview;
    const emailPreviewForSend = approvedPreview;
    if (linkedInPreview) {
      await deps.dataProvider.sendFirstOutreach(candidateId, dealId, {
        channel: linkedInPreview.channel,
        message_body: linkedInPreview.message_body,
        linkedin_provider_id: linkedInPreview.linkedin_provider_id,
      });
      const channelLabel =
        linkedInPreview.channel === "linkedin_inmail"
          ? "LinkedIn InMail"
          : "LinkedIn connection request";
      resultSummary = `${channelLabel} sent.`;
    } else if (emailPreviewForSend) {
      await deps.dataProvider.sendFirstOutreach(candidateId, dealId, {
        channel: "email",
        subject: emailPreviewForSend.subject,
        html: emailPreviewForSend.html,
      });
      resultSummary = `Outreach email sent to ${emailPreviewForSend.to}.`;
    } else {
      await deps.dataProvider.sendFirstOutreach(candidateId, dealId);
      resultSummary = "Outreach sent.";
    }
  } else {
    resultSummary =
      metadata.explanation ??
      "Approved, but this action still needs wiring with a candidate context.";
  }

  await appendAgentTurn(
    deps,
    resultSummary,
    { kind: "result", action, status: "executed" },
    proposalTurn.id,
  );
  deps.invalidateTranscript();
}

export async function stopTier3Proposal(
  deps: RoleAgentOrchestratorDeps,
  proposalTurn: RoleConversationTurn,
): Promise<void> {
  const metadata = proposalTurn.metadata as
    | ConversationTurnMetadata
    | undefined;

  await appendRecruiterTurn(
    deps,
    "Stopped — don't send.",
    {
      kind: "decision",
      outcome: "stopped",
      action: metadata?.action,
    },
    proposalTurn.id,
  );

  await appendAgentTurn(
    deps,
    "Stopped. Nothing was sent.",
    { kind: "result", action: metadata?.action, status: "cancelled" },
    proposalTurn.id,
  );
  deps.invalidateTranscript();
}

export async function refineTier3Proposal(
  deps: RoleAgentOrchestratorDeps,
  proposalTurn: RoleConversationTurn,
  note: string,
  emailPreview?: ConversationTurnMetadata["email_preview"],
  linkedinPreview?: ConversationTurnMetadata["linkedin_preview"],
): Promise<void> {
  await appendRecruiterTurn(
    deps,
    note,
    {
      kind: "refinement",
      action: (proposalTurn.metadata as ConversationTurnMetadata | undefined)
        ?.action,
      email_preview: emailPreview,
      linkedin_preview: linkedinPreview,
    },
    proposalTurn.id,
  );
  deps.invalidateTranscript();
}
