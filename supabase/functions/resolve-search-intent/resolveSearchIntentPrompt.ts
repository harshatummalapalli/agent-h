// Prompt and tool schema for resolve-search-intent.
// Extracted from index.ts to keep the entrypoint under ~350 lines.
// No Deno-specific imports; pure serialization helpers.

import { CRUSTDATA_CAPABILITY_MANIFEST } from "../_shared/crustdataCapabilityManifest.ts";
import type {
  SearchIntentCondition,
  VersionedSearchIntent,
  UnenforcedConstraint,
} from "../_shared/searchIntent.ts";

// ─── Tool schema (forced tool-use output shape) ───────────────────────────────

export const RESOLVE_INTENT_TOOL = {
  name: "resolve_search_intent",
  description:
    "Produce an updated SearchIntent from the accumulated job description, refinements, and calibration feedback. Each condition must be a real Crustdata-filterable attribute (see capability manifest). Prefer fewer, higher-confidence conditions over many speculative ones.",
  input_schema: {
    type: "object" as const,
    required: ["conditions", "unenforceable_constraints"],
    properties: {
      conditions: {
        type: "array",
        description: "Filterable conditions — each maps to a Crustdata hard filter.",
        items: {
          type: "object",
          required: ["category", "disposition", "value"],
          properties: {
            category: {
              type: "string",
              enum: ["seniority", "company", "title", "skill", "experience_range", "location", "other"],
            },
            disposition: {
              type: "string",
              enum: ["require", "exclude", "prefer"],
            },
            value: {
              type: "string",
              description: "The specific value (e.g. 'Staff', 'Coupang', 'React', '5-10 years', 'San Francisco').",
            },
            note: {
              type: "string",
              description: "Optional clarifying note about why this condition was added.",
            },
          },
        },
      },
      unenforceable_constraints: {
        type: "array",
        description:
          "Constraints the recruiter expressed that Crustdata cannot represent as hard filters (skill recency, soft preferences, education, compensation, etc.). Never silently drop — always surface.",
        items: {
          type: "object",
          required: ["description", "reason"],
          properties: {
            description: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
    },
  },
};

// ─── System prompt ────────────────────────────────────────────────────────────

export function buildSystemPrompt(): string {
  const cannotList = CRUSTDATA_CAPABILITY_MANIFEST.cannotFilter
    .map((c) => `• ${c.description}: ${c.reason}`)
    .join("\n");

  return `You are a sourcing-intent resolver for a recruitment platform.
Your job: given a job description, past conversation, and calibration feedback, produce a structured SearchIntent that captures what the role truly requires, excludes, and prefers — mapped to Crustdata's actual search capabilities.

## Crustdata capability manifest (v${CRUSTDATA_CAPABILITY_MANIFEST.version})
You can ONLY express the following as hard filters:
${CRUSTDATA_CAPABILITY_MANIFEST.canFilter.map((f) => `• ${f}`).join("\n")}

## What Crustdata CANNOT filter (route these to unenforceable_constraints):
${cannotList}

## Rules
1. Use "require" for hard requirements the JD clearly states.
2. Use "exclude" for things that must NOT be in the candidate profile (explicit exclusions from the user).
3. Use "prefer" ONLY for soft signals — these go to ranking/why-fit, not to filters. Most "prefer" signals are unenforceable — when in doubt, classify as unenforceable_constraints.
4. When recalibration feedback says "not a fit because X" → add an exclude condition for X if X is filterable, or route to unenforceable_constraints if not.
5. Be conservative: fewer, high-confidence conditions beat a long list of speculative ones.
6. When the previous SearchIntent exists, CARRY FORWARD its conditions unless the new input explicitly contradicts them. Update, don't reset.
7. For experience_range, use the value format: "min:N", "max:N", or "N-M" (e.g. "min:5", "3-8").

## Exclude language (critical — never silently drop)
When the recruiter says any of the following, emit a company/exclude or title/exclude condition:
• "exclude Cognizant", "no Cognizant", "not Cognizant" → category: "company", disposition: "exclude", value: "Cognizant"
• "no MAANG", "not from FAANG" → one company/exclude per company: "Meta", "Apple", "Amazon", "Netflix", "Google"
• "no TCS", "not from TCS/Infosys" → company/exclude for each named company
• "no IT service companies", "no consulting firms" → route to unenforceable_constraints (too broad to hard-filter)
• "exclude contractor titles", "no managers" → category: "title", disposition: "exclude", value: "Manager" (or the keyword)
IMPORTANT: company/exclude and title/exclude conditions are ALWAYS carried forward across turns unless explicitly reversed.`;
}

// ─── User message ─────────────────────────────────────────────────────────────

export function buildUserMessage(params: {
  jd_text?: string;
  refine_history?: string[];
  calibration_feedback?: string[];
  previous_intent?: VersionedSearchIntent | null;
}): string {
  const parts: string[] = [];

  if (params.jd_text) {
    parts.push(`## Job Description\n${params.jd_text}`);
  }

  if (params.refine_history?.length) {
    parts.push(
      `## Recruiter Refinements\n${params.refine_history.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
    );
  }

  if (params.calibration_feedback?.length) {
    parts.push(
      `## Calibration Feedback (from candidates shown)\n${params.calibration_feedback.map((f, i) => `${i + 1}. ${f}`).join("\n")}`,
    );
  }

  if (params.previous_intent) {
    const prevConditions = params.previous_intent.conditions
      .map((c) => `  • [${c.disposition}] ${c.category}: "${c.value}"${c.note ? ` (${c.note})` : ""}`)
      .join("\n");
    const prevUnenforceable = params.previous_intent.unenforceable_constraints
      .map((u) => `  • ${u.description}`)
      .join("\n");
    parts.push(
      `## Previous SearchIntent (v${params.previous_intent.version})\nConditions:\n${prevConditions || "  (none)"}` +
      (prevUnenforceable ? `\nUnenforceable:\n${prevUnenforceable}` : ""),
    );
  }

  parts.push(
    "Produce the updated SearchIntent. Carry forward previous conditions unless explicitly contradicted. Add new conditions from the inputs above.",
  );

  return parts.join("\n\n");
}

// ─── Parse tool output ────────────────────────────────────────────────────────

export function parseToolOutput(toolInput: Record<string, unknown>): {
  conditions: SearchIntentCondition[];
  unenforceable_constraints: UnenforcedConstraint[];
} {
  const conditions = (toolInput.conditions as SearchIntentCondition[]) ?? [];
  const unenforceable_constraints =
    (toolInput.unenforceable_constraints as UnenforcedConstraint[]) ?? [];
  return { conditions, unenforceable_constraints };
}
