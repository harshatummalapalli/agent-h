// Home page — brand-first.
//
// First viewport: Agent H brand, greeting, single compose surface.
// Below the fold: recent roles as quiet list rows.
// After first submit: conversation scroll + compact bottom compose bar.
import { useRef, useState } from "react";
import { useNavigate, Link } from "react-router";
import { Linkedin, Mail, ChevronRight, Send } from "lucide-react";
import {
  useGetIdentity,
  useGetList,
  useDataProvider,
  useNotify,
} from "ra-core";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { Deal } from "../types";
import type { CrmDataProvider } from "../providers/types";
import type { UnipileLinkedInAccount } from "../settings/UnipileLinkedInConnectionCard";
import type { CalibrationCandidate } from "../providers/supabase/dataProvider";
import { parsedBriefToConditions } from "../jd-intake/parsedBriefToConditions";
import { extractExplicitExcludesFromText } from "../jd-intake/extractExplicitExcludes";
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

function formatExperienceRange(
  min: number | null | undefined,
  max: number | null | undefined,
): string {
  if (min == null && max == null) return "not specified";
  if (max == null) return `${min ?? 0}+ years`;
  if (min == null) return `up to ${max} years`;
  return `${min}–${max} years`;
}

function buildSummary(result: ParsedBrief): string {
  const skillsSummary =
    ((result.required_skills ?? result.must_have_keywords ?? []) as string[])
      .slice(0, 5)
      .join(", ") || "not specified";
  const expSummary = formatExperienceRange(
    result.years_experience_min,
    result.years_experience_max,
  );
  const excludeCompanies = result.excluded_companies ?? [];
  const excludeKeywords = result.exclusion_keywords ?? [];
  const excludeCount = excludeCompanies.length + excludeKeywords.length;
  const requireCount = (
    result.required_skills ??
    result.must_have_keywords ??
    []
  ).length;
  const preferCount = (result.nice_to_have_keywords ?? []).length;
  return [
    `Role: ${result.title || "untitled"}`,
    `Seniority: ${result.seniority || "not specified"}`,
    `Location: ${result.location || "not specified"}`,
    `Experience: ${expSummary}`,
    `Key skills: ${skillsSummary}`,
    `Require ${requireCount} · Prefer ${preferCount} · Exclude ${excludeCount}`,
  ].join("\n");
}

export const HomePage = () => {
  const navigate = useNavigate();
  const notify = useNotify();
  const { identity } = useGetIdentity();
  const dataProvider = useDataProvider<CrmDataProvider>();
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

  const greeting = getGreeting(identity?.fullName);
  const hasConversation = turns.length > 0;

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

    // Snapshot prev state before parse so follow-up turns can compute delta.
    const prevParsed = parsed;

    try {
      const isFirstMessage = turns.length === 0;

      const inputForParse = parsed
        ? `[Existing role brief — update only the fields affected by the hiring manager's follow-up, keep all other fields as-is]\n${JSON.stringify(parsed)}\n\nHiring manager follow-up: ${text}`
        : text;

      const result = await dataProvider.parseJobDescription(inputForParse);

      // Merge regex-extracted excludes with LLM output (defense-in-depth).
      // The LLM may miss explicit "Exclude candidates at X, Y" if schema was
      // not deployed yet; the regex catches it deterministically.
      const regexExcludes = extractExplicitExcludesFromText(text);
      const merged: ParsedBrief = {
        ...(result as ParsedBrief),
        excluded_companies: [
          ...new Set([
            ...((result.excluded_companies as string[] | undefined) ?? []),
            ...regexExcludes.companies,
          ]),
        ],
        exclusion_keywords: [
          ...new Set([
            ...((result.exclusion_keywords as string[] | undefined) ?? []),
            ...regexExcludes.titleKeywords,
          ]),
        ],
      };
      setParsed(merged);

      if (checkUnrealisticConstraints(text) && !expectationShownRef.current) {
        expectationShownRef.current = true;
        addTurn({ role: "agent", text: EXPECTATION_TURN });
      }

      if (isFirstMessage) {
        const clarifyingQs =
          (merged.clarifying_questions as string[] | undefined) ?? [];

        const hasJdSignal =
          text.length >= 300 ||
          /responsibilities|requirements|qualifications/i.test(text);
        const fullQueue: string[] = hasJdSignal
          ? clarifyingQs
          : [JD_QUESTION, ...clarifyingQs];

        const [firstQ, ...remainingQs] = fullQueue;
        const summary = buildSummary(merged);

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
        const nextQ = pendingQuestions[0] ?? null;
        if (nextQ) {
          addTurn({ role: "agent", text: nextQ });
          setPendingQuestions((prev) => prev.slice(1));
        } else {
          // Show recruiter a self-verifiable delta so they don't need to open the DB.
          const prevExcluded = prevParsed?.excluded_companies ?? [];
          const newExcluded = merged.excluded_companies ?? [];
          const addedExcludes = newExcluded.filter(
            (c) =>
              !prevExcluded
                .map((x) => x.toLowerCase())
                .includes(c.toLowerCase()),
          );
          const requireCount = (
            merged.required_skills ??
            merged.must_have_keywords ??
            []
          ).length;
          const preferCount = (merged.nice_to_have_keywords ?? []).length;
          const excludeCount = newExcluded.length;
          const counts = `Require ${requireCount} · Prefer ${preferCount} · Exclude ${excludeCount}`;
          const deltaPrefix =
            addedExcludes.length > 0
              ? `+${addedExcludes.length} excluded: ${addedExcludes.join(", ")} · `
              : "";
          addTurn({
            role: "agent",
            text: `Brief updated. ${deltaPrefix}${counts}`,
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
        // Transcript seeding failed — navigate anyway.
      }

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

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  // ── No conversation: brand-first hero ────────────────────────────────────────
  if (!hasConversation) {
    return (
      <div className="ah-scope min-h-[calc(100dvh-8rem)] flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-xl mx-auto px-5 pt-16 pb-8 flex flex-col gap-10">
            {/* Hero */}
            <div className="flex flex-col gap-3">
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">
                  Agent H
                </h1>
                <p className="text-sm text-muted-foreground mt-1">{greeting}</p>
              </div>
              <p className="text-base text-foreground/75 leading-snug">
                Describe the role or paste a JD to start sourcing.
              </p>

              {/* Compose surface */}
              <div className="flex flex-col gap-2 mt-1">
                <textarea
                  ref={inputRef}
                  rows={3}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder='e.g. "Senior backend engineer, Python, remote, 5+ years"'
                  disabled={busy}
                  className={cn(
                    "w-full resize-none rounded-xl border bg-muted/50 px-4 py-3 text-sm",
                    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
                    "disabled:opacity-50 min-h-[84px]",
                  )}
                />
                <div className="flex items-center justify-between gap-3">
                  <Button
                    onClick={handleSubmit}
                    disabled={!input.trim() || busy}
                    className="gap-1.5"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Start sourcing
                  </Button>
                  <span className="text-xs text-muted-foreground/70 flex items-center gap-2">
                    or{" "}
                    <Link
                      to="/jd-intake"
                      className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    >
                      paste a full JD
                    </Link>
                    ·{" "}
                    <Link
                      to="/build-search"
                      className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    >
                      build a search
                    </Link>
                  </span>
                </div>
              </div>
            </div>

            {/* Recent roles */}
            {!isLoading && deals.length > 0 && (
              <div className="flex flex-col gap-2">
                <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Recent roles
                </h2>
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
                  {deals.slice(0, 8).map((deal) => (
                    <RoleRow key={deal.id} deal={deal} />
                  ))}
                </ul>
              </div>
            )}

            {/* Integrations — compact */}
            <IntegrationsStrip />
          </div>
        </div>
      </div>
    );
  }

  // ── Active conversation ───────────────────────────────────────────────────────
  return (
    <div
      className="ah-scope"
      style={{
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        minHeight: "calc(100dvh - 8rem)",
      }}
    >
      {/* Compact header */}
      <div className="border-b bg-background px-5 py-3 flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-foreground">Agent H</span>
          <span className="text-xs text-muted-foreground ml-2">{greeting}</span>
        </div>
        <button
          type="button"
          onClick={() => setTurns([])}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Your roles
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      {/* Conversation scroll */}
      <div className="overflow-y-auto">
        <div className="max-w-2xl mx-auto px-5 py-4 flex flex-col gap-4">
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
      </div>

      {/* Compact bottom compose bar */}
      <div className="border-t bg-background px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Reply here…"
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
      </div>
    </div>
  );
};

/* ─── Role row ────────────────────────────────────────────────────────────── */

function RoleRow({ deal }: { deal: Deal }) {
  const anyDeal = deal as Deal & { location?: string; seniority?: string };
  const meta = [anyDeal.location, anyDeal.seniority]
    .filter(Boolean)
    .join(" · ");
  const pipelineCount = deal.contact_ids?.length ?? 0;

  return (
    <li>
      <Link
        to={`/roles/${deal.id}`}
        className="flex items-center gap-3 px-4 py-2.5 bg-card hover:bg-accent/50 transition-colors no-underline group"
      >
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-foreground truncate">
            {deal.name}
          </span>
          {meta && (
            <span className="block text-xs text-muted-foreground mt-0.5 truncate">
              {meta}
            </span>
          )}
        </span>
        {pipelineCount > 0 && (
          <span className="text-xs text-muted-foreground shrink-0">
            {pipelineCount} in pipeline
          </span>
        )}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors shrink-0" />
      </Link>
    </li>
  );
}

/* ─── Integrations strip ─────────────────────────────────────────────────── */

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
    <div className="flex flex-wrap items-center gap-2">
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
