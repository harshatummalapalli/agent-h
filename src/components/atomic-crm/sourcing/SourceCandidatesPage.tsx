// Thin composer — all state/logic lives in useCandidateSourcing, all display
// sub-components are in CandidateResultsList and SourcingPanels.

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useCandidateSourcing } from "./useCandidateSourcing";
import { useSourcingPagination } from "./useSourcingPagination";
import { useAddToPipeline } from "./useAddToPipeline";
import {
  FreePortalCandidateList,
  MainCandidateList,
} from "./CandidateResultsList";
import {
  CalibrationSection,
  FreePortalSection,
  RoleBriefPanel,
  SearchActionsSection,
  SourcingControlPanel,
  XrayAssistSection,
} from "./SourcingPanels";
import "../inbox/agent-h-theme.css";

// `initialRoleBriefId` is passed so this component behaves as a "sourcing
// panel" for one already-chosen role brief — no dropdown, no NL-search
// toggle, no page-level heading (the workspace page owns that). Standalone
// use at `/source-candidates` (no prop) keeps working exactly as before.
export const SourceCandidatesPage = ({
  initialRoleBriefId,
  onCandidateSaved,
  simplified = false,
  onOpenSidebar,
}: {
  initialRoleBriefId?: string;
  onCandidateSaved?: (candidateId: number, name: string) => void;
  simplified?: boolean;
  /** Called when the user clicks "Relax"/"Tighten" — caller opens the sidebar chat. */
  onOpenSidebar?: () => void;
} = {}) => {
  const embedded = Boolean(initialRoleBriefId);

  const {
    visibleCount,
    showMore,
    reset: resetPagination,
  } = useSourcingPagination();

  const s = useCandidateSourcing({
    initialRoleBriefId,
    resetPagination,
    onCandidateSaved,
  });

  const { handleAddToPipeline } = useAddToPipeline({
    selectedId: s.selectedId,
    candidateDbIds: s.candidateDbIds,
    setCandidateDbIds: s.setCandidateDbIds,
    setSaveStates: s.setSaveStates,
    onCandidateSaved,
  });

  return (
    <div
      className={
        embedded
          ? "flex flex-col gap-4"
          : "flex flex-col gap-6 max-w-3xl mx-auto p-6"
      }
    >
      {!embedded && (
        <div>
          <h1 className="text-2xl font-semibold">Source Candidates</h1>
          <p className="text-muted-foreground text-sm">
            Pick a role brief and source the best matches. Results are sorted by
            fit score. Click "Add to pipeline" on anyone worth tracking.
          </p>
        </div>
      )}

      {!embedded && (
        <div className="flex flex-col gap-2 border rounded-lg p-4">
          <Label htmlFor="nl-search">
            Paste a job description, or describe the role in your own words
          </Label>
          <textarea
            id="nl-search"
            className="border rounded-md p-2 text-sm min-h-24"
            value={s.nlText}
            onChange={(e) => s.setNlText(e.target.value)}
            placeholder="Paste the full JD here, or just: Python developer in Bengaluru with 5-8 years, currently at a startup or product company, strong in FastAPI, AWS and Docker"
          />
          <div>
            <Button onClick={s.handleNlSearch} disabled={s.nlParsing}>
              {s.nlParsing ? "Parsing..." : "Create role brief & search"}
            </Button>
          </div>
        </div>
      )}

      {!embedded && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="role-brief">Or pick an existing role brief</Label>
          <select
            id="role-brief"
            className="border border-input bg-background text-foreground rounded-md h-9 px-2"
            value={s.selectedId}
            onChange={(e) => s.handleRoleBriefChange(e.target.value)}
          >
            <option value="">Select a role brief...</option>
            {s.roleBriefs.map((rb) => (
              <option key={rb.id} value={rb.id}>
                {rb.name} (#{rb.id})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Compact role brief chip — collapses to one line, expands on click */}
      <RoleBriefPanel s={s} embedded={embedded} />

      {/* One-click "Source candidates" for embedded/simplified view */}
      {simplified && s.selectedId && s.stage === "idle" && (
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            onClick={s.handleSourceCandidates}
            disabled={s.previewLoading || s.fetchLoading}
            className="self-start"
          >
            {s.previewLoading
              ? "Searching…"
              : s.fetchLoading
                ? "Fetching candidates…"
                : "Source candidates"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Fetches up to 100 people matching this role — ranked by fit, top 25
            shown with a brief explanation of why they could be a match. All 100
            are saved to your pipeline.
          </p>
        </div>
      )}

      {/* Learned criteria panel — sidebar chat is primary for refinement */}
      <SourcingControlPanel
        s={s}
        embedded={embedded}
        onOpenSidebar={onOpenSidebar}
      />

      {/* Search actions: preview + restore + Advanced › (X-ray, free portals) */}
      <SearchActionsSection s={s} simplified={simplified} />

      {/* Free portal results (non-simplified standalone only) */}
      {s.selectedId && !simplified && <FreePortalSection s={s} />}

      {s.freePortalCandidates.length > 0 && (
        <FreePortalCandidateList
          s={s}
          handleAddToPipeline={handleAddToPipeline}
        />
      )}

      {/* X-ray Assist only shown on standalone route (not embedded) */}
      {!simplified && <XrayAssistSection s={s} />}

      {s.stage !== "idle" && (
        <div className="flex flex-col gap-4 border rounded-lg p-4">
          <div>
            <h2 className="text-lg font-medium">
              {s.total} match{s.total === 1 ? "" : "es"} for {s.roleBriefTitle}
            </h2>
            {s.notes.length > 0 && (
              <ul className="text-muted-foreground text-xs list-disc pl-4 mt-1">
                {s.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            )}
          </div>

          <CalibrationSection s={s} />

          {s.stage === "fetched" && s.candidates.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No candidates matched this query.
            </p>
          )}

          {s.stage === "fetched" && s.candidates.length > 0 && (
            <MainCandidateList
              s={s}
              handleAddToPipeline={handleAddToPipeline}
              visibleCount={visibleCount}
              showMore={showMore}
              embedded={embedded}
              onOpenSidebar={onOpenSidebar}
            />
          )}
        </div>
      )}
    </div>
  );
};

SourceCandidatesPage.path = "/source-candidates";
