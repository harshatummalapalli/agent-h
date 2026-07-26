// Agent H, sourcing sidebar (2026-07-21): shared types for the persistent
// sourcing conversation. Kept separate from useSourcingThread.ts /
// SourcingSidebar.tsx so both can import the shapes without a circular
// dependency, per the "many small files" convention in this repo.

export type SourcingStepStatus = "pending" | "active" | "done";

// Deliberately named after what actually happens today (2 real vendor
// calls in continueSourcingForDeal, plus the relevance filter this session
// added), not the eventual 3+-vendor architecture -- the checklist should
// never claim a step that isn't real. Add steps here only as the backend
// genuinely grows to cover them.
export type SourcingStep = {
  key: "parse" | "portals" | "exa" | "filter";
  label: string;
  status: SourcingStepStatus;
};

export type ThreadItem =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "sourcing";
      id: string;
      dealName: string;
      steps: SourcingStep[];
      result?: {
        foundCount: number;
        filteredCount: number;
      };
      error?: string;
    }
  | {
      kind: "assistant";
      id: string;
      text: string;
      tone: "success" | "info" | "error";
    };

export const initialSourcingSteps = (): SourcingStep[] => [
  { key: "parse", label: "Understanding your request", status: "done" },
  { key: "portals", label: "Developer & community search", status: "active" },
  { key: "exa", label: "Web search", status: "active" },
  { key: "filter", label: "Checking relevance", status: "pending" },
];
