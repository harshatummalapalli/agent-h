/**
 * Normalise a raw linkedin_url value into a canonical
 * "https://www.linkedin.com/..." URL.
 *
 * Permissive: if the string contains "linkedin" anywhere (case-insensitive),
 * this function always returns a clickable https URL — never null.
 * Only returns null for empty / null / undefined inputs or strings with no
 * linkedin reference at all.
 *
 * Handles:
 *   - double-prefixed  "https://https://linkedin.com/in/slug"
 *   - missing www.     "linkedin.com/in/slug"
 *   - http → https
 *   - "in/slug" bare   "in/johndoe"
 *   - bare slug        "johndoe" (only unambiguous: no dots/slashes, 3-100 chars)
 *   - company URLs     "linkedin.com/company/acme"
 *   - any other path   kept as-is under www.linkedin.com
 */
export function normalizeLinkedinUrl(
  url: string | null | undefined,
): string | null {
  if (!url?.trim()) return null;

  // Strip ALL leading protocol prefixes (handles double https://https:// too).
  let stripped = url.trim();
  while (/^https?:\/\//i.test(stripped)) {
    stripped = stripped.replace(/^https?:\/\//i, "");
  }

  // Any value that mentions "linkedin" gets a best-effort canonical URL.
  if (/linkedin/i.test(stripped)) {
    // Already has linkedin.com host (with or without www., any TLD).
    if (/^(www\.)?linkedin\.(com|[a-z]{2,3})\//i.test(stripped)) {
      // Normalise to www.linkedin.com.
      const path = stripped.replace(/^(www\.)?linkedin\.[a-z]{2,3}\//i, "");
      return `https://www.linkedin.com/${path}`;
    }
    // "in/slug" shorthand.
    if (/^in\/[a-z0-9_%-]{1,100}/i.test(stripped)) {
      return `https://www.linkedin.com/${stripped}`;
    }
    // Contains "linkedin" but doesn't match the patterns above — treat as a
    // bare slug or partial identifier and place it under /in/.
    return `https://www.linkedin.com/in/${stripped}`;
  }

  // No "linkedin" in the string — try the original heuristics for bare slugs
  // and "in/<slug>" shorthand (Crustdata sometimes returns these without the host).
  if (/^in\/[a-z0-9_%-]{1,100}/i.test(stripped)) {
    return `https://www.linkedin.com/${stripped}`;
  }
  if (/^[a-z0-9_%-]{3,100}$/i.test(stripped)) {
    return `https://www.linkedin.com/in/${stripped}`;
  }

  return null;
}
