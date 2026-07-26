import type { EnrichState } from "./sourcingTypes";

export function CandidateQuickActionBar({
  emails,
  linkedInUrl,
  isLinkedInSource,
  outreachState,
  onLinkedInOutreach,
}: {
  emails?: { address: string; type?: string }[];
  linkedInUrl?: string | null;
  isLinkedInSource: boolean;
  outreachState: EnrichState;
  onLinkedInOutreach: () => void;
}) {
  const primaryEmail = emails?.[0]?.address;
  if (!primaryEmail && !isLinkedInSource) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap pb-2 border-b mb-1">
      {primaryEmail && (
        <a
          href={`mailto:${primaryEmail}`}
          className="inline-flex items-center gap-1 text-xs border rounded px-2 py-1 hover:bg-accent/40 transition-colors text-foreground no-underline"
          title={primaryEmail}
        >
          ✉ Email
        </a>
      )}
      {isLinkedInSource && (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs border rounded px-2 py-1 hover:bg-accent/40 transition-colors disabled:opacity-50"
          disabled={outreachState === "loading"}
          onClick={onLinkedInOutreach}
          title={linkedInUrl ? `LinkedIn: ${linkedInUrl}` : "LinkedIn outreach"}
        >
          {outreachState === "loading" ? "Preparing..." : "LinkedIn Outreach"}
        </button>
      )}
    </div>
  );
}
