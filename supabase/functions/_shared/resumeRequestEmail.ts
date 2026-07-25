export function buildResumeRequestReplyTo(
  candidateId: number,
  dealId: number,
  receivingDomain: string,
): string {
  return `candidate-${candidateId}-deal-${dealId}@${receivingDomain}`;
}

export function buildResumeRequestEmailPreview(params: {
  candidateId: number;
  dealId: number;
  candidateName: string;
  candidateEmail: string;
  dealName: string | null;
  receivingDomain: string;
}): { to: string; reply_to: string; subject: string; html: string } {
  const {
    candidateId,
    dealId,
    candidateName,
    candidateEmail,
    dealName,
    receivingDomain,
  } = params;

  return {
    to: candidateEmail,
    reply_to: buildResumeRequestReplyTo(candidateId, dealId, receivingDomain),
    subject: "Quick ask -- could you send your resume?",
    html: `<p>Hi ${candidateName},</p><p>We'd love to move forward with you for the <strong>${dealName ?? "role"}</strong> role. Could you reply to this email with your resume attached?</p><p>Thanks!</p>`,
  };
}
