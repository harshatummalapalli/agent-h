export type CalLinkConfig = {
  calBaseUrl: string;
  calEventSlug: string;
  calUsername: string;
};

export function buildBookingLinkUrl(
  candidateId: number,
  dealId: number,
  candidateName: string,
  candidateEmail: string | null,
  config: CalLinkConfig,
): string {
  const linkParams = new URLSearchParams();
  linkParams.set("name", candidateName);
  if (candidateEmail) linkParams.set("email", candidateEmail);
  linkParams.set("metadata[candidateId]", String(candidateId));
  linkParams.set("metadata[dealId]", String(dealId));

  return `${config.calBaseUrl.replace(/\/$/, "")}/${config.calUsername}/${config.calEventSlug}?${linkParams.toString()}`;
}

export function buildBookingEmailPreview(params: {
  candidateName: string;
  candidateEmail: string;
  dealName: string | null;
  bookingLinkUrl: string;
}): { to: string; subject: string; html: string } {
  const { candidateName, candidateEmail, dealName, bookingLinkUrl } = params;

  return {
    to: candidateEmail,
    subject: `Schedule your interview -- ${dealName ?? "role"}`,
    html: `<p>Hi ${candidateName},</p><p>Please pick a time that works for you for your interview for <strong>${dealName ?? "the role"}</strong>:</p><p><a href="${bookingLinkUrl}">${bookingLinkUrl}</a></p>`,
  };
}
