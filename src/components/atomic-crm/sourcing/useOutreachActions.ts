import type { CrmDataProvider } from "../providers/types";
import {
  type OutreachPrepared,
  type PdlCandidate,
  type SaveState,
} from "./sourcingTypes";

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;
type NotifyFn = (msg: string, opts: { type: string }) => void;

export type OutreachActionsDeps = {
  dataProvider: CrmDataProvider;
  notify: NotifyFn;
  selectedId: string;
  candidates: PdlCandidate[];
  bulkSelected: Set<string>;
  candidateDbIds: Record<string, number>;
  outreachPrepared: Record<string, OutreachPrepared>;
  onCandidateSaved?: (candidateId: number, name: string) => void;
  setOutreachStates: SetState<Record<string, any>>;
  setOutreachPrepared: SetState<Record<string, OutreachPrepared>>;
  setOutreachSendStates: SetState<Record<string, any>>;
  setSaveStates: SetState<Record<string, SaveState>>;
  setCandidateDbIds: SetState<Record<string, number>>;
  setBulkPreparing: SetState<boolean>;
  setBulkQueue: SetState<
    Array<{ candidateKey: string; prepared: OutreachPrepared }>
  >;
  setBulkQueueIdx: SetState<number>;
  setBulkSelected: SetState<Set<string>>;
};

export function createOutreachActionHandlers(d: OutreachActionsDeps) {
  const handlePrepareOutreach = async (candidate: PdlCandidate) => {
    const candidateId = d.candidateDbIds[candidate.id];
    if (!candidateId || !d.selectedId) return;
    d.setOutreachStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = await d.dataProvider.prepareFirstOutreach(
        candidateId,
        Number(d.selectedId),
      );
      d.setOutreachPrepared((prev) => ({
        ...prev,
        [candidate.id]: result as OutreachPrepared,
      }));
      d.setOutreachStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      d.notify("Review the outreach message before sending", { type: "info" });
    } catch (error: any) {
      d.setOutreachStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      d.notify(error?.message || "Failed to prepare outreach", {
        type: "error",
      });
    }
  };

  // Save-then-prepare in one shot so action bar outreach works before
  // the recruiter manually clicks "Add to pipeline".
  const handleOutreachFromSearch = async (candidate: PdlCandidate) => {
    if (!d.selectedId) return;
    let cId = d.candidateDbIds[candidate.id];
    if (!cId) {
      d.setSaveStates((prev) => ({ ...prev, [candidate.id]: "saving" }));
      try {
        const outcome = await d.dataProvider.saveSourcedCandidate(
          Number(d.selectedId),
          candidate,
        );
        if (outcome.candidate_id) {
          cId = outcome.candidate_id;
          d.setCandidateDbIds((prev) => ({ ...prev, [candidate.id]: cId! }));
          d.setSaveStates((prev) => ({ ...prev, [candidate.id]: "saved" }));
          if (d.onCandidateSaved) {
            const name =
              candidate.full_name || `Candidate #${outcome.candidate_id}`;
            d.onCandidateSaved(outcome.candidate_id, name);
          }
        }
      } catch (error: any) {
        d.setSaveStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
        d.notify(error?.message || "Failed to save candidate", {
          type: "error",
        });
        return;
      }
    }
    if (!cId) return;
    d.setOutreachStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const result = await d.dataProvider.prepareFirstOutreach(
        cId,
        Number(d.selectedId),
      );
      d.setOutreachPrepared((prev) => ({
        ...prev,
        [candidate.id]: result as OutreachPrepared,
      }));
      d.setOutreachStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      d.notify("Review the outreach message before sending", { type: "info" });
    } catch (error: any) {
      d.setOutreachStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      d.notify(error?.message || "Failed to prepare outreach", {
        type: "error",
      });
    }
  };

  const handleConfirmSendOutreach = async (candidate: PdlCandidate) => {
    const candidateId = d.candidateDbIds[candidate.id];
    const prepared = d.outreachPrepared[candidate.id];
    if (!candidateId || !d.selectedId || !prepared) return;
    d.setOutreachSendStates((prev) => ({ ...prev, [candidate.id]: "loading" }));
    try {
      const isDualChannel =
        prepared.dual_channel &&
        prepared.send_email_too &&
        prepared.email_preview;
      await d.dataProvider.sendFirstOutreach(
        candidateId,
        Number(d.selectedId),
        {
          channel: prepared.channel,
          message_body: prepared.message_body ?? undefined,
          linkedin_provider_id: prepared.linkedin_provider_id ?? undefined,
          subject:
            prepared.channel === "email"
              ? prepared.email_preview?.subject
              : undefined,
          html:
            prepared.channel === "email"
              ? prepared.email_preview?.html
              : undefined,
          also_send_email: isDualChannel ? true : undefined,
          email_to: isDualChannel ? prepared.email_preview?.to : undefined,
          email_subject: isDualChannel
            ? prepared.email_preview?.subject
            : undefined,
          email_html: isDualChannel ? prepared.email_preview?.html : undefined,
        },
      );
      d.setOutreachSendStates((prev) => ({ ...prev, [candidate.id]: "done" }));
      d.setOutreachPrepared((prev) => {
        const next = { ...prev };
        delete next[candidate.id];
        return next;
      });
      d.notify(
        isDualChannel ? "Outreach sent via LinkedIn + email" : "Outreach sent",
        {
          type: "success",
        },
      );
    } catch (error: any) {
      d.setOutreachSendStates((prev) => ({ ...prev, [candidate.id]: "idle" }));
      d.notify(error?.message || "Failed to send outreach", { type: "error" });
    }
  };

  const handleBulkPrepareOutreach = async () => {
    if (!d.selectedId || d.bulkSelected.size === 0) return;
    d.setBulkPreparing(true);
    const selected = d.candidates.filter((c) => d.bulkSelected.has(c.id));
    const queue: Array<{ candidateKey: string; prepared: OutreachPrepared }> =
      [];
    for (const candidate of selected) {
      let cId = d.candidateDbIds[candidate.id];
      if (!cId) {
        try {
          const outcome = await d.dataProvider.saveSourcedCandidate(
            Number(d.selectedId),
            candidate,
          );
          if (outcome.candidate_id) {
            cId = outcome.candidate_id;
            d.setCandidateDbIds((prev) => ({ ...prev, [candidate.id]: cId! }));
            d.setSaveStates((prev) => ({ ...prev, [candidate.id]: "saved" }));
          }
        } catch {
          continue;
        }
      }
      if (!cId) continue;
      try {
        const result = await d.dataProvider.prepareFirstOutreach(
          cId,
          Number(d.selectedId),
        );
        queue.push({
          candidateKey: candidate.id,
          prepared: result as OutreachPrepared,
        });
        d.setOutreachPrepared((prev) => ({
          ...prev,
          [candidate.id]: result as OutreachPrepared,
        }));
      } catch {
        // skip
      }
    }
    d.setBulkQueue(queue);
    d.setBulkQueueIdx(0);
    d.setBulkPreparing(false);
    d.setBulkSelected(new Set());
    if (queue.length > 0) {
      d.notify(
        `${queue.length} outreach draft(s) ready — review each before sending`,
        { type: "info" },
      );
    }
  };

  return {
    handlePrepareOutreach,
    handleOutreachFromSearch,
    handleConfirmSendOutreach,
    handleBulkPrepareOutreach,
  };
}
