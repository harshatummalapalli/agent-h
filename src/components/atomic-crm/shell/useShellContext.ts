import { useMemo } from "react";
import type { Deal } from "../types";
import { findDealLabel, formatISODateString } from "../deals/dealUtils";
import type { DealStage } from "../types";
import type { ShellContext } from "./types";

type InboxShellContextInput = {
  pendingDecisionCount: number;
  isPending: boolean;
};

export function useInboxShellContext({
  pendingDecisionCount,
  isPending,
}: InboxShellContextInput): ShellContext {
  return useMemo(() => {
    const blockers: string[] = [];
    if (isPending) {
      blockers.push("Loading your roles…");
    } else if (pendingDecisionCount > 0) {
      blockers.push(
        `${pendingDecisionCount} candidate${pendingDecisionCount === 1 ? "" : "s"} waiting for review`,
      );
    }

    return {
      mode: "inbox",
      title: "All roles",
      blockers,
    };
  }, [isPending, pendingDecisionCount]);
}

type RoleShellContextInput = {
  deal: Deal | undefined;
  dealStages: DealStage[];
  pipelineCount: number;
  isPending: boolean;
};

export function useRoleShellContext({
  deal,
  dealStages,
  pipelineCount,
  isPending,
}: RoleShellContextInput): ShellContext {
  return useMemo(() => {
    if (isPending || !deal) {
      return {
        mode: "role",
        title: "Role",
        blockers: ["Loading role…"],
      };
    }

    const blockers: string[] = [
      findDealLabel(dealStages, deal.stage) ?? deal.stage,
      `${pipelineCount} in pipeline`,
    ];

    if (deal.role_brief_last_scroll_token) {
      blockers.push("Continue where you left off");
    } else if (!deal.role_brief_last_scroll_query) {
      blockers.push("Ready to source — kick off a search");
    }

    let lastAction: string | undefined;
    if (deal.role_brief_last_scroll_updated_at) {
      const when = formatISODateString(deal.role_brief_last_scroll_updated_at);
      lastAction = deal.role_brief_last_scroll_token
        ? `Last search ${when} — more results available`
        : `Last search ${when}`;
    }

    return {
      mode: "role",
      title: deal.name,
      blockers,
      lastAction,
    };
  }, [deal, dealStages, isPending, pipelineCount]);
}

type JdIntakeShellContextInput = {
  parsedTitle: string | undefined;
  hasJdText: boolean;
  isParsing: boolean;
  isSaving: boolean;
};

export function useJdIntakeShellContext({
  parsedTitle,
  hasJdText,
  isParsing,
  isSaving,
}: JdIntakeShellContextInput): ShellContext {
  return useMemo(() => {
    if (isParsing) {
      return {
        mode: "intake",
        title: parsedTitle ?? "New role",
        blockers: ["Analysing job description…"],
      };
    }

    if (isSaving) {
      return {
        mode: "intake",
        title: parsedTitle ?? "New role",
        blockers: ["Saving your role…"],
      };
    }

    if (parsedTitle) {
      return {
        mode: "intake",
        title: parsedTitle,
        blockers: ["Review the parsed details before saving"],
      };
    }

    if (hasJdText) {
      return {
        mode: "intake",
        title: "New role",
        blockers: ["Click Parse with AI to extract the role details"],
      };
    }

    return {
      mode: "intake",
      title: "New role",
      blockers: ["Paste a job description to get started"],
    };
  }, [hasJdText, isParsing, isSaving, parsedTitle]);
}
