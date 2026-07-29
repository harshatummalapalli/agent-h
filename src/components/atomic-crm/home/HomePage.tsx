// Home page: conversational new-role interview as the primary path.
// One clarifying question at a time; roles list hidden during active conversation.
import { useRef, useState } from "react";
import { useNavigate, Link } from "react-router";
import { Linkedin, Mail, ChevronRight, Send, Search } from "lucide-react";
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
import type { CalibrationCandidate } from "../providers/supabase/dataProvider";
import { parsedBriefToConditions } from "../jd-intake/parsedBriefToConditions";
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

const JD_QUESTION =
  "Do you have a formal job description, or anything specific you want me to screen for — technical tests, culture fit signals, deal-breakers?";

const EXPECTATION_TURN =
  "One thing to set expectations on — I'll look for people who might be open. Notice period and compensation we confirm directly with them once they're engaged. Passive outreach can't guarantee immediate joiners or a specific CTC, but we'll surface the best fits and verify the details in conversation.";

function checkUnrealisticConstraints(text: string): boolean {
  return (
    /immediate\s+joiner|join\s+immediately|available\s+immediately|notice\s+period.*\b0\b|no\s+notice\s+period/i.test(
      text,
    ) || /\b\d+\s*(lpa|lakh|lac|ctc|k\b|thousand|usd|inr)\b/i.test(text)
  );
}

function buildSummary(result: ParsedBrief): string {
  const skillsSummary =
    ((result.required_skills ?? result.must_have_keywords ?? []) as string[])
      .slice(0, 5)
      .join(", ") || "not specified";
  const expSummary =
    result.years_experience_min != null || result.years_experience_max != null
      ? `${result.years_experience_min ?? 0}–${result.years_experience_max ?? "∞"} years`
      : "not specified";
  return [
    `Role: ${result.title || "untitled"}`,
    `Seniority: ${result.seniority || "not specified"}`,
    `Location: ${result.location || "not specified"}`,
    `Experience: ${expSummary}`,
    `Key skills: ${skillsSummary}`,
  ].join("\n");
}

export const HomePage = () => {
  const navigate = useNavigate();
  const notify = useNotify();
  const { identity } = useGetIdentity();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [search, setSearch] = useState("");
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ConvTurn[]>([]);
  const [parsed, setParsed] = useState<ParsedBrief | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const expectationShownRef = useRef(false);

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
      const isFirstMessage = turns.length === 0;

      // Multi-turn merge: when a prior brief exists, prefix it so the
      // LLM updates only the affected fields.
      const inputForParse = parsed
        ? `[Existing role brief — update only the fields affected by the hiring manager's follow-up, keep all other fields as-is]\n${JSON.stringify(parsed)}\n\nHiring manager follow-up: ${text}`
        : text;

      const result = await dataProvider.parseJobDescription(inputForParse);
      setParsed(result as ParsedBrief);

      // Expectation setting: fire once per conversation if unrealistic
      // constraints are detected (immediate joiner, hard salary band).
      if (checkUnrealisticConstraints(text) && !expectationShownRef.current) {
        expectationShownRef.current = true;
        addTurn({ role: "agent", text: EXPECTATION_TURN });
      }

      if (isFirstMessage) {
        const clarifyingQs =
          (result.clarifying_questions as string[] | undefined) ?? [];

        // Inject JD question at the front when the user didn't paste a full JD.
        const hasJdSignal =
          text.length >= 300 ||
          /responsibilities|requirements|qualifications/i.test(text);
        const fullQueue: string[] = hasJdSignal
          ? clarifyingQs
          : [JD_QUESTION, ...clarifyingQs];

        const [firstQ, ...remainingQs] = fullQueue;
        const summary = buildSummary(result as ParsedBrief);

        if (firstQ) {
          addTurn({
            role: "agent",
            text: `Got it — here's what I understood:\n\n${summary}\n\n${firstQ}`,
          });
          setPendingQuestions(remainingQs);
        } else {
          addTurn({
            role: "agent",
            text: `Got it — here's what I understood:\n\n${summary}\n\nLooks clear. Click "Start sourcing" when you're ready, or tell me anything to adjust.`,
          });
          setPendingQuestions([]);
        }
      } else {
        // Follow-up: advance through the question queue.
        const nextQ = pendingQuestions[0] ?? null;

        if (nextQ) {
          addTurn({ role: "agent", text: nextQ });
          setPendingQuestions((prev) => prev.slice(1));
        } else {
          addTurn({
            role: "agent",
            text: "Got it — I've updated the brief. We're good to go whenever you're ready.",
          });
        }
      }
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
      const jdText = turns
        .filter((t) => t.role === "user")
        .map((t) => t.text)
        .join("\n\n");
      const created = await dataProvider.create("deals", {
        data: {
          name: parsed.title || "New Role",
          stage: "sourcing",
          jd_text: jdText || null,
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
      const dealId = created.data.id;

      // Seed the transcript and kick off sourcing before navigating
      // so the user arrives at a role page with content, not a blank screen.
      try {
        await dataProvider.appendAgentConversationTurn(dealId, {
          content:
            "Starting sourcing — searching for people who match your brief…",
          metadata: { kind: "agent" },
        });

        const batch = await dataProvider.startCalibrationSourcing(dealId);

        if (batch.candidates.length > 0) {
          const prefix = batch.bench_note ? `${batch.bench_note} ` : "";
          await dataProvider.appendAgentConversationTurn(dealId, {
            content: `${prefix}Found ${batch.pool_size ?? batch.candidates.length} people. Here are the first ${batch.candidates.length}:`,
            metadata: { kind: "agent" },
          });
          // Seed one candidate-card turn per result.
          for (const c of batch.candidates as CalibrationCandidate[]) {
            await dataProvider.appendAgentConversationTurn(dealId, {
              content: `${c.name}${c.headline ? ` — ${c.headline}` : ""}${c.why_fit ? `\n${c.why_fit}` : ""}`,
              metadata: {
                kind: "candidate_card",
                candidate_card: {
                  candidate_id: 0,
                  deal_id: Number(dealId),
                  name: c.name,
                  headline: c.headline ?? null,
                  linkedin_url: c.linkedin_url ?? null,
                  match_score: c.match_score ?? null,
                  must_haves: [],
                  calibration_external_id: c.external_id,
                  why_fit: c.why_fit ?? null,
                },
              },
            });
          }
        } else {
          await dataProvider.appendAgentConversationTurn(dealId, {
            content:
              batch.bench_note ??
              "I couldn't find candidates right now — try relaxing the criteria once inside.",
            metadata: { kind: "agent" },
          });
        }
      } catch {
        // Transcript seeding failed — navigate anyway; sourcing can be
        // triggered from the role page.
      }

      // Fire-and-forget: seed SearchIntent chips from the parsed brief so
      // the role's Search tab prefills immediately without an LLM round-trip.
      const seedConditions = parsedBriefToConditions(parsed);
      if (seedConditions.length > 0) {
        dataProvider
          .saveSearchIntent(dealId, seedConditions, [])
          .catch((err: unknown) =>
            console.warn("[home] saveSearchIntent failed:", err),
          );
      }

      navigate(`/roles/${dealId}`);
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
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {greeting}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                What are you hiring for today?
              </p>
            </div>
            {/* Compact roles link — replaces full list during conversation */}
            {hasConversation && deals.length > 0 && (
              <Link
                to="/"
                onClick={() => setTurns([])}
                className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1 no-underline"
              >
                Your roles
                <ChevronRight className="h-3 w-3" />
              </Link>
            )}
          </div>

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
                  {creating ? "Searching…" : "Start sourcing →"}
                </Button>
              )}
              <div ref={bottomRef} />
            </div>
          )}

          {/* Roles search + list — hidden while conversation is active */}
          {!hasConversation && (
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
                  No roles match &ldquo;{search}&rdquo;
                </p>
              )}
              {!isLoading && deals.length === 0 && !search && (
                <div className="text-center py-8 flex flex-col gap-3 text-muted-foreground">
                  <p className="text-sm">
                    No open roles yet — describe one below.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Build Search CTA — quick access for manual Crustdata searches */}
          {!hasConversation && (
            <Link
              to="/build-search"
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 no-underline hover:bg-accent/40 transition-colors group"
            >
              <div className="flex items-center gap-2.5">
                <Search className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground leading-tight">
                    Build your search
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Tune Crustdata filters directly — no role needed
                  </p>
                </div>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors shrink-0" />
            </Link>
          )}

          {/* Integrations strip — hidden during active conversation */}
          {!hasConversation && <IntegrationsStrip />}
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
                ? "Reply here…"
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
