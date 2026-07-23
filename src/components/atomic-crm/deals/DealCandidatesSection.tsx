// Agent H Stage 3, candidate-visibility follow-up: shows every candidate
// sourced/saved for this role brief, ranked best-match-first, right on the
// role brief itself -- this is the actual "trace a JD to its candidates"
// screen the recruiter asked for. Uses dataProvider.getCandidatesForDeal
// (a plain multi-table read, not an edge function) since deal_candidates
// has no join view to lean on yet -- see that method's own comment in
// dataProvider.ts.
//
// "Quick view" (2026-07-22, direct feedback from Harsha after reviewing
// live X-ray/free-portal results): "right now I have to click through the
// name, then click on the link to see what does this person bring to the
// table." The fix turned out to need no schema change at all -- save-
// sourced-candidate already writes the FULL search-result payload (skills,
// headline, company, location, the portal/LinkedIn URL) into
// candidates.source_raw on every save; it just was never read back
// anywhere. This adds an inline expand/collapse per row that reads straight
// from source_raw, so the recruiter gets the "what do they bring" read
// without leaving this list -- the external link is still one click away
// for anyone who wants the full profile, but it's no longer the ONLY way to
// learn anything.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useDataProvider, type Identifier } from "ra-core";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import type { CrmDataProvider } from "../providers/types";

// Defensive read over source_raw: its exact shape depends on which sourcing
// edge function produced this candidate (free-portal/Exa normalize to
// job_title/job_company_name/location_name/skills/_portal_url/_source_vendor;
// X-ray's LinkedIn branch is the same shape; its CodeChef/HackerRank branch
// has no location/company at all). Every field is read as `unknown` and
// type-checked before use -- source_raw is a jsonb blob, not a typed
// contract, so a differently-shaped or missing value should degrade to
// "nothing to show" rather than throw.
type SourceSnapshot = {
  headline: string | null;
  company: string | null;
  location: string | null;
  skills: string[];
  portalUrl: string | null;
  vendor: string | null;
};

function readSourceSnapshot(sourceRaw: Record<string, unknown> | null | undefined): SourceSnapshot {
  const raw = sourceRaw ?? {};
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.length > 0) : [];
  return {
    headline: str(raw.job_title),
    company: str(raw.job_company_name),
    location: str(raw.location_name),
    skills: strList(raw.skills),
    portalUrl: str(raw._portal_url) ?? str(raw.linkedin_url),
    vendor: str(raw._source_vendor),
  };
}

export const DealCandidatesSection = ({ dealId }: { dealId: Identifier }) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [expandedIds, setExpandedIds] = useState<Set<Identifier>>(new Set());
  const { data: rows, isPending } = useQuery({
    queryKey: ["deal_candidates_for_deal", dealId],
    queryFn: () => dataProvider.getCandidatesForDeal(dealId),
  });

  if (isPending) {
    return <Skeleton className="h-24 w-full" />;
  }
  if (!rows || rows.length === 0) return null;

  const toggleExpanded = (id: Identifier) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="m-4">
      <span className="text-xs text-muted-foreground tracking-wide">
        Sourced candidates ({rows.length})
      </span>
      <div className="flex flex-col gap-2 mt-2">
        {rows.map(({ dealCandidate, candidate }) => {
          const name =
            [candidate.first_name, candidate.last_name]
              .filter(Boolean)
              .join(" ") || "(no name on file)";
          const isExpanded = expandedIds.has(candidate.id);
          const snapshot = readSourceSnapshot(candidate.source_raw);
          const hasQuickViewContent =
            snapshot.headline || snapshot.company || snapshot.location ||
            snapshot.skills.length > 0 || snapshot.portalUrl;
          return (
            <div
              key={dealCandidate.id}
              className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col">
                  <Link
                    to={`/candidates/${candidate.id}/show`}
                    className="font-medium underline hover:no-underline"
                  >
                    {name}
                  </Link>
                  {candidate.current_title && (
                    <span className="text-xs text-muted-foreground">
                      {candidate.current_title}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {typeof dealCandidate.match_score === "number" && (
                    <Badge variant="outline">
                      Match {Math.round(dealCandidate.match_score * 100)}%
                    </Badge>
                  )}
                  {candidate.contact_enrichment_status === "enriched" && (
                    <Badge variant="secondary">Contact found</Badge>
                  )}
                  {candidate.devsignal_enrichment_status === "enriched" && (
                    <Badge variant="secondary">Dev signals found</Badge>
                  )}
                  {hasQuickViewContent && (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(candidate.id)}
                      className="text-xs text-muted-foreground border rounded px-2 py-1 hover:bg-muted"
                    >
                      {isExpanded ? "Hide quick view" : "Quick view"}
                    </button>
                  )}
                </div>
              </div>

              {isExpanded && hasQuickViewContent && (
                <div className="flex flex-col gap-1.5 border-t pt-2">
                  {snapshot.headline && (
                    <p className="text-xs text-foreground">{snapshot.headline}</p>
                  )}
                  {(snapshot.company || snapshot.location) && (
                    <p className="text-xs text-muted-foreground">
                      {[snapshot.company, snapshot.location].filter(Boolean).join(" -- ")}
                    </p>
                  )}
                  {snapshot.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {snapshot.skills.slice(0, 10).map((skill, i) => (
                        <span
                          key={i}
                          className="text-xs bg-muted text-muted-foreground rounded px-1.5 py-0.5"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    {snapshot.vendor && (
                      <span className="text-xs uppercase text-muted-foreground">
                        via {snapshot.vendor}
                      </span>
                    )}
                    {snapshot.portalUrl && (
                      <a
                        href={
                          snapshot.portalUrl.startsWith("http")
                            ? snapshot.portalUrl
                            : `https://${snapshot.portalUrl}`
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline text-muted-foreground"
                      >
                        View profile
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
