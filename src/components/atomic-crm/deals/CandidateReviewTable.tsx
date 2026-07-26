// Phase 2 (2026-07-26): Noon-style Review & Contact table for the Role
// Workspace. Replaces DealCandidatesSection + raw notes panel with a clean,
// scannable candidate table, client-side filters (All / Contacted / Not
// contacted / Interested), and bulk outreach action bar.
//
// Deliberately does NOT re-implement outreach logic — it delegates to the
// same proposeOutreachAfterPipelineAdd → prepareFirstOutreach →
// sendFirstOutreach path already wired into RoleWorkspacePage, so no
// duplicate code or risk of drift.
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useDataProvider, type Identifier } from "ra-core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Linkedin, Mail, Phone } from "lucide-react";

import type { CrmDataProvider } from "../providers/types";
import type { DealCandidate, Candidate } from "../types";

type FilterKey = "all" | "contacted" | "not_contacted" | "interested";

type Row = { dealCandidate: DealCandidate; candidate: Candidate };

const STATUS_LABELS: Record<string, string> = {
  not_contacted: "Not contacted",
  sent: "Contacted",
  responded: "Responded",
};

function statusLabel(s: string | null | undefined) {
  if (!s) return "—";
  return STATUS_LABELS[s] ?? s;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d");
  } catch {
    return "—";
  }
}

function candidateName(c: Candidate) {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "(no name)";
}

function primaryEmail(c: Candidate): string | null {
  if (c.email_jsonb && c.email_jsonb.length > 0) {
    return c.email_jsonb[0]?.email ?? null;
  }
  return null;
}

function primaryPhone(c: Candidate): string | null {
  if (c.phone_jsonb && c.phone_jsonb.length > 0) {
    return c.phone_jsonb[0]?.number ?? null;
  }
  return null;
}

function filterRows(rows: Row[], filter: FilterKey): Row[] {
  if (filter === "all") return rows;
  if (filter === "contacted")
    return rows.filter(
      (r) =>
        r.dealCandidate.response_status === "sent" ||
        r.dealCandidate.response_status === "responded",
    );
  if (filter === "not_contacted")
    return rows.filter(
      (r) =>
        !r.dealCandidate.response_status ||
        r.dealCandidate.response_status === "not_contacted",
    );
  // "interested" = responded (best proxy without a separate interest field)
  if (filter === "interested")
    return rows.filter((r) => r.dealCandidate.response_status === "responded");
  return rows;
}

export const CandidateReviewTable = ({
  dealId,
  onContactRequested,
}: {
  dealId: Identifier;
  // Called when recruiter clicks "Contact" on a candidate — delegates to
  // the parent's outreach preparation + approval flow.
  onContactRequested?: (candidateId: Identifier, name: string) => Promise<void>;
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selected, setSelected] = useState<Set<Identifier>>(new Set());
  const [bulkPreparing, setBulkPreparing] = useState(false);

  const { data: rows, isPending } = useQuery({
    queryKey: ["deal_candidates_for_deal", dealId],
    queryFn: () => dataProvider.getCandidatesForDeal(dealId),
  });

  const visible = useMemo(() => filterRows(rows ?? [], filter), [rows, filter]);

  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="py-12 text-center flex flex-col items-center gap-3">
        <p className="text-muted-foreground text-sm">No candidates yet</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Go to the Sourcing tab to find people who match this role, then add
          them to the pipeline.
        </p>
      </div>
    );
  }

  const allSelected =
    visible.length > 0 &&
    visible.every((r) => selected.has(r.dealCandidate.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        visible.forEach((r) => next.delete(r.dealCandidate.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        visible.forEach((r) => next.add(r.dealCandidate.id));
        return next;
      });
    }
  };

  const toggleOne = (id: Identifier) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedRows = visible.filter((r) => selected.has(r.dealCandidate.id));

  const handleBulkContact = async () => {
    if (selectedRows.length === 0 || !onContactRequested) return;
    setBulkPreparing(true);
    try {
      for (const row of selectedRows) {
        await onContactRequested(
          row.candidate.id,
          candidateName(row.candidate),
        );
      }
      // Invalidate so status column updates
      void queryClient.invalidateQueries({
        queryKey: ["deal_candidates_for_deal", dealId],
      });
      setSelected(new Set());
      toast.success(
        `Outreach prepared for ${selectedRows.length} candidate${selectedRows.length === 1 ? "" : "s"} — check the transcript to approve.`,
      );
    } catch {
      toast.error(
        "Couldn't prepare outreach for some candidates. Check the transcript for details.",
      );
    } finally {
      setBulkPreparing(false);
    }
  };

  const handleSingleContact = async (row: Row) => {
    if (!onContactRequested) return;
    try {
      await onContactRequested(row.candidate.id, candidateName(row.candidate));
      void queryClient.invalidateQueries({
        queryKey: ["deal_candidates_for_deal", dealId],
      });
      toast.success("Outreach prepared — check the transcript to approve.");
    } catch {
      toast.error(
        "Couldn't prepare outreach. Check the transcript for details.",
      );
    }
  };

  const FILTERS: { key: FilterKey; label: string }[] = [
    { key: "all", label: `All (${rows.length})` },
    {
      key: "not_contacted",
      label: `Not contacted (${filterRows(rows, "not_contacted").length})`,
    },
    {
      key: "contacted",
      label: `Contacted (${filterRows(rows, "contacted").length})`,
    },
    {
      key: "interested",
      label: `Interested (${filterRows(rows, "interested").length})`,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex items-center gap-1 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === f.key
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-md bg-muted px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {selected.size} selected
          </span>
          <Button
            size="sm"
            onClick={handleBulkContact}
            disabled={bulkPreparing || !onContactRequested}
          >
            {bulkPreparing
              ? "Preparing…"
              : `Contact ${selected.size} candidate${selected.size === 1 ? "" : "s"}`}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30">
            <tr>
              <th className="w-8 px-3 py-2">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                Name
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">
                Position
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden md:table-cell">
                Location
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                Status
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">
                Contact
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden lg:table-cell">
                Added
              </th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const { candidate, dealCandidate } = row;
              const name = candidateName(candidate);
              const email = primaryEmail(candidate);
              const phone = primaryPhone(candidate);
              const isSelected = selected.has(dealCandidate.id);

              return (
                <tr
                  key={dealCandidate.id}
                  className={`border-b last:border-b-0 transition-colors ${isSelected ? "bg-muted/40" : "hover:bg-muted/20"}`}
                >
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleOne(dealCandidate.id)}
                      aria-label={`Select ${name}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-0.5">
                      <Link
                        to={`/candidates/${candidate.id}/show`}
                        className="font-medium underline hover:no-underline leading-tight"
                      >
                        {name}
                      </Link>
                      {candidate.linkedin_url && (
                        <a
                          href={
                            candidate.linkedin_url.startsWith("http")
                              ? candidate.linkedin_url
                              : `https://${candidate.linkedin_url}`
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Linkedin className="h-3 w-3" />
                          LinkedIn
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 hidden sm:table-cell">
                    <span className="text-muted-foreground text-xs">
                      {candidate.current_title ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 hidden md:table-cell">
                    <span className="text-muted-foreground text-xs">
                      {(candidate.source_raw as
                        | Record<string, unknown>
                        | null
                        | undefined)
                        ? String(
                            (candidate.source_raw as Record<string, unknown>)
                              .location_name ?? "",
                          ) || "—"
                        : "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={
                        dealCandidate.response_status === "responded"
                          ? "default"
                          : dealCandidate.response_status === "sent"
                            ? "secondary"
                            : "outline"
                      }
                      className="text-xs"
                    >
                      {statusLabel(dealCandidate.response_status)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 hidden sm:table-cell">
                    <div className="flex items-center gap-2">
                      {email && (
                        <a
                          href={`mailto:${email}`}
                          title={email}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Mail className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {phone && (
                        <a
                          href={`tel:${phone}`}
                          title={phone}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Phone className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {!email && !phone && (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline hover:text-foreground"
                          onClick={() => handleSingleContact(row)}
                          title="Find contact info and prepare outreach"
                        >
                          Find &amp; contact
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 hidden lg:table-cell">
                    <span className="text-xs text-muted-foreground">
                      {fmtDate(dealCandidate.created_at)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {onContactRequested &&
                      (!dealCandidate.response_status ||
                        dealCandidate.response_status === "not_contacted") && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSingleContact(row)}
                        >
                          Contact
                        </Button>
                      )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {visible.length === 0 && rows.length > 0 && (
        <p className="text-center text-sm text-muted-foreground py-4">
          No candidates match this filter.
        </p>
      )}
    </div>
  );
};
