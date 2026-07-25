import { useMemo } from "react";
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
