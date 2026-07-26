import { Button } from "@/components/ui/button";
import type {
  CalibrationEntryState,
  ContextualizeResult,
} from "./sourcingTypes";

export function CalibrationFeedbackWidget({
  reason,
  onReasonChange,
  submitted,
  entryState,
  onSubmitJudgment,
  contextualizeState,
  contextualizeResult,
  applyState,
  onApplyCriterion,
}: {
  reason: string;
  onReasonChange: (value: string) => void;
  submitted: boolean;
  entryState: CalibrationEntryState;
  onSubmitJudgment: (fit: boolean) => void;
  contextualizeState: "idle" | "loading" | "done" | undefined;
  contextualizeResult: ContextualizeResult | undefined;
  applyState: "idle" | "applying" | "applied";
  onApplyCriterion: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 pt-2 border-t">
      <p className="text-xs text-muted-foreground">
        Not a fit? Give a reason -- it becomes a real search criterion for this
        role, and you'll see how many candidates it would exclude before it's
        ever applied.
      </p>
      <textarea
        className="border rounded-md p-2 text-sm"
        placeholder="Why is this (or isn't this) a fit? Required."
        rows={2}
        disabled={submitted}
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
      />
      {submitted ? (
        <p className="text-xs text-muted-foreground">Judgment saved.</p>
      ) : (
        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            disabled={entryState === "submitting"}
            onClick={() => onSubmitJudgment(true)}
          >
            Fit
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={entryState === "submitting"}
            onClick={() => onSubmitJudgment(false)}
          >
            Not a fit
          </Button>
        </div>
      )}
      {contextualizeState === "loading" && (
        <p className="text-xs text-muted-foreground italic">
          Contextualizing...
        </p>
      )}
      {contextualizeState === "done" &&
        contextualizeResult &&
        (contextualizeResult.applicable ? (
          <div className="border rounded-md p-2 flex flex-col gap-1 bg-muted/40">
            <p className="text-xs font-medium">
              Suggested criterion: "{contextualizeResult.criterion?.label}"
            </p>
            <p className="text-xs text-muted-foreground">
              {contextualizeResult.rejected_count !== null &&
              contextualizeResult.rejected_count !== undefined
                ? `Would exclude ~${contextualizeResult.rejected_count} of the ${contextualizeResult.current_total ?? "?"} candidates currently matching this role.`
                : "Couldn't compute how many candidates this would exclude right now."}
            </p>
            {applyState === "applied" ? (
              <p className="text-xs text-muted-foreground">
                Applied -- this now applies to every future search for this
                role.
              </p>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={applyState === "applying"}
                onClick={onApplyCriterion}
              >
                {applyState === "applying"
                  ? "Applying..."
                  : contextualizeResult.rejected_count !== null &&
                      contextualizeResult.rejected_count !== undefined
                    ? `Apply (${contextualizeResult.rejected_count} excluded)`
                    : "Apply"}
              </Button>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            This reason didn't map onto a specific search criterion -- it's
            still saved above for reference, but it won't change future
            searches.
          </p>
        ))}
    </div>
  );
}
