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
      blockers.push("Checking your roles…");
    } else if (pendingDecisionCount > 0) {
      blockers.push(
        `${pendingDecisionCount} decision${pendingDecisionCount === 1 ? "" : "s"} need you`,
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
      blockers.push("Search can continue from your last run");
    } else if (!deal.role_brief_last_scroll_query) {
      blockers.push("No search run yet for this role");
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
