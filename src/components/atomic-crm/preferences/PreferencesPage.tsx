// Preferences page (2026-07-26): replaces the scattered /settings +
// /profile split. Six tabs: General (branding), Connected Accounts
// (LinkedIn + email), Team, Display, Security (stub), Integrations (stub).
// Surfaced from the AppShell sidebar bottom Settings icon.
import { useSearchParams } from "react-router";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { SettingsPage } from "../settings/SettingsPage";
import { UnipileLinkedInConnectionCard } from "../settings/UnipileLinkedInConnectionCard";
import { ThemeModeToggle } from "@/components/admin/theme-mode-toggle";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, Shield, Puzzle } from "lucide-react";
import { SalesListForPreferences } from "./SalesListForPreferences";

type PrefTab =
  | "general"
  | "accounts"
  | "team"
  | "display"
  | "security"
  | "integrations";

const TABS: { value: PrefTab; label: string }[] = [
  { value: "general", label: "General" },
  { value: "accounts", label: "Connected Accounts" },
  { value: "team", label: "Team" },
  { value: "display", label: "Display" },
  { value: "security", label: "Security" },
  { value: "integrations", label: "Integrations" },
];

export const PreferencesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") as PrefTab | null) ?? "general";

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight mb-6">
        Preferences
      </h1>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="h-auto gap-0 bg-transparent p-0 rounded-none border-b border-border w-full justify-start mb-6">
          {TABS.map(({ value, label }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--orange-active)] data-[state=active]:text-[var(--orange-active)] data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* General — existing branding/settings form */}
        <TabsContent value="general">
          <SettingsPage />
        </TabsContent>

        {/* Connected Accounts */}
        <TabsContent value="accounts" className="flex flex-col gap-4">
          <UnipileLinkedInConnectionCard />
          <EmailStatusCard />
        </TabsContent>

        {/* Team */}
        <TabsContent value="team">
          <SalesListForPreferences />
        </TabsContent>

        {/* Display */}
        <TabsContent value="display">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Choose your preferred appearance.
            </p>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">Theme</span>
              <ThemeModeToggle />
            </div>
          </div>
        </TabsContent>

        {/* Security */}
        <TabsContent value="security">
          <StubCard
            icon={<Shield className="h-6 w-6 text-muted-foreground" />}
            title="Security"
            description="Password change and two-factor authentication will appear here in a future update."
          />
        </TabsContent>

        {/* Integrations */}
        <TabsContent value="integrations">
          <StubCard
            icon={<Puzzle className="h-6 w-6 text-muted-foreground" />}
            title="Integrations"
            description="ATS integrations, MCP connections, blocklist management, and Chrome extension settings will be available here."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

function EmailStatusCard() {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start gap-3">
          <Mail className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-medium">Email outreach</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Email delivery is handled automatically via Resend when configured
              in your Supabase environment. No additional setup required here.
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StubCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="py-8 flex flex-col items-center text-center gap-3">
        {icon}
        <div className="text-sm font-medium">{title}</div>
        <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
      </CardContent>
    </Card>
  );
}

PreferencesPage.path = "/preferences";
