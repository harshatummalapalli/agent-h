// CandidateCard — canonical candidate display for the Agent H recruiter surface.
//
// Two densities:
//   queue — full card for Review queue and calibration transcript
//   row   — compact horizontal row for BuildSearchPage results
//
// Fit score pill colors use CSS-variable-based classes (hsl vars) so they
// respect dark mode; no hardcoded hex colors.

import {
  MapPin,
  CheckCircle2,
  XCircle,
  Circle,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { normalizeLinkedinUrl } from "../misc/normalizeLinkedinUrl";

export type MustHaveItem = {
  label: string;
  status: "found" | "inferred" | "missing";
};

export type CandidateCardProps = {
  density: "queue" | "row";
  name: string;
  /** "Title @ Company" or similar headline */
  headline?: string | null;
  location?: string | null;
  /** Match / fit score on a 0–1 scale (displayed as %) */
  fitScore?: number | null;
  whyFit?: string | null;
  mustHaves?: MustHaveItem[];
  linkedinUrl?: string | null;
  /** For row density: skill tags */
  skills?: string[];
  // ── Queue-density pipeline action ──────────────────────────────────────────
  onAddToPipeline?: () => void;
  pipelineSaveState?: "idle" | "saving" | "saved";
};

// Fit score → color class (CSS var-based, dark-mode safe)
function fitPillClass(score: number): string {
  const pct = score * 100;
  if (pct >= 80)
    return "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800";
  if (pct >= 60)
    return "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800";
  return "bg-muted text-muted-foreground border-border";
}

function FitPill({ score }: { score: number | null | undefined }) {
  if (score == null) return null;
  const pct = Math.round(score * 100);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${fitPillClass(score)}`}
    >
      {pct}% fit
    </span>
  );
}

function MustHaveList({ items }: { items: MustHaveItem[] }) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((m, i) => (
        <li key={i} className="text-xs flex items-center gap-1.5">
          {m.status === "found" ? (
            <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : m.status === "inferred" ? (
            <Circle className="h-3 w-3 text-amber-500 shrink-0" />
          ) : (
            <XCircle className="h-3 w-3 text-red-500 shrink-0" />
          )}
          <span className="text-foreground">{m.label}</span>
        </li>
      ))}
    </ul>
  );
}

// ── Queue density ─────────────────────────────────────────────────────────────

function QueueCard({
  name,
  headline,
  location,
  fitScore,
  whyFit,
  mustHaves,
  linkedinUrl,
  onAddToPipeline,
  pipelineSaveState = "idle",
}: Omit<CandidateCardProps, "density">) {
  const normalizedLinkedin = normalizeLinkedinUrl(linkedinUrl);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
      {/* Header: avatar + name + headline + fit pill */}
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0 select-none"
        >
          {initials || "?"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">
              {name}
            </span>
            <FitPill score={fitScore} />
          </div>
          {headline && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {headline}
            </p>
          )}
        </div>
      </div>

      {/* Location */}
      {location && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3 shrink-0" />
          {location}
        </div>
      )}

      {/* Why fit */}
      {whyFit && (
        <div>
          <p className="text-xs font-medium text-foreground mb-0.5">
            Why they fit
          </p>
          <p className="text-xs text-foreground leading-relaxed">{whyFit}</p>
        </div>
      )}

      {/* Must-haves */}
      {mustHaves && mustHaves.length > 0 && <MustHaveList items={mustHaves} />}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        {onAddToPipeline && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onAddToPipeline}
            disabled={
              pipelineSaveState === "saving" || pipelineSaveState === "saved"
            }
          >
            {pipelineSaveState === "saved"
              ? "Added to pipeline"
              : pipelineSaveState === "saving"
                ? "Adding…"
                : "Add to pipeline"}
          </Button>
        )}
        {normalizedLinkedin && (
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
          >
            <a href={normalizedLinkedin} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3 w-3" />
              LinkedIn
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Row density ───────────────────────────────────────────────────────────────

function RowCard({
  name,
  headline,
  location,
  fitScore,
  whyFit,
  skills,
  linkedinUrl,
}: Omit<CandidateCardProps, "density">) {
  const normalizedLinkedin = normalizeLinkedinUrl(linkedinUrl);

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground truncate">
            {name}
          </span>
          <FitPill score={fitScore} />
        </div>
        {headline && (
          <span className="text-xs text-muted-foreground truncate">
            {headline}
          </span>
        )}
        {location && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{location}</span>
          </div>
        )}
        {whyFit && (
          <p className="text-xs text-foreground leading-relaxed line-clamp-2 mt-0.5">
            {whyFit}
          </p>
        )}
        {skills && skills.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {skills.slice(0, 5).map((s) => (
              <Badge
                key={s}
                variant="outline"
                className="text-[10px] py-0 px-1.5 h-4"
              >
                {s}
              </Badge>
            ))}
            {skills.length > 5 && (
              <span className="text-[10px] text-muted-foreground">
                +{skills.length - 5}
              </span>
            )}
          </div>
        )}
      </div>
      {normalizedLinkedin && (
        <a
          href={normalizedLinkedin}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-muted-foreground hover:text-foreground mt-0.5"
          aria-label="Open LinkedIn profile"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}

// ── Public export ─────────────────────────────────────────────────────────────

/** Canonical candidate card — queue (full) or row (compact) density. */
export function CandidateCard(props: CandidateCardProps) {
  if (props.density === "row") return <RowCard {...props} />;
  return <QueueCard {...props} />;
}
