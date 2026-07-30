// Deterministic client-side parser for explicit exclude statements in JD text.
// Defense-in-depth: if the LLM misses "Exclude candidates at Accenture, Infosys"
// this regex pass catches it and merges the result before deal create.
//
// Strategy: find sentences that contain an exclude-trigger verb, then extract
// the company-name list that follows the preposition (at/from/working at/etc.).
// Returns titleKeywords: [] in v1 (title keyword extraction stays with LLM).

export function extractExplicitExcludesFromText(text: string): {
  companies: string[];
  titleKeywords: string[];
} {
  // Split into sentences (on . ! ? or newline) so we can work sentence-by-sentence.
  const sentences = text.split(/[.!?\n]+/);
  const raw: string[] = [];

  for (const sent of sentences) {
    const s = sent.trim();
    if (!s) continue;

    // Must contain an exclude-signal verb to be relevant.
    if (
      !/\b(?:exclude|excludes|excluding|avoid|avoids|avoiding|blacklist|block)\b/i.test(
        s,
      ) &&
      !/\bdo\s+not\s+(?:source|hire|include|recruit)\b/i.test(s) &&
      !/\bnot?\s+from\b/i.test(s) &&
      !/\bhard\s+filters?\b/i.test(s) &&
      !/\bno\s+[A-Z]/i.test(s)
    ) {
      continue;
    }

    // Find the list that follows a preposition anchor.
    // Anchor: "at", "from", "working at", "employed at/by"
    // We capture everything after the anchor up to a sentence boundary.
    const anchorMatch = s.match(
      /\b(?:at|from|working\s+at|employed\s+(?:at|by))\s+([A-Z][\w\s,&./'()-]*)/,
    );
    if (anchorMatch) {
      raw.push(anchorMatch[1]);
      continue;
    }

    // Fallback: "no X, Y, Z" pattern when in an exclude-signal sentence.
    const noMatch = s.match(/\bno\s+([A-Z][\w\s,&./'()-]*)/);
    if (noMatch) {
      raw.push(noMatch[1]);
    }
  }

  const companies = dedupeNames(raw.flatMap(splitNameList));
  return { companies, titleKeywords: [] };
}

// Split a raw match string into individual name tokens.
// "Accenture, Infosys, or Cognizant" → ["Accenture", "Infosys", "Cognizant"]
function splitNameList(raw: string): string[] {
  // Normalise ", or" and ", and" into plain commas before splitting,
  // so we don't end up with a leading "or" on the final token.
  const normalised = raw
    .replace(/,\s*(?:or|and)\s+/gi, ", ")
    .replace(/\s+(?:or|and)\s+/gi, ", ");
  return normalised
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(isLikelyCompanyName);
}

// Deduplicate case-insensitively, preserving first-seen casing.
function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const key = n.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(n);
    }
  }
  return out;
}

// Heuristic: a company name starts with an uppercase letter or digit,
// has 2–50 chars, and is not a common filler word.
const FILLER =
  /^(at|from|working|employed|including|such|as|like|any|all|no|not|the|a|an|in|with|and|or|hard|filter|filters|exception|exceptions|currently|candidates?|people|employees?|those|them)$/i;

function isLikelyCompanyName(s: string): boolean {
  if (!s || s.length < 2 || s.length > 50) return false;
  if (FILLER.test(s)) return false;
  // Must start with an uppercase letter or digit (e.g. "3M", "IBM")
  if (!/^[A-Z0-9]/.test(s)) return false;
  return true;
}
