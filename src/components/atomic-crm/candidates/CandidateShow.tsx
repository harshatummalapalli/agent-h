// Premium candidate profile view.
// Vendor names (crustdata, unipile, exa, etc.) are never shown to recruiters —
// raw source values are kept in the DB but mapped to friendly labels here.
import { useState } from "react";
import { useGetList, useGetMany, useRecordContext } from "ra-core";
import { ExternalLink, ChevronDown, ChevronUp, Briefcase } from "lucide-react";
import { Show } from "@/components/admin/show";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { normalizeLinkedinUrl } from "../misc/normalizeLinkedinUrl";
import type { Candidate, Deal, DealCandidate } from "../types";

const FRIENDLY_SOURCE: Record<string, string> = {
  crustdata: "Web search",
  crustdata_search: "Web search",
  exa: "Web search",
  exa_search: "Web search",
  linkedin: "LinkedIn",
  unipile: "LinkedIn",
  unipile_linkedin: "LinkedIn",
  manual: "Added manually",
  resume: "Resume upload",
  bulk_resume: "Resume upload",
};

function friendlySource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return FRIENDLY_SOURCE[raw.toLowerCase()] ?? "Sourced";
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return "Active";
  const map: Record<string, string> = {
    new: "New",
    contacted: "Contacted",
    replied: "Replied",
    in_process: "In process",
    offer: "Offer sent",
    hired: "Hired",
    rejected: "Not proceeding",
    archived: "Archived",
  };
  return map[status] ?? status;
}

const CandidateTitle = () => {
  const record = useRecordContext<Candidate>();
  if (!record) return null;
  const name = [record.first_name, record.last_name].filter(Boolean).join(" ");
  return <span>{name || "Candidate"}</span>;
};

const DevProfileSection = ({ record }: { record: Candidate }) => {
  const [open, setOpen] = useState(false);
  const hasGitHub = record.github_url || record.github_username;
  const hasSO = record.stackoverflow_url;
  if (!hasGitHub && !hasSO) return null;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2 text-muted-foreground">
          Dev profile
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 flex flex-col gap-2 border-t">
          {hasGitHub && (
            <a
              href={
                record.github_url ??
                `https://github.com/${record.github_username}`
              }
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-sm text-blue-700 hover:underline mt-3"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              GitHub
            </a>
          )}
          {hasSO && (
            <a
              href={record.stackoverflow_url!}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-sm text-blue-700 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Stack Overflow
            </a>
          )}
        </div>
      )}
    </div>
  );
};

const PipelineRolesSection = ({
  candidateId,
}: {
  candidateId: string | number;
}) => {
  const { data: links } = useGetList<DealCandidate>("deal_candidates", {
    filter: { candidate_id: candidateId },
    sort: { field: "created_at", order: "DESC" },
    pagination: { page: 1, perPage: 10 },
  });
  const dealIds = links?.map((l) => l.deal_id).filter(Boolean) ?? [];
  const { data: deals } = useGetMany<Deal>(
    "deals",
    { ids: dealIds },
    { enabled: dealIds.length > 0 },
  );
  const dealMap = Object.fromEntries(
    (deals ?? []).map((d) => [String(d.id), d.name]),
  );

  if (!links?.length) return null;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Pipeline roles
      </p>
      <div className="flex flex-col gap-1">
        {links.map((link) => {
          const roleName =
            dealMap[String(link.deal_id)] ?? `Role #${link.deal_id}`;
          const whyFit = (link as Record<string, unknown>).why_fit as
            | string
            | null
            | undefined;
          return (
            <div key={link.id} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2 text-sm">
                <Briefcase className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="font-medium">{roleName}</span>
                {link.match_score != null && (
                  <Badge variant="outline" className="text-xs py-0">
                    {Math.round(link.match_score * 100)}% match
                  </Badge>
                )}
              </div>
              {whyFit && (
                <p className="text-xs text-foreground pl-5 leading-relaxed">
                  {whyFit}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const CandidateShowContent = () => {
  const record = useRecordContext<Candidate>();
  if (!record) return null;

  const name =
    [record.first_name, record.last_name].filter(Boolean).join(" ") ||
    "Candidate";
  const subtitle = [record.current_title].filter(Boolean).join(" ");
  const sourceLabel = friendlySource(record.source);
  const resumeStatus = (record as Record<string, unknown>).resume_status as
    | string
    | null
    | undefined;
  const whyFit = (record as Record<string, unknown>).why_fit as
    | string
    | null
    | undefined;
  const skills = (record as Record<string, unknown>).skills as
    | string[]
    | null
    | undefined;
  const location = (record as Record<string, unknown>).location as
    | string
    | null
    | undefined;

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      {/* Hero: name + headline */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
        {subtitle && <p className="text-muted-foreground mt-1">{subtitle}</p>}
        {location && (
          <p className="text-sm text-muted-foreground mt-0.5">
            {location as string}
          </p>
        )}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <Badge variant="secondary" className="text-xs">
            {statusLabel(record.status)}
          </Badge>
          {sourceLabel && (
            <Badge variant="outline" className="text-xs">
              {sourceLabel}
            </Badge>
          )}
          {resumeStatus === "received" && (
            <Badge
              variant="outline"
              className="text-xs border-green-300 text-green-700 bg-green-50"
            >
              Resume received
            </Badge>
          )}
        </div>
      </div>

      {/* LinkedIn CTA */}
      {normalizeLinkedinUrl(record.linkedin_url) && (
        <div>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <a
              href={normalizeLinkedinUrl(record.linkedin_url)!}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="h-4 w-4" />
              View LinkedIn profile
            </a>
          </Button>
        </div>
      )}

      <Separator />

      {/* Why fit */}
      {whyFit && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Why a fit
          </p>
          <p className="text-sm leading-relaxed">{whyFit}</p>
        </div>
      )}

      {/* Skills */}
      {skills && skills.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Skills
          </p>
          <div className="flex flex-wrap gap-1.5">
            {skills.map((s) => (
              <Badge key={s} variant="secondary" className="text-xs">
                {s}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Pipeline roles */}
      <PipelineRolesSection candidateId={record.id} />

      {/* Dev profile (collapsible) */}
      <DevProfileSection record={record} />

      {/* Resume / contact status (minimal) */}
      {record.contact_enrichment_status === "enriched" && (
        <p className="text-xs text-muted-foreground">
          Contact details available
        </p>
      )}
    </div>
  );
};

export const CandidateShow = () => (
  <Show title={<CandidateTitle />}>
    <CandidateShowContent />
  </Show>
);
