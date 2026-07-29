import type {
  VersionedSearchIntent,
  SearchIntentCondition,
  UnenforcedConstraint,
} from "../types";

// ─── Delta computation (same logic as intentDelta in searchIntent.ts) ─────────

function conditionKey(c: SearchIntentCondition): string {
  return `${c.category}:${c.disposition}:${c.value.toLowerCase()}`;
}

function computeDelta(
  prev: VersionedSearchIntent,
  curr: VersionedSearchIntent,
): { added: SearchIntentCondition[]; removed: SearchIntentCondition[] } {
  const prevKeys = new Set(prev.conditions.map(conditionKey));
  const currKeys = new Set(curr.conditions.map(conditionKey));
  return {
    added: curr.conditions.filter((c) => !prevKeys.has(conditionKey(c))),
    removed: prev.conditions.filter((c) => !currKeys.has(conditionKey(c))),
  };
}

// ─── Disposition badge ─────────────────────────────────────────────────────────

const DISPOSITION_STYLE: Record<string, string> = {
  require: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
  exclude: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
  prefer: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
};

const DISPOSITION_LABEL: Record<string, string> = {
  require: "Required",
  exclude: "Excluded",
  prefer: "Preferred",
};

function ConditionBadge({ condition }: { condition: SearchIntentCondition }) {
  const cls = DISPOSITION_STYLE[condition.disposition] ?? "bg-gray-100 text-gray-800";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${cls}`}
      title={condition.note ?? condition.category}
    >
      <span className="text-xs opacity-60">{condition.category}</span>
      <span className="font-semibold">{condition.value}</span>
    </span>
  );
}

// ─── Disposition group ─────────────────────────────────────────────────────────

function DispositionGroup({
  disposition,
  conditions,
}: {
  disposition: "require" | "exclude" | "prefer";
  conditions: SearchIntentCondition[];
}) {
  if (conditions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="text-xs font-medium text-muted-foreground w-full">
        {DISPOSITION_LABEL[disposition]}
      </span>
      {conditions.map((c, i) => (
        <ConditionBadge key={i} condition={c} />
      ))}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function SearchIntentDisplay({
  current,
  history,
}: {
  current: VersionedSearchIntent;
  history: VersionedSearchIntent[];
}) {
  const required = current.conditions.filter((c) => c.disposition === "require");
  const excluded = current.conditions.filter((c) => c.disposition === "exclude");
  const preferred = current.conditions.filter((c) => c.disposition === "prefer");
  const unenforceable: UnenforcedConstraint[] = current.unenforceable_constraints ?? [];

  // Compute delta from previous version (last history entry, if any).
  const prevIntent = history.length > 0 ? history[history.length - 1] : null;
  const delta = prevIntent ? computeDelta(prevIntent, current) : null;

  const hasConditions = current.conditions.length > 0;
  const hasDelta = delta && (delta.added.length > 0 || delta.removed.length > 0);

  if (!hasConditions && unenforceable.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No sourcing intent parsed yet. Start sourcing to generate one.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Current conditions by disposition */}
      {hasConditions && (
        <div className="space-y-2">
          <DispositionGroup disposition="require" conditions={required} />
          <DispositionGroup disposition="exclude" conditions={excluded} />
          <DispositionGroup disposition="prefer" conditions={preferred} />
        </div>
      )}

      {/* Unenforceable constraints */}
      {unenforceable.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            Approximate matches only (cannot hard-filter)
          </p>
          <ul className="space-y-0.5">
            {unenforceable.map((u, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-1">
                <span className="text-orange-500 shrink-0">~</span>
                <span title={u.reason}>{u.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Delta after last feedback */}
      {hasDelta && (
        <div className="rounded bg-muted/50 px-2 py-1.5 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">After last feedback:</p>
          {delta.added.map((c, i) => (
            <p key={`a${i}`} className="text-xs text-green-700 dark:text-green-400">
              + {c.disposition} {c.category}: {c.value}
            </p>
          ))}
          {delta.removed.map((c, i) => (
            <p key={`r${i}`} className="text-xs text-red-700 dark:text-red-400">
              − {c.disposition} {c.category}: {c.value}
            </p>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground/60">
        v{current.version} · {new Date(current.updated_at).toLocaleDateString()}
      </p>
    </div>
  );
}
