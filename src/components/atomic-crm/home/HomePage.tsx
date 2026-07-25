// Home page (2026-07-26): clean landing replacing the old Inbox triage
// queue. No KPI widgets or activity feeds above the fold. Role-first:
// the primary action is creating a role, not reviewing stats.
import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { Plus, Search, Linkedin, Mail, ChevronRight } from "lucide-react";
import { useGetIdentity, useGetList } from "ra-core";
import { useQuery } from "@tanstack/react-query";
import { useDataProvider } from "ra-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { Deal } from "../types";
import type { CrmDataProvider } from "../providers/types";
import type { UnipileLinkedInAccount } from "../settings/UnipileLinkedInConnectionCard";

export const HomePage = () => {
  const navigate = useNavigate();
  const { identity } = useGetIdentity();
  const [search, setSearch] = useState("");

  const { data: deals = [], isLoading } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 50 },
    sort: { field: "updated_at", order: "DESC" },
    filter: { "archived_at@is": null },
  });

  const filtered = search
    ? deals.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()))
    : deals;

  const greeting = getGreeting(identity?.fullName);

  return (
    <div className="max-w-2xl mx-auto px-6 pt-12 pb-16 flex flex-col gap-10">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {greeting}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What are you hiring for today?
        </p>
      </div>

      {/* Primary CTA */}
      <div className="flex gap-3">
        <Button
          size="lg"
          className="gap-2 shadow-sm"
          onClick={() => navigate("/jd-intake")}
        >
          <Plus className="h-4 w-4" />
          New role
        </Button>
      </div>

      {/* Search */}
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search your roles…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10"
          />
        </div>

        {/* Roles list */}
        {!isLoading && filtered.length > 0 && (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
            {filtered.slice(0, 8).map((deal) => (
              <RoleRow key={deal.id} deal={deal} />
            ))}
          </ul>
        )}
        {!isLoading && filtered.length === 0 && search && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No roles match "{search}"
          </p>
        )}
        {!isLoading && deals.length === 0 && !search && (
          <div className="text-center py-8 flex flex-col gap-3 text-muted-foreground">
            <p className="text-sm">No open roles yet.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/jd-intake")}
              className="mx-auto gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              Create your first role
            </Button>
          </div>
        )}
      </div>

      {/* Integrations strip */}
      <IntegrationsStrip />
    </div>
  );
};

/* ------------------------------------------------------------------ */

function RoleRow({ deal }: { deal: Deal }) {
  return (
    <li>
      <Link
        to={`/roles/${deal.id}`}
        className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-accent/50 transition-colors no-underline group"
      >
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-foreground truncate">
            {deal.name}
          </span>
          {deal.stage && (
            <span className="block text-xs text-muted-foreground mt-0.5">
              {deal.stage}
            </span>
          )}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors shrink-0" />
      </Link>
    </li>
  );
}

function IntegrationsStrip() {
  const dataProvider = useDataProvider<CrmDataProvider>();

  const { data: linkedInAccount } = useQuery<UnipileLinkedInAccount>({
    queryKey: ["unipile_linkedin_account"],
    queryFn: () =>
      dataProvider.getUnipileLinkedInAccount() as Promise<UnipileLinkedInAccount>,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const liConnected =
    (linkedInAccount as UnipileLinkedInAccount | undefined)?.status ===
    "connected";

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Connected accounts
      </h2>
      <div className="flex flex-wrap gap-2">
        <IntegrationChip
          icon={<Linkedin className="h-3.5 w-3.5" />}
          label="LinkedIn"
          connected={liConnected}
          settingsPath="/preferences?tab=accounts"
        />
        <IntegrationChip
          icon={<Mail className="h-3.5 w-3.5" />}
          label="Email"
          connected={false}
          settingsPath="/preferences?tab=accounts"
        />
      </div>
    </div>
  );
}

function IntegrationChip({
  icon,
  label,
  connected,
  settingsPath,
}: {
  icon: React.ReactNode;
  label: string;
  connected: boolean;
  settingsPath: string;
}) {
  return (
    <Link
      to={settingsPath}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium no-underline transition-colors",
        connected
          ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-900 dark:bg-green-950/40 dark:text-green-400"
          : "border-border bg-muted/50 text-muted-foreground hover:bg-muted",
      )}
    >
      {icon}
      {label}
      <Badge
        variant={connected ? "default" : "outline"}
        className={cn(
          "h-4 text-[10px] px-1.5 ml-0.5",
          connected
            ? "bg-green-600 text-white dark:bg-green-700"
            : "border-muted-foreground/40 text-muted-foreground",
        )}
      >
        {connected ? "Connected" : "Connect"}
      </Badge>
    </Link>
  );
}

function getGreeting(name?: string | null): string {
  const hour = new Date().getHours();
  const first = name?.split(" ")[0];
  const salutation = first ? `, ${first}` : "";
  if (hour < 12) return `Good morning${salutation}`;
  if (hour < 17) return `Good afternoon${salutation}`;
  return `Good evening${salutation}`;
}

HomePage.path = "/";
