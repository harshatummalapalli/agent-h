// Home page (2026-07-26): conversational new-role entry as the primary path.
// User types a role description (or pastes a JD) in the command bar;
// parseJobDescription parses it, the agent asks clarifying questions, and
// the user clicks "Start sourcing" to create the role and navigate.
// The roles list and integrations strip remain for quick access to existing roles.
import { useRef, useState } from "react";
import { useNavigate, Link } from "react-router";
import { Plus, Search, Linkedin, Mail, ChevronRight, Send } from "lucide-react";
import {
  useGetIdentity,
  useGetList,
  useDataProvider,
  useNotify,
} from "ra-core";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { Deal } from "../types";
import type { CrmDataProvider } from "../providers/types";
import type { UnipileLinkedInAccount } from "../settings/UnipileLinkedInConnectionCard";
import "../inbox/agent-h-theme.css";

type ConvTurn = { role: "user" | "agent"; text: string };

type ParsedBrief = {
  title: string;
  seniority: string;
  location: string;
  industry: string | null;
  employment_type: string;
  years_experience_min: number | null;
  years_experience_max: number | null;
  required_skills: string[];
  must_have_keywords: string[];
  nice_to_have_keywords: string[];
  preference_tiers: Array<{
    rank: number;
    label: string;
    keywords: string[];
    condition: string | null;
  }>;
  clarifying_questions: string[];
  company_type?: string | null;
  company_size_min?: number | null;
  company_size_max?: number | null;
  excluded_companies?: string[];
  exclusion_keywords?: string[];
  past_titles?: string[];
  past_companies?: string[];
};

export const HomePage = () => {
  const navigate = useNavigate();
  const notify = useNotify();
  const { identity } = useGetIdentity();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [search, setSearch] = useState("");
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ConvTurn[]>([]);
  const [parsed, setParsed] = useState<ParsedBrief | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: deals = [], isLoading } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 50 },
    sort: { field: "updated_at", order: "DESC" },
    filter: { "archived_at@is": null },
  });

  const filtered = search
    ? deals.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()))
    : deals;

  const greeting = getGreeting(identity?.fullName);

  const addTurn = (turn: ConvTurn) => {
    setTurns((prev) => [...prev, turn]);
    setTimeout(
      () => bottomRef.current?.scrollIntoView({ behavior: "smooth" }),
      50,
    );
  };

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    addTurn({ role: "user", text });
    setBusy(true);
    try {
      const result = await dataProvider.parseJobDescription(text);
      setParsed(result as ParsedBrief);
      const skillsSummary =
        (
          (result.required_skills ??
            result.must_have_keywords ??
            []) as string[]
        )
          .slice(0, 5)
          .join(", ") || "not specified";
      const expSummary =
        result.years_experience_min != null ||
        result.years_experience_max != null
          ? `${result.years_experience_min ?? 0}–${result.years_experience_max ?? "∞"} years`
          : "not specified";
      const summaryLines = [
        `**Role:** ${result.title || "untitled"}`,
        `**Seniority:** ${result.seniority || "not specified"}`,
        `**Location:** ${result.location || "not specified"}`,
        `**Experience:** ${expSummary}`,
        `**Key skills:** ${skillsSummary}`,
      ].join("\n");
      const questionsBlock = (
        result.clarifying_questions as string[] | undefined
      )?.length
        ? `\n\nA few things I want to confirm:\n${(result.clarifying_questions as string[]).map((q) => `• ${q}`).join("\n")}\n\nAnswer any of these, or click "Start sourcing" when you're ready.`
        : '\n\nEverything looks clear — click "Start sourcing" when you\'re ready, or tell me anything to adjust.';
      addTurn({
        role: "agent",
        text: `Got it — here's what I understood:\n\n${summaryLines}${questionsBlock}`,
      });
    } catch {
      addTurn({
        role: "agent",
        text: 'I couldn\'t parse that right now. You can also use the "Paste full JD" button to create a role from a job description.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleStartSourcing = async () => {
    if (!parsed || creating) return;
    setCreating(true);
    try {
      const created = await dataProvider.create("deals", {
        data: {
          name: parsed.title || "New Role",
          stage: "sourcing",
          seniority: parsed.seniority,
          location: parsed.location,
          industry: parsed.industry,
          employment_type: parsed.employment_type,
          years_experience_min: parsed.years_experience_min,
          years_experience_max: parsed.years_experience_max,
          required_skills: parsed.required_skills ?? [],
          must_have_keywords: parsed.must_have_keywords ?? [],
          nice_to_have_keywords: parsed.nice_to_have_keywords ?? [],
          preference_tiers: parsed.preference_tiers?.length
            ? parsed.preference_tiers
            : null,
          clarifying_questions: parsed.clarifying_questions?.length
            ? parsed.clarifying_questions
            : null,
          company_type: parsed.company_type ?? null,
          company_size_min: parsed.company_size_min ?? null,
          company_size_max: parsed.company_size_max ?? null,
          excluded_companies: parsed.excluded_companies ?? [],
          exclusion_keywords: parsed.exclusion_keywords ?? [],
          past_titles: parsed.past_titles ?? [],
          past_companies: parsed.past_companies ?? [],
          role_status: "new",
          contact_ids: [],
        },
      });
      notify("Role created", { type: "success" });
      navigate(`/roles/${created.data.id}`);
    } catch {
      notify("Couldn't create the role — please try again", { type: "error" });
      setCreating(false);
    }
  };

  const hasConversation = turns.length > 0;

  return (
    <div
      className="ah-scope"
      style={{
        display: "grid",
        gridTemplateRows: hasConversation ? "auto 1fr auto" : "1fr auto",
        minHeight: "calc(100dvh - 8rem)",
      }}
    >
      {/* Scrollable content */}
      <div className="overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 pt-12 pb-4 flex flex-col gap-10">
          {/* Greeting */}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {greeting}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              What are you hiring for today?
            </p>
          </div>

          {/* Secondary CTA — visible only when no conversation yet */}
          {!hasConversation && (
            <div className="flex gap-3">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => navigate("/jd-intake")}
              >
                <Plus className="h-3.5 w-3.5" />
                Paste full JD
              </Button>
            </div>
          )}

          {/* Conversation transcript */}
          {hasConversation && (
            <div className="flex flex-col gap-4">
              {turns.map((turn, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-xl px-4 py-3 text-sm whitespace-pre-wrap max-w-[88%]",
                    turn.role === "user"
                      ? "self-end bg-primary text-primary-foreground ml-auto"
                      : "self-start bg-muted text-foreground",
                  )}
                >
                  {turn.text}
                </div>
              ))}
              {busy && (
                <div className="self-start bg-muted text-muted-foreground rounded-xl px-4 py-3 text-sm animate-pulse">
                  Thinking…
                </div>
              )}
              {parsed && !busy && (
                <Button
                  className="self-start gap-2 mt-1"
                  onClick={handleStartSourcing}
                  disabled={creating}
                >
                  {creating ? "Creating role…" : "Start sourcing →"}
                </Button>
              )}
              <div ref={bottomRef} />
            </div>
          )}

          {/* Search + roles list — always visible */}
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
            {!isLoading &&
              deals.length === 0 &&
              !search &&
              !hasConversation && (
                <div className="text-center py-8 flex flex-col gap-3 text-muted-foreground">
                  <p className="text-sm">
                    No open roles yet — describe one below.
                  </p>
                </div>
              )}
          </div>

          {/* Integrations strip */}
          <IntegrationsStrip />
        </div>
      </div>

      {/* Command bar — primary conversational entry */}
      <div className="border-t bg-background px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder={
              hasConversation
                ? "Answer a question or adjust anything…"
                : 'Describe a role — e.g. "Senior backend engineer, Python, remote, 5+ years"'
            }
            disabled={busy || creating}
            className={cn(
              "flex-1 resize-none rounded-xl border bg-muted/50 px-4 py-2.5 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
              "disabled:opacity-50 min-h-[42px] max-h-32 overflow-y-auto",
            )}
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <Button
            size="icon"
            className="shrink-0 h-[42px] w-[42px] rounded-xl"
            onClick={handleSubmit}
            disabled={!input.trim() || busy || creating}
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="max-w-2xl mx-auto mt-1.5 text-[11px] text-muted-foreground/60">
          Enter to send · Shift+Enter for newline · or{" "}
          <button
            type="button"
            className="underline hover:text-muted-foreground"
            onClick={() => navigate("/jd-intake")}
          >
            paste a full JD
          </button>
        </p>
      </div>
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
