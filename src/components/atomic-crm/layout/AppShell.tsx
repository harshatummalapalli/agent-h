// AppShell (2026-07-26): Noon-style role-first layout replacing the old
// top-tab Header. Narrow 48px icon rail on the left; expandable 240px
// sidebar with the roles list; main content takes the rest.
// Orange active states (--sidebar-primary) on the rail + sidebar;
// deep-navy primary CTAs throughout the app via --primary.
// Mobile: icon rail collapses to a hamburger overlay sheet.
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  BarChart2,
  ChevronLeft,
  Home,
  Menu,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react";
import { useGetList, useGetIdentity } from "ra-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserMenu } from "@/components/admin/user-menu";
import { ThemeModeToggle } from "@/components/admin/theme-mode-toggle";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { Deal } from "../types";
import { useConfigurationContext } from "../root/ConfigurationContext";

type Tab = "all" | "mine";

export const AppShell = ({ children }: { children: React.ReactNode }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Icon rail — always visible on desktop; hidden on mobile */}
      <aside className="hidden md:flex w-12 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar py-3 gap-1 z-20">
        <RailTop
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          sidebarOpen={sidebarOpen}
          currentPath={location.pathname}
        />
        <div className="flex-1" />
        <RailBottom />
      </aside>

      {/* Mobile hamburger button */}
      <button
        className="md:hidden fixed top-3 left-3 z-50 rounded-lg border border-border bg-background p-2 shadow-sm"
        onClick={() => setMobileOpen((v) => !v)}
        aria-label="Open navigation"
      >
        {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {/* Roles sidebar */}
      <aside
        className={cn(
          "shrink-0 border-r border-sidebar-border bg-sidebar overflow-hidden transition-all duration-200 z-30",
          // Desktop: inline, collapsible
          sidebarOpen ? "hidden md:flex md:w-60 flex-col" : "hidden md:hidden",
          // Mobile: overlay sheet
          mobileOpen
            ? "fixed inset-y-0 left-0 flex flex-col w-72 md:hidden"
            : "",
        )}
      >
        <RolesSidebar onClose={() => setMobileOpen(false)} />
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-auto">
        {children}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Icon rail                                                           */
/* ------------------------------------------------------------------ */

function RailTop({
  onToggleSidebar,
  sidebarOpen,
  currentPath,
}: {
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  currentPath: string;
}) {
  const { darkModeLogo, lightModeLogo, title } = useConfigurationContext();

  return (
    <>
      {/* Logo / collapse toggle */}
      <button
        onClick={onToggleSidebar}
        className="mb-2 rounded-lg p-1.5 hover:bg-sidebar-accent text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
        aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        {sidebarOpen ? (
          <ChevronLeft className="h-4 w-4" />
        ) : (
          <>
            <img
              className="[.light_&]:hidden h-5 w-5 object-contain"
              src={darkModeLogo}
              alt={title}
            />
            <img
              className="[.dark_&]:hidden h-5 w-5 object-contain"
              src={lightModeLogo}
              alt={title}
            />
          </>
        )}
      </button>

      <RailIcon
        to="/"
        icon={<Home className="h-4 w-4" />}
        label="Home"
        active={currentPath === "/"}
      />
      <RailIcon
        to="/jd-intake"
        icon={<Plus className="h-4 w-4" />}
        label="New role"
        active={currentPath.startsWith("/jd-intake")}
      />
    </>
  );
}

function RailBottom() {
  const location = useLocation();
  return (
    <>
      <RailIcon
        to="/analytics"
        icon={<BarChart2 className="h-4 w-4" />}
        label="Analytics (coming soon)"
        active={false}
        disabled
      />
      <RailIcon
        to="/preferences"
        icon={<Settings className="h-4 w-4" />}
        label="Preferences"
        active={location.pathname.startsWith("/preferences")}
      />
      <div className="mt-1">
        <UserMenu>
          <ProfileMenuItem />
        </UserMenu>
      </div>
      <ThemeModeToggle />
    </>
  );
}

function RailIcon({
  to,
  icon,
  label,
  active,
  disabled,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span
        title={label}
        aria-label={label}
        className="rounded-lg p-2.5 text-sidebar-foreground/30 cursor-not-allowed"
      >
        {icon}
      </span>
    );
  }
  return (
    <Link
      to={to}
      title={label}
      aria-label={label}
      className={cn(
        "rounded-lg p-2.5 transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-primary"
          : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
    >
      {icon}
    </Link>
  );
}

function ProfileMenuItem() {
  return (
    <DropdownMenuItem asChild>
      <Link to="/profile" className="flex items-center gap-2">
        Profile
      </Link>
    </DropdownMenuItem>
  );
}

/* ------------------------------------------------------------------ */
/* Roles sidebar                                                        */
/* ------------------------------------------------------------------ */

function RolesSidebar({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const { identity } = useGetIdentity();
  const { darkModeLogo, lightModeLogo, title } = useConfigurationContext();

  const { data: deals = [] } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 50 },
    sort: { field: "updated_at", order: "DESC" },
    filter: { "archived_at@is": null },
  });

  const filtered = deals.filter((d) => {
    if (tab === "mine" && identity?.id && d.sales_id !== identity.id)
      return false;
    if (search && !d.name.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  const activeRoleId = location.pathname.match(/^\/roles\/([^/]+)/)?.[1];

  return (
    <div className="flex flex-col h-full">
      {/* Header with logo + close (mobile only) */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-sidebar-border">
        <Link
          to="/"
          className="flex items-center gap-1.5 flex-1 min-w-0"
          onClick={onClose}
        >
          <img
            className="[.light_&]:hidden h-5 shrink-0"
            src={darkModeLogo}
            alt={title}
          />
          <img
            className="[.dark_&]:hidden h-5 shrink-0"
            src={lightModeLogo}
            alt={title}
          />
          <span className="font-semibold text-sm text-sidebar-foreground truncate">
            Agent H
          </span>
        </Link>
        <button
          className="md:hidden text-sidebar-foreground/50 hover:text-sidebar-foreground"
          onClick={onClose}
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* New role CTA */}
      <div className="px-3 py-2">
        <Button
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => {
            navigate("/jd-intake");
            onClose();
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          New role
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-sidebar-foreground/40 pointer-events-none" />
          <Input
            placeholder="Search roles…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-sm bg-sidebar-accent/50 border-sidebar-border focus-visible:ring-sidebar-ring"
          />
        </div>
      </div>

      {/* All / Yours tabs */}
      <div className="flex gap-0 px-3 pb-2">
        {(["all", "mine"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 py-1 text-xs font-medium rounded-md transition-colors",
              tab === t
                ? "bg-sidebar-accent text-sidebar-primary"
                : "text-sidebar-foreground/50 hover:text-sidebar-foreground",
            )}
          >
            {t === "all" ? "All" : "Yours"}
          </button>
        ))}
      </div>

      {/* Roles list */}
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {filtered.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-sidebar-foreground/40">
            {search ? "No matching roles" : "No open roles"}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {filtered.map((deal) => {
              const isActive = activeRoleId === String(deal.id);
              return (
                <li key={deal.id}>
                  <Link
                    to={`/roles/${deal.id}`}
                    onClick={onClose}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors no-underline",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-primary font-medium"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )}
                  >
                    <span className="truncate">{deal.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      {/* Bottom: credits placeholder */}
      <div className="px-3 py-2 border-t border-sidebar-border">
        <div className="text-xs text-sidebar-foreground/40 text-center">
          Credits: —
        </div>
      </div>
    </div>
  );
}
