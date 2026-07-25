export type OfferTerms = {
  position_title: string;
  compensation_amount: number | null;
  compensation_currency: string;
  compensation_frequency: string;
  start_date: string | null;
  expiry_date: string | null;
  benefits_summary: string | null;
};

export function formatCompensation(
  amount: number | null,
  currency: string,
  frequency: string,
): string | null {
  if (amount === null || amount === undefined) return null;
  const formattedAmount = new Intl.NumberFormat("en-US").format(amount);
  return `${currency} ${formattedAmount} / ${frequency}`;
}

export function buildOfferReplyToAddress(
  candidateId: number,
  dealId: number,
  receivingDomain: string,
): string {
  return `offer-${candidateId}-deal-${dealId}@${receivingDomain}`;
}

export function buildOfferEmailPreview(params: {
  candidateId: number;
  dealId: number;
  candidateName: string;
  candidateEmail: string;
  dealName: string | null;
  receivingDomain: string;
  terms: OfferTerms;
}): { to: string; reply_to: string; subject: string; html: string } {
  const {
    candidateId,
    dealId,
    candidateName,
    candidateEmail,
    dealName,
    receivingDomain,
    terms,
  } = params;

  const compensationLine = formatCompensation(
    terms.compensation_amount,
    terms.compensation_currency,
    terms.compensation_frequency,
  );

  const bodyLines = [
    `<p>Hi ${candidateName},</p>`,
    `<p>We'd like to offer you the <strong>${terms.position_title}</strong> role${dealName ? ` (${dealName})` : ""}.</p>`,
    "<ul>",
    compensationLine ? `<li>Compensation: ${compensationLine}</li>` : "",
    terms.start_date ? `<li>Start date: ${terms.start_date}</li>` : "",
    terms.expiry_date
      ? `<li>This offer is valid until: ${terms.expiry_date}</li>`
      : "",
    "</ul>",
    terms.benefits_summary ? `<p>${terms.benefits_summary}</p>` : "",
    "<p>Please reply to this email to let us know if you'd like to accept, decline, or discuss the terms further.</p>",
    "<p>Congratulations, and we look forward to hearing from you!</p>",
  ].filter(Boolean);

  return {
    to: candidateEmail,
    reply_to: buildOfferReplyToAddress(candidateId, dealId, receivingDomain),
    subject: `Your offer for ${terms.position_title}${dealName ? ` at ${dealName}` : ""}`,
    html: bodyLines.join(""),
  };
}
