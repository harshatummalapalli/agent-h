// Compact per-card contact shortcuts — email only.
// LinkedIn outreach has been moved to the Review & Contact tab (pipeline hub).
export function CandidateQuickActionBar({
  emails,
}: {
  emails?: { address: string; type?: string }[];
  // Props below kept for backward-compat but no longer rendered.
  linkedInUrl?: string | null;
  isLinkedInSource?: boolean;
  outreachState?: string;
  onLinkedInOutreach?: () => void;
}) {
  const primaryEmail = emails?.[0]?.address;
  if (!primaryEmail) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap pb-2 border-b mb-1">
      <a
        href={`mailto:${primaryEmail}`}
        className="inline-flex items-center gap-1 text-xs border rounded px-2 py-1 hover:bg-accent/40 transition-colors text-foreground no-underline"
        title={primaryEmail}
      >
        ✉ Email
      </a>
    </div>
  );
}
