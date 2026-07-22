// Agent H, Triage Inbox: aggregates "decisions that need Harsha" across
// every open role into one ranked feed, replacing the old Dashboard's
// static stat cards as the landing experience. There is no single
// materialized view for this yet (see dataProvider.getCandidatesForDeal's
// own comment on why plain multi-table reads are this codebase's default
// over a dedicated edge function for read-only aggregation) -- this hook
// follows that same convention: a handful of getList calls, fanned out
// client-side, capped to the first OPEN_DEAL_SCAN_LIMIT open roles so this
// stays cheap. If the number of open roles grows large enough for this to
// matter, the fan-out (criteria impact + candidate list per deal) is the
// first thing to move server-side.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDataProvider, useGetList } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { Deal } from "../types";

const OPEN_DEAL_SCAN_LIMIT = 6;
const CONFIDENT_MATCH_THRESHOLD = 0.85;
const OFFER_EXPIRY_WARNING_HOURS = 48;

export type InboxDecision = {
  id: string;
  priority: "high" | "med" | "low";
  title: string;
  subtitle: string;
  dealId: number | string | null;
  candidateId?: number | string;
  kind: "confident_matches" | "expiring_offer" | "resume_reply" | "low_pass_rate" | "stale_role";
  criterionId?: number | string;
};

const hoursUntil = (iso: string | null | undefined) => {
  if (!iso) return Infinity;
  return (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60);
};

const hoursSince = (iso: string | null | undefined) => {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
};

export const useInboxDecisions = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();

  const { data: openDeals, isPending: dealsPending } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 20 },
    sort: { field: "updated_at", order: "DESC" },
    filter: { "archived_at@is": null },
  });

  const scanDeals = useMemo(
    () => (openDeals ?? []).slice(0, OPEN_DEAL_SCAN_LIMIT),
    [openDeals],
  );

  const { data: offers } = useGetList("offers", {
    pagination: { page: 1, perPage: 50 },
    sort: { field: "updated_at", order: "DESC" },
    filter: { status: "sent" },
  });

  const { data: recentReplies } = useGetList("candidates", {
    pagination: { page: 1, perPage: 20 },
    sort: { field: "resume_received_at", order: "DESC" },
    filter: { resume_status: "received" },
  });

  // Design decision (2026-07-22, superseding the prior emergency disable):
  // getRoleBriefCriteriaImpact used to be called here for every scanned open
  // deal (up to OPEN_DEAL_SCAN_LIMIT), automatically, on every single Inbox
  // load/refresh -- one live Coresignal search per learned criterion, with
  // no cap, just from opening the dashboard. Even now that
  // source-candidates-discovery's criteria_impact mode is capped and cached
  // server-side, Harsha's call was that criteria-impact numbers should stay
  // on-demand only (see SourceCandidatesPage's Control Panel, which is the
  // one remaining place recruiters see this data, behind an explicit
  // refresh click) -- not something that silently fires just from landing
  // on the Inbox. So this hook no longer fetches it at all: candidates are
  // still fetched per deal for the confident-matches signal below, but
  // criteria impact isn't. The "low_pass_rate" decision kind that used to
  // read from it is permanently gone from this feed (not just dormant) --
  // InboxDecision/InboxPage still know how to render/act on a
  // "low_pass_rate" item defensively, but this hook will never emit one.
  const { data: perDealData, isPending: perDealPending } = useQuery({
    queryKey: ["inbox_per_deal_signals", scanDeals.map((d) => d.id)],
    queryFn: async () => {
      return Promise.all(
        scanDeals.map(async (deal) => {
          const candidates = await dataProvider
            .getCandidatesForDeal(deal.id)
            .catch(() => []);
          return { deal, candidates };
        }),
      );
    },
    enabled: scanDeals.length > 0,
  });

  const decisions = useMemo<InboxDecision[]>(() => {
    const items: InboxDecision[] = [];

    for (const offer of offers ?? []) {
      const hrsLeft = hoursUntil((offer as any).expiry_date);
      if (hrsLeft <= OFFER_EXPIRY_WARNING_HOURS) {
        items.push({
          id: `offer-${offer.id}`,
          priority: "high",
          title: `Offer expires in ${Math.max(0, Math.round(hrsLeft))}h`,
          subtitle: "No reply yet — worth a follow-up",
          dealId: (offer as any).deal_id,
          kind: "expiring_offer",
        });
      }
    }

    for (const { deal, candidates } of perDealData ?? []) {
      const confident = candidates.filter(
        (c) => (c.dealCandidate.match_score ?? 0) >= CONFIDENT_MATCH_THRESHOLD,
      );
      if (confident.length > 0) {
        items.push({
          id: `confident-${deal.id}`,
          priority: "high",
          title: `${confident.length} confident match${confident.length === 1 ? "" : "es"} ready for ${deal.name}`,
          subtitle: "All above the 85% match bar",
          dealId: deal.id,
          kind: "confident_matches",
        });
      }
    }

    for (const candidate of recentReplies ?? []) {
      if (hoursSince((candidate as any).resume_received_at) <= 24) {
        items.push({
          id: `reply-${candidate.id}`,
          priority: "med",
          title: `${[candidate.first_name, candidate.last_name].filter(Boolean).join(" ") || "A candidate"} sent their resume`,
          subtitle: "Received in the last 24 hours — open their profile to review",
          dealId: null,
          candidateId: candidate.id,
          kind: "resume_reply",
        });
      }
    }

    // "low_pass_rate" items used to be generated here from an auto-fetched
    // criteriaImpact per deal -- removed alongside that auto-fetch above.
    // Recruiters still see per-rule reject counts, just on-demand via
    // SourceCandidatesPage's Control Panel, not as a proactive Inbox alert.

    const priorityRank = { high: 0, med: 1, low: 2 };
    return items.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
  }, [offers, perDealData, recentReplies]);

  return {
    decisions,
    isPending: dealsPending || (scanDeals.length > 0 && perDealPending),
  };
};
