// BuildSearchTab — link-out to the standalone /build-search page.
//
// The full filter UI lives in BuildSearchPage.tsx; this tab avoids
// duplicating it. The deal_id param lets BuildSearchPage pre-load context.

import { ExternalLink } from "lucide-react";
import type { Deal } from "../types";

export function BuildSearchTab({ deal }: { deal: Deal }) {
  return (
    <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col gap-4">
      <a
        href={`/build-search?deal_id=${deal.id}`}
        className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-5 hover:bg-accent/40 transition-colors no-underline group"
      >
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">
            Build your search for this role
          </span>
          <span className="text-xs text-muted-foreground">
            Open the full filter panel — tune Crustdata filters directly for{" "}
            <strong>{deal.name}</strong>
          </span>
        </div>
        <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
      </a>
      <p className="text-xs text-muted-foreground text-center">
        Results stay local to your session — they are not added to the candidate
        pipeline automatically.
      </p>
    </div>
  );
}
