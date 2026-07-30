// Agent H, sourcing sidebar (2026-07-21): the conversation logic behind
// SourcingSidebar. Extracted into its own hook so the routing between
// parseAgentCommand's actions and what happens next (existing today,
// duplicated separately in InboxPage.tsx's and CanvasPage.tsx's own
// runFreeTextCommand) has exactly one home for the sidebar experience,
// instead of a third near-copy. InboxPage's own bottom CommandBar is left
// wired to its existing runFreeTextCommand this pass -- swapping it over
// too is a follow-up once this sidebar is proven out, not bundled in here.
import { useCallback, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";

import type { CrmDataProvider } from "../providers/types";
import type { Identifier } from "ra-core";
import type { VersionedSearchIntent, SearchIntentCondition } from "../types";
import {
  initialSourcingSteps,
  type SourcingStep,
  type ThreadItem,
} from "./sourcingThreadTypes";

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ─── intentDelta helpers ──────────────────────────────────────────────────────

function conditionKey(c: SearchIntentCondition): string {
  return `${c.category}:${c.disposition}:${c.value.toLowerCase()}`;
}

function formatIntentDelta(
  prev: VersionedSearchIntent,
  curr: VersionedSearchIntent,
): string | null {
  const prevKeys = new Set(prev.conditions.map(conditionKey));
  const currKeys = new Set(curr.conditions.map(conditionKey));
  const added = curr.conditions.filter((c) => !prevKeys.has(conditionKey(c)));
  const removed = prev.conditions.filter((c) => !currKeys.has(conditionKey(c)));

  if (added.length === 0 && removed.length === 0) return null;

  const parts: string[] = [];

  const byDisp = (conds: SearchIntentCondition[], disp: string) =>
    conds.filter((c) => c.disposition === disp);

  const fmt = (conds: SearchIntentCondition[], prefix: string) => {
    if (!conds.length) return null;
    const vals = conds.map((c) => c.value).join(", ");
    return `${prefix}: ${vals}`;
  };

  parts.push(
    ...[
      fmt(byDisp(added, "require"), `+${byDisp(added, "require").length} required`),
      fmt(byDisp(added, "exclude"), `+${byDisp(added, "exclude").length} excluded`),
      fmt(byDisp(added, "prefer"), `+${byDisp(added, "prefer").length} preferred`),
      fmt(byDisp(removed, "require"), `-${byDisp(removed, "require").length} required`),
      fmt(byDisp(removed, "exclude"), `-${byDisp(removed, "exclude").length} excluded`),
      fmt(byDisp(removed, "prefer"), `-${byDisp(removed, "prefer").length} preferred`),
    ].filter(Boolean) as string[],
  );

  return parts.join(" · ") || null;
}

type UseSourcingThreadArgs = {
  dataProvider: CrmDataProvider;
  queryClient: QueryClient;
  openDeals: Array<{ id: Identifier; name: string }>;
  onNavigate: (path: string) => void;
};

type SourcingThreadItem = Extract<ThreadItem, { kind: "sourcing" }>;

export const useSourcingThread = ({
  dataProvider,
  queryClient,
  openDeals,
  onNavigate,
}: UseSourcingThreadArgs) => {
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [isBusy, setIsBusy] = useState(false);

  const appendItem = (item: ThreadItem) => setThread((prev) => [...prev, item]);

  // Only ever patches a "sourcing" thread item (the one kind that changes
  // in place as its steps progress) -- typed against that variant
  // specifically rather than Partial<ThreadItem>, so a patch can't
  // silently smuggle in fields that don't belong to this item's kind.
  const patchSourcingItem = (
    id: string,
    patch: Partial<Omit<SourcingThreadItem, "kind" | "id">>,
  ) =>
    setThread((prev) =>
      prev.map((item) =>
        item.kind === "sourcing" && item.id === id
          ? { ...item, ...patch }
          : item,
      ),
    );

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isBusy) return;

      appendItem({ kind: "user", id: makeId(), text: trimmed });
      setIsBusy(true);

      try {
        const parsed = await dataProvider.parseAgentCommand(trimmed, {
          view: "inbox",
          open_deals: openDeals,
          current_deal_id: null,
        });

        if (parsed.action === "continue_sourcing" && parsed.deal_id != null) {
          const dealName =
            openDeals.find((d) => d.id === parsed.deal_id)?.name ?? "that role";
          const sourcingId = makeId();
          appendItem({
            kind: "sourcing",
            id: sourcingId,
            dealName,
            steps: initialSourcingSteps(),
          });

          try {
            const result = await dataProvider.continueSourcingForDeal(
              parsed.deal_id,
            );
            const doneSteps: SourcingStep[] = [
              {
                key: "parse",
                label: "Understanding your request",
                status: "done",
              },
              {
                key: "portals",
                label: "Developer & community search",
                status: "done",
              },
              { key: "exa", label: "Web search", status: "done" },
              { key: "filter", label: "Checking relevance", status: "done" },
            ];
            patchSourcingItem(sourcingId, {
              steps: doneSteps,
              result: {
                foundCount: result.foundCount,
                filteredCount: result.filteredCount,
              },
            });
          } catch (error) {
            patchSourcingItem(sourcingId, {
              error:
                error instanceof Error
                  ? error.message
                  : "Sourcing failed for this role.",
            });
          }
        } else if (
          parsed.action === "relax_criterion" &&
          parsed.criterion_id != null
        ) {
          await dataProvider.relaxLearnedCriterion(parsed.criterion_id);
          queryClient.invalidateQueries({
            queryKey: ["inbox_per_deal_signals"],
          });
          appendItem({
            kind: "assistant",
            id: makeId(),
            text: parsed.explanation,
            tone: "success",
          });
        } else if (
          parsed.action === "show_candidates" &&
          parsed.deal_id != null
        ) {
          appendItem({
            kind: "assistant",
            id: makeId(),
            text: parsed.explanation,
            tone: "success",
          });
          onNavigate(`/canvas/${parsed.deal_id}`);
        } else if (parsed.action === "show_roles") {
          appendItem({
            kind: "assistant",
            id: makeId(),
            text: parsed.explanation,
            tone: "success",
          });
          onNavigate("/deals");
        } else if (parsed.action === "refine_search_intent") {
          if (parsed.deal_id == null) {
            appendItem({
              kind: "assistant",
              id: makeId(),
              text: "Please mention which role to adjust, or open a specific role first.",
              tone: "info",
            });
          } else {
            const refineResult = await dataProvider.refineSearchIntent(parsed.deal_id, trimmed);
            queryClient.invalidateQueries({
              queryKey: ["inbox_per_deal_signals"],
            });

            // Show intentDelta: what changed in this refine turn.
            const record = (refineResult as { record?: { current?: VersionedSearchIntent; history?: VersionedSearchIntent[] } })?.record;
            const curr = record?.current;
            const prevHistory = record?.history ?? [];
            const prev = prevHistory.at(-1);
            const delta = curr && prev ? formatIntentDelta(prev, curr) : null;

            const recap = curr
              ? `Require ${curr.conditions.filter((c) => c.disposition === "require").length} · Prefer ${curr.conditions.filter((c) => c.disposition === "prefer").length} · Exclude ${curr.conditions.filter((c) => c.disposition === "exclude").length}`
              : null;

            const deltaLine = delta ? `\n\nChanged: ${delta}` : "";
            const recapLine = recap ? `\n${recap}` : "";

            appendItem({
              kind: "assistant",
              id: makeId(),
              text: `${parsed.explanation}${deltaLine}${recapLine}`,
              tone: "success",
            });
          }
        } else {
          appendItem({
            kind: "assistant",
            id: makeId(),
            text: parsed.explanation,
            tone: "info",
          });
        }
      } catch (error) {
        appendItem({
          kind: "assistant",
          id: makeId(),
          text:
            error instanceof Error
              ? error.message
              : "Something went wrong running that.",
          tone: "error",
        });
      } finally {
        setIsBusy(false);
      }
    },
    [dataProvider, queryClient, openDeals, onNavigate, isBusy],
  );

  return { thread, submit, isBusy };
};
