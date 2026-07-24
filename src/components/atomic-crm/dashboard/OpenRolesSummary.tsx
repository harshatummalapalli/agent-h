// Agent H: replaces the CRM-flavored dashboard widgets (DealsChart's
// "Upcoming Deal Revenue" forecast, HotContacts) with the thing a recruiter
// actually wants to see first: which roles are open right now, and how
// sourcing is going. See "remove all CRM specific language" pass
// (2026-07-12) -- this is Phase 1 (Sourcing/Screening) home-screen content;
// root/productScope.ts tracks what later phases still need.
import { Briefcase, Users2 } from "lucide-react";
import { Link } from "react-router";
import { useGetList } from "ra-core";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";

const StatCard = ({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Briefcase;
  label: string;
  value: number | undefined;
}) => (
  <Card>
    <CardContent className="flex items-center gap-3 py-4">
      <Icon className="w-5 h-5 text-muted-foreground shrink-0" />
      <div className="flex flex-col">
        {value === undefined ? (
          <Skeleton className="h-6 w-10" />
        ) : (
          <span className="text-2xl font-semibold leading-none">{value}</span>
        )}
        <span className="text-xs text-muted-foreground mt-1">{label}</span>
      </div>
    </CardContent>
  </Card>
);

export const OpenRolesSummary = () => {
  const { dealStages } = useConfigurationContext();
  const {
    data: roles,
    total: totalRoles,
    isPending,
  } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 8 },
    sort: { field: "updated_at", order: "DESC" },
    filter: { "archived_at@is": null },
  });
  const { total: totalCandidates } = useGetList("candidates", {
    pagination: { page: 1, perPage: 1 },
  });

  const stageLabel = (value: string) =>
    dealStages.find((s) => s.value === value)?.label ?? value;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <StatCard icon={Briefcase} label="Open roles" value={totalRoles} />
        <StatCard
          icon={Users2}
          label="Candidates sourced"
          value={totalCandidates}
        />
      </div>

      <div className="flex flex-col">
        <h2 className="text-xl font-semibold text-muted-foreground mb-2">
          Open roles
        </h2>
        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : !roles || roles.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              No open roles yet.{" "}
              <Link to="/jd-intake" className="underline">
                Create one from a job description
              </Link>
              .
            </CardContent>
          </Card>
        ) : (
          <Card className="p-2">
            <div className="flex flex-col divide-y">
              {roles.map((role) => (
                <Link
                  key={role.id}
                  to={`/roles/${role.id}`}
                  className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm hover:bg-accent rounded-md"
                >
                  <span className="font-medium">{role.name}</span>
                  <Badge variant="outline">{stageLabel(role.stage)}</Badge>
                </Link>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};
