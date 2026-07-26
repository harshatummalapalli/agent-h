// Phase 2 (2026-07-26): Outbound Analytics page.
// Computes KPI cards from deal_candidates + outreach fields that already
// exist in the database. No new backend calls — reads what ra-core gives us.
// Date-range filter is client-side: "Last 30 days" default, "Last 90 days",
// "All time". Zeros and empty states are explicit and honest.
import { useMemo, useState } from "react";
import { useGetList } from "ra-core";
import { subDays, parseISO, isAfter } from "date-fns";
import {
  BarChart2,
  Mail,
  MessageCircle,
  ThumbsUp,
  Users,
  Wifi,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { DealCandidate, Deal } from "../types";

type DateRange = "30d" | "90d" | "all";

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

function cutoff(range: DateRange): Date | null {
  const now = new Date();
  if (range === "30d") return subDays(now, 30);
  if (range === "90d") return subDays(now, 90);
  return null;
}

function inRange(
  dateStr: string | null | undefined,
  cut: Date | null,
): boolean {
  if (!cut) return true;
  if (!dateStr) return false;
  try {
    return isAfter(parseISO(dateStr), cut);
  } catch {
    return false;
  }
}

type KpiCardProps = {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
};

const KpiCard = ({ icon, label, value, sub }: KpiCardProps) => (
  <div className="rounded-xl border bg-card p-5 flex flex-col gap-2">
    <div className="flex items-center gap-2 text-muted-foreground">
      {icon}
      <span className="text-xs font-medium uppercase tracking-wide">
        {label}
      </span>
    </div>
    <div className="text-3xl font-semibold tabular-nums">{value}</div>
    {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
  </div>
);

export const AnalyticsPage = () => {
  const [range, setRange] = useState<DateRange>("30d");
  const cut = useMemo(() => cutoff(range), [range]);

  // Load all deal_candidates (outreach tracking rows)
  const { data: allLinks, isPending: linksPending } = useGetList<DealCandidate>(
    "deal_candidates",
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "created_at", order: "DESC" },
    },
  );

  // Load open deals for grouping
  const { data: deals } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "updated_at", order: "DESC" },
    filter: { "archived_at@is": null },
  });

  const links = useMemo(() => {
    if (!allLinks) return [];
    return allLinks.filter((l) => inRange(l.created_at, cut));
  }, [allLinks, cut]);

  const contacted = links.filter(
    (l) => l.response_status === "sent" || l.response_status === "responded",
  );
  const responded = links.filter((l) => l.response_status === "responded");

  const sentCount = contacted.length;
  const respondedCount = responded.length;
  const totalInRange = links.length;

  const openRate =
    sentCount > 0 ? Math.round((respondedCount / sentCount) * 100) : 0;

  // Connections accepted: deal_candidates with outreach_channel = linkedin_connection
  // and responded (best proxy we have without a dedicated "accepted" status)
  const linkedinSent = links.filter(
    (l) =>
      l.outreach_channel === "linkedin_connection" ||
      l.outreach_channel === "linkedin_inmail",
  );
  const connectionsAccepted = linkedinSent.filter(
    (l) => l.response_status === "responded",
  ).length;

  // Group by role for table
  const byRole = useMemo(() => {
    const dealsById = new Map((deals ?? []).map((d) => [String(d.id), d]));
    const map = new Map<
      string,
      { deal: Deal; total: number; contacted: number; responded: number }
    >();
    for (const l of links) {
      const dealId = String(l.deal_id);
      const deal = dealsById.get(dealId);
      if (!deal) continue;
      const row = map.get(dealId) ?? {
        deal,
        total: 0,
        contacted: 0,
        responded: 0,
      };
      row.total++;
      if (l.response_status === "sent" || l.response_status === "responded")
        row.contacted++;
      if (l.response_status === "responded") row.responded++;
      map.set(dealId, row);
    }
    return [...map.values()].sort((a, b) => b.contacted - a.contacted);
  }, [links, deals]);

  const hasActivity = totalInRange > 0;

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto px-6 py-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <BarChart2 className="h-5 w-5 text-muted-foreground" />
            Outbound Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sourcing and outreach activity across all your open roles
          </p>
        </div>

        {/* Date range picker */}
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          {(["30d", "90d", "all"] as DateRange[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                range === r
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {DATE_RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      {linksPending ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiCard
            icon={<Users className="h-4 w-4" />}
            label="Sourced"
            value={totalInRange}
            sub="Candidates added to pipeline"
          />
          <KpiCard
            icon={<Mail className="h-4 w-4" />}
            label="Contacted"
            value={sentCount}
            sub="Outreach sent"
          />
          <KpiCard
            icon={<Wifi className="h-4 w-4" />}
            label="Open rate"
            value={sentCount > 0 ? `${openRate}%` : "—"}
            sub="Responses / sent"
          />
          <KpiCard
            icon={<MessageCircle className="h-4 w-4" />}
            label="Responses"
            value={respondedCount}
            sub="Replied to outreach"
          />
          <KpiCard
            icon={<ThumbsUp className="h-4 w-4" />}
            label="Connections"
            value={connectionsAccepted}
            sub="LinkedIn accepted"
          />
        </div>
      )}

      {/* By-role breakdown */}
      {!linksPending && (
        <>
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide -mb-2">
            By role
          </h2>

          {!hasActivity ? (
            <div className="rounded-xl border bg-muted/20 py-12 text-center">
              <BarChart2 className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No outreach activity in the selected period yet.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Go to a role's Sourcing tab to find candidates and contact them.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Role
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      Sourced
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      Contacted
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      Responses
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      Response rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {byRole.map(({ deal, total, contacted: c, responded: r }) => (
                    <tr
                      key={deal.id}
                      className="border-b last:border-b-0 hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium">{deal.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {total}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{c}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {c > 0 ? `${Math.round((r / c) * 100)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

AnalyticsPage.path = "/analytics";
