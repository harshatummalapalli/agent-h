// Batch LLM rank of up to 100 discovery candidates against a role brief.
// Returns ranked IDs + short why-fit text for the top 25 — one Claude call.
// Non-fatal: if ANTHROPIC_API_KEY is missing the caller still gets empty rankings.
//
// T4: also accepts optional search_intent (VersionedSearchIntent) in the request
// body. When present, buildPrompt walks tagged conditions + unenforceable_constraints
// and instructs the model to flag conflicts plainly — e.g. "currently Staff-level,
// which was excluded". Callers that don't pass search_intent get the original prompt
// unchanged (backward-compatible).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  jsonResponse,
  serveCandidateFacingFunction,
} from "../_shared/candidateFacingEdge.ts";
import type { VersionedSearchIntent } from "../_shared/searchIntent.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

type CandidateSummary = {
  id: string;
  full_name?: string | null;
  job_title?: string | null;
  job_company_name?: string | null;
  location_name?: string | null;
  skills?: string[] | null;
  years_experience?: number | null;
};

type RoleBriefSummary = {
  name?: string | null;
  seniority?: string | null;
  location?: string | null;
  required_skills?: string[] | null;
  must_have_keywords?: string[] | null;
  nice_to_have_keywords?: string[] | null;
  years_experience_min?: number | null;
  years_experience_max?: number | null;
};

type RankedEntry = {
  id: string;
  rank: number;
  why_fit: string;
};

/** Build the ranking prompt. Accepts optional SearchIntent for conflict-aware why-fit. */
export function buildPrompt(
  role: RoleBriefSummary,
  candidates: CandidateSummary[],
  searchIntent?: VersionedSearchIntent | null,
): string {
  const roleLines = [
    `Role: ${role.name ?? "Unspecified"}`,
    role.seniority ? `Seniority: ${role.seniority}` : null,
    role.location ? `Location: ${role.location}` : null,
    role.years_experience_min != null || role.years_experience_max != null
      ? `Experience: ${role.years_experience_min ?? 0}–${role.years_experience_max ?? "∞"} years`
      : null,
    role.required_skills?.length
      ? `Required skills: ${role.required_skills.join(", ")}`
      : null,
    role.must_have_keywords?.length
      ? `Must-haves: ${role.must_have_keywords.join(", ")}`
      : null,
    role.nice_to_have_keywords?.length
      ? `Nice-to-haves: ${role.nice_to_have_keywords.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Build SearchIntent context section when available.
  let intentSection = "";
  if (searchIntent?.conditions?.length) {
    const required = searchIntent.conditions.filter((c) => c.disposition === "require");
    const excluded = searchIntent.conditions.filter((c) => c.disposition === "exclude");
    const preferred = searchIntent.conditions.filter((c) => c.disposition === "prefer");
    const lines: string[] = ["SOURCING INTENT (use for conflict detection in why_fit):"];
    if (required.length) lines.push(`  Required: ${required.map((c) => `${c.category}:${c.value}`).join(", ")}`);
    if (excluded.length) lines.push(`  EXCLUDED (hard): ${excluded.map((c) => `${c.category}:${c.value}`).join(", ")}`);
    if (preferred.length) lines.push(`  Preferred: ${preferred.map((c) => `${c.category}:${c.value}`).join(", ")}`);
    if (searchIntent.unenforceable_constraints?.length) {
      lines.push(`  Context-only (not filtered): ${searchIntent.unenforceable_constraints.map((u) => u.description).join("; ")}`);
    }
    intentSection = `\n${lines.join("\n")}\n`;
  }

  const candidateLines = candidates
    .map((c, i) => {
      const parts = [
        `[${i + 1}] id=${c.id}`,
        c.full_name ? `name=${c.full_name}` : null,
        c.job_title ? `title=${c.job_title}` : null,
        c.job_company_name ? `company=${c.job_company_name}` : null,
        c.location_name ? `location=${c.location_name}` : null,
        c.years_experience != null ? `exp=${c.years_experience}yr` : null,
        c.skills?.length ? `skills=${c.skills.slice(0, 8).join(",")}` : null,
      ].filter(Boolean);
      return parts.join(" | ");
    })
    .join("\n");

  const conflictInstruction = searchIntent?.conditions?.some((c) => c.disposition === "exclude")
    ? `\n  IMPORTANT: For each candidate, if their profile matches any EXCLUDED condition above, call it out plainly in why_fit — e.g. "currently Staff-level, which was excluded" or "currently at Coupang, which was excluded". Do NOT be generically positive when there is a clear conflict.`
    : "";

  return `You are a technical recruiter ranking candidates for a role.

ROLE BRIEF:
${roleLines}
${intentSection}
CANDIDATES (${candidates.length} total):
${candidateLines}

TASK: Rank the top 25 best-fit candidates for this role.
For each candidate write a one-sentence why_fit that:
1. Names at least one concrete piece of evidence from the profile (specific skill, job title, company, or location that matches the role).
2. If must-haves or required skills are listed, explicitly notes whether each is evidenced or absent — e.g. "no evidence of .NET/C# in profile".
3. Is never empty. If the profile has very little information, write what IS there (e.g. "AI/ML background; location and skills data sparse").${conflictInstruction}

Respond with ONLY a JSON array (no prose before or after), in rank order (best first):
[
  { "id": "<candidate id>", "rank": 1, "why_fit": "..." },
  ...
]

Include exactly up to 25 entries. Use only ids from the candidate list above. Every why_fit must be non-empty.`;
}

async function callClaude(prompt: string): Promise<RankedEntry[]> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic error ${response.status}`);
  }

  const result = await response.json();
  const text = (result?.content?.[0]?.text as string | undefined) ?? "";

  // Extract JSON array from the response
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array in Claude response");
  return JSON.parse(match[0]) as RankedEntry[];
}

const handler = async (req: Request) => {
  if (req.method !== "POST")
    return jsonResponse({ error: "Method Not Allowed" }, 405);

  if (!ANTHROPIC_API_KEY) {
    // Non-fatal: return empty rankings so the caller degrades gracefully
    return jsonResponse({ ranked: [], note: "ANTHROPIC_API_KEY not set" });
  }

  let candidates: CandidateSummary[];
  let role: RoleBriefSummary;
  let searchIntent: VersionedSearchIntent | null = null;
  try {
    const body = await req.json();
    candidates = Array.isArray(body?.candidates) ? body.candidates : [];
    role = body?.role_brief ?? body?.role ?? {};
    searchIntent = body?.search_intent ?? null;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (candidates.length === 0) {
    return jsonResponse({ ranked: [] });
  }

  // Cap at 100 to bound token cost
  const batch = candidates.slice(0, 100);

  try {
    const prompt = buildPrompt(role, batch, searchIntent);
    const ranked = await callClaude(prompt);
    // Validate that returned ids actually came from our batch
    const validIds = new Set(batch.map((c) => c.id));
    const nameById = new Map(
      batch.map((c) => [
        c.id,
        [c.job_title, c.job_company_name].filter(Boolean).join(" at "),
      ]),
    );
    const safe = ranked
      .filter((r) => validIds.has(r.id) && typeof r.rank === "number")
      .map((r) => ({
        ...r,
        // Guarantee non-empty why_fit — fall back to headline if Claude returned "".
        why_fit:
          r.why_fit?.trim() ||
          (nameById.get(r.id) ?? "Profile ranked; no explanation returned."),
      }))
      .slice(0, 25);
    return jsonResponse({ ranked: safe });
  } catch (error) {
    console.error("rank-discovery-batch Claude error", error);
    // Non-fatal: caller handles empty rankings gracefully
    return jsonResponse({
      ranked: [],
      note: error instanceof Error ? error.message : "Ranking failed",
    });
  }
};

serveCandidateFacingFunction(handler);
