import type { CrmDataProvider } from "../providers/types";
import {
  EMPTY_OFFER_DRAFT,
  INTERVIEW_STATUS_LABELS,
  OFFER_STATUS_LABELS,
  RESUME_STATUS_LABELS,
  type EmailPreview,
  type InterviewResult,
  type OfferDraft,
  type OfferInfo,
  type PdlCandidate,
  type ResumeInfo,
} from "./sourcingTypes";

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;
type NotifyFn = (msg: string, opts: { type: string }) => void;

export type InterviewResumeOfferDeps = {
  dataProvider: CrmDataProvider;
  notify: NotifyFn;
  selectedId: string;
  candidateDbIds: Record<string, number>;
  bookingPrepared: Record<
    string,
    { booking_link_url: string; email_preview: EmailPreview | null }
  >;
  resumeEmailPreviews: Record<string, EmailPreview>;
  resumeInfos: Record<string, ResumeInfo>;
  offerDrafts: Record<string, OfferDraft>;
  offerEmailPreviews: Record<string, EmailPreview>;
  offerInfos: Record<string, OfferInfo>;
  setInterviewStates: SetState<Record<string, any>>;
  setInterviewResults: SetState<Record<string, InterviewResult>>;
  setBookingPrepared: SetState<
    Record<
      string,
      { booking_link_url: string; email_preview: EmailPreview | null }
    >
  >;
  setBookingSendStates: SetState<Record<string, any>>;
  setResumeStates: SetState<Record<string, any>>;
  setResumeEmailPreviews: SetState<Record<string, EmailPreview>>;
  setResumeInfos: SetState<Record<string, ResumeInfo>>;
  setResumeSendStates: SetState<Record<string, any>>;
  setOfferStates: SetState<Record<string, any>>;
  setOfferInfos: SetState<Record<string, OfferInfo>>;
  setOfferFormOpen: SetState<Record<string, boolean>>;
  setOfferDrafts: SetState<Record<string, OfferDraft>>;
  setOfferEmailPreviews: SetState<Record<string, EmailPreview>>;
  setOfferSendStates: SetState<Record<string, any>>;
};

export function createInterviewResumeOfferHandlers(
  d: InterviewResumeOfferDeps,
) {
  // ---- Interview / booking link ----

  const handlePrepareBookingLink = async (candidate: PdlCandidate) => {
    const candidateId = d.candidateDbIds[candidate.id];
    if (!candidateId || !d.selectedId) return;
    d.setInterviewStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    d.setBookingPrepared((prev) => {
      const next = { ...prev };
      delete next[candidate.id];
      return next;
    });
    try {
      const result = (await d.dataProvider.prepareBookingLink(
        candidateId,
        Number(d.selectedId),
      )) as InterviewResult;
      if (result.already_booked) {
        d.setInterviewResults((prev) => ({ ...prev, [candidate.id]: result }));
        d.notify(INTERVIEW_STATUS_LABELS[result.status!], { type: "info" });
      } else if (result.prepared && result.booking_link_url) {
        d.setInterviewResults((prev) => ({
          ...prev,
          [candidate.id]: {
            already_booked: false,
            prepared: true,
            booking_link_url: result.booking_link_url,
            candidate_email: result.candidate_email,
            email_sent: false,
          },
        }));
        d.setBookingPrepared((prev) => ({
          ...prev,
          [candidate.id]: {
            booking_link_url: result.booking_link_url!,
            email_preview: result.email_preview ?? null,
          },
        }));
        d.notify(
          result.email_preview
            ? "Review the booking email below before sending"
            : "Review the booking link below before saving",
          { type: "info" },
        );
      }
      d.setInterviewStates((prev) => ({ ...prev, [candidate.id]: "done" }));
    } catch (error: any) {
      d.setInterviewStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      d.notify(error?.message || "Failed to prepare booking link", {
        type: "error",
      });
    }
  };

  const handleConfirmSendBookingLink = async (candidate: PdlCandidate) => {
    const candidateId = d.candidateDbIds[candidate.id];
    const prepared = d.bookingPrepared[candidate.id];
    if (!candidateId || !d.selectedId || !prepared) return;
    d.setBookingSendStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const preview = prepared.email_preview;
      const result = (await d.dataProvider.sendBookingLink(
        candidateId,
        Number(d.selectedId),
        {
          booking_link_url: prepared.booking_link_url,
          subject: preview?.subject,
          html: preview?.html,
        },
      )) as InterviewResult;
      d.setInterviewResults((prev) => ({ ...prev, [candidate.id]: result }));
      d.setBookingPrepared((prev) => {
        const next = { ...prev };
        delete next[candidate.id];
        return next;
      });
      d.notify(
        result.email_sent
          ? "Booking link saved and emailed to the candidate"
          : "Booking link saved — share it with the candidate manually",
        { type: "success" },
      );
      d.setBookingSendStates((prev) => ({ ...prev, [candidate.id]: "done" }));
    } catch (error: any) {
      d.setBookingSendStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      d.notify(error?.message || "Failed to send booking link", {
        type: "error",
      });
    }
  };

  const handleCancelBookingPrepared = (candidateId: string) => {
    d.setBookingPrepared((prev) => {
      const next = { ...prev };
      delete next[candidateId];
      return next;
    });
    d.setInterviewResults((prev) => {
      const next = { ...prev };
      delete next[candidateId];
      return next;
    });
  };

  // ---- Resume ----

  const handlePrepareResumeRequest = async (candidate: PdlCandidate) => {
    const candidateId = d.candidateDbIds[candidate.id];
    if (!candidateId || !d.selectedId) return;
    d.setResumeStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    d.setResumeEmailPreviews((prev) => {
      const next = { ...prev };
      delete next[candidate.id];
      return next;
    });
    try {
      const result = await d.dataProvider.prepareRequestResume(
        candidateId,
        Number(d.selectedId),
      );
      d.setResumeEmailPreviews((prev) => ({
        ...prev,
        [candidate.id]: result.email_preview as EmailPreview,
      }));
      d.setResumeStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      d.notify("Review the resume request email below before sending", {
        type: "info",
      });
    } catch (error: any) {
      d.setResumeStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      d.notify(error?.message || "Failed to prepare resume request", {
        type: "error",
      });
    }
  };

  const handleConfirmSendResumeRequest = async (candidate: PdlCandidate) => {
    const candidateId = d.candidateDbIds[candidate.id];
    const preview = d.resumeEmailPreviews[candidate.id];
    if (!candidateId || !d.selectedId || !preview) return;
    d.setResumeSendStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = await d.dataProvider.requestCandidateResume(
        candidateId,
        Number(d.selectedId),
        { subject: preview.subject, html: preview.html },
      );
      d.setResumeSendStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      d.setResumeEmailPreviews((prev) => {
        const next = { ...prev };
        delete next[candidate.id];
        return next;
      });
      d.notify(
        result.resume_status === "received"
          ? "Already have a resume on file -- sent another request anyway"
          : "Resume request sent",
        { type: "success" },
      );
      const current = d.resumeInfos[candidate.id];
      d.setResumeInfos((prev) => ({
        ...prev,
        [candidate.id]: {
          resume_status: result.resume_status,
          resume_original_filename: current?.resume_original_filename ?? null,
          resume_received_at: current?.resume_received_at ?? null,
          resume_reply_text: current?.resume_reply_text ?? null,
        },
      }));
    } catch (error: any) {
      d.setResumeSendStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      d.notify(error?.message || "Failed to send resume request", {
        type: "error",
      });
    }
  };

  const handleCancelResumePreview = (candidateId: string) => {
    d.setResumeEmailPreviews((prev) => {
      const next = { ...prev };
      delete next[candidateId];
      return next;
    });
  };

  const handleCheckForResume = async (candidate: PdlCandidate) => {
    const candidateId = d.candidateDbIds[candidate.id];
    if (!candidateId) return;
    d.setResumeStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const info = (await d.dataProvider.getCandidateResumeInfo(
        candidateId,
      )) as ResumeInfo;
      d.setResumeInfos((prev) => ({ ...prev, [candidate.id]: info }));
      d.setResumeStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      d.notify(RESUME_STATUS_LABELS[info.resume_status], {
        type: info.resume_status === "received" ? "success" : "info",
      });
    } catch (error: any) {
      d.setResumeStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      d.notify(error?.message || "Failed to check resume status", {
        type: "error",
      });
    }
  };

  // ---- Offer ----

  const handleToggleOfferForm = (candidate: PdlCandidate) => {
    d.setOfferFormOpen((prev) => ({
      ...prev,
      [candidate.id]: !prev[candidate.id],
    }));
    d.setOfferDrafts((prev) => ({
      ...prev,
      [candidate.id]: prev[candidate.id] ?? { ...EMPTY_OFFER_DRAFT },
    }));
  };

  const handleOfferDraftChange = (
    candidateKey: string,
    field: keyof OfferDraft,
    value: string,
  ) => {
    d.setOfferDrafts((prev) => ({
      ...prev,
      [candidateKey]: {
        ...(prev[candidateKey] ?? EMPTY_OFFER_DRAFT),
        [field]: value,
      },
    }));
  };

  const handlePrepareOffer = async (candidate: PdlCandidate) => {
    const candidateId = d.candidateDbIds[candidate.id];
    const draft = d.offerDrafts[candidate.id];
    if (!candidateId || !d.selectedId || !draft) return;
    d.setOfferStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    d.setOfferEmailPreviews((prev) => {
      const next = { ...prev };
      delete next[candidate.id];
      return next;
    });
    try {
      const result = await d.dataProvider.prepareOffer(
        candidateId,
        Number(d.selectedId),
        {
          position_title: draft.position_title,
          compensation_amount: draft.compensation_amount
            ? Number(draft.compensation_amount)
            : null,
          compensation_currency: draft.compensation_currency,
          compensation_frequency: draft.compensation_frequency,
          start_date: draft.start_date || null,
          expiry_date: draft.expiry_date || null,
          benefits_summary: draft.benefits_summary || null,
        },
      );
      d.setOfferInfos((prev) => ({
        ...prev,
        [candidate.id]: result.offer as OfferInfo,
      }));
      d.setOfferEmailPreviews((prev) => ({
        ...prev,
        [candidate.id]: result.email_preview as EmailPreview,
      }));
      d.setOfferStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      d.notify("Review the offer email below before sending", { type: "info" });
    } catch (error: any) {
      d.setOfferStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      d.notify(error?.message || "Failed to prepare offer", { type: "error" });
    }
  };

  const handleConfirmSendOffer = async (candidate: PdlCandidate) => {
    const candidateId = d.candidateDbIds[candidate.id];
    const preview = d.offerEmailPreviews[candidate.id];
    if (!candidateId || !d.selectedId || !preview) return;
    d.setOfferSendStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = await d.dataProvider.sendOffer(
        candidateId,
        Number(d.selectedId),
        {
          subject: preview.subject,
          html: preview.html,
        },
      );
      d.setOfferInfos((prev) => ({
        ...prev,
        [candidate.id]: result.offer as OfferInfo,
      }));
      d.setOfferEmailPreviews((prev) => {
        const next = { ...prev };
        delete next[candidate.id];
        return next;
      });
      d.setOfferStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      d.setOfferFormOpen((prev) => ({ ...prev, [candidate.id]: false }));
      d.notify("Offer sent", { type: "success" });
    } catch (error: any) {
      d.setOfferSendStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      d.notify(error?.message || "Failed to send offer", { type: "error" });
    }
  };

  const handleCancelOfferPreview = (candidateId: string) => {
    d.setOfferEmailPreviews((prev) => {
      const next = { ...prev };
      delete next[candidateId];
      return next;
    });
  };

  const handleCheckOffer = async (candidate: PdlCandidate) => {
    const candidateId = d.candidateDbIds[candidate.id];
    if (!candidateId || !d.selectedId) return;
    d.setOfferStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const info = (await d.dataProvider.getCandidateOffer(
        candidateId,
        Number(d.selectedId),
      )) as OfferInfo | null;
      if (info) {
        d.setOfferInfos((prev) => ({ ...prev, [candidate.id]: info }));
        d.notify(OFFER_STATUS_LABELS[info.status], {
          type: info.status === "accepted" ? "success" : "info",
        });
      }
      d.setOfferStates((prev) => ({ ...prev, [candidate.id]: "done" }));
    } catch (error: any) {
      d.setOfferStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      d.notify(error?.message || "Failed to check offer status", {
        type: "error",
      });
    }
  };

  const handleMarkOfferStatus = async (
    candidate: PdlCandidate,
    status: "accepted" | "declined" | "negotiating",
  ) => {
    const info = d.offerInfos[candidate.id];
    if (!info) return;
    try {
      await d.dataProvider.updateOfferStatus(info.id, status);
      d.setOfferInfos((prev) => ({
        ...prev,
        [candidate.id]: { ...info, status },
      }));
      d.notify(OFFER_STATUS_LABELS[status], { type: "success" });
    } catch (error: any) {
      d.notify(error?.message || "Failed to update offer status", {
        type: "error",
      });
    }
  };

  return {
    handlePrepareBookingLink,
    handleConfirmSendBookingLink,
    handleCancelBookingPrepared,
    handlePrepareResumeRequest,
    handleConfirmSendResumeRequest,
    handleCancelResumePreview,
    handleCheckForResume,
    handleToggleOfferForm,
    handleOfferDraftChange,
    handlePrepareOffer,
    handleConfirmSendOffer,
    handleCancelOfferPreview,
    handleCheckOffer,
    handleMarkOfferStatus,
  };
}
