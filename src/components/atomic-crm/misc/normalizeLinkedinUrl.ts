/**
 * Normalise a raw linkedin_url value into a canonical
 * "https://www.linkedin.com/in/..." URL, or null when the input is missing
 * or cannot be reliably identified as a LinkedIn profile.
 *
 * Handles:
 *   - double-prefixed  "https://https://linkedin.com/in/slug"
 *   - missing www.     "linkedin.com/in/slug"    → "https://www.linkedin.com/in/slug"
 *   - http → https
 *   - "in/slug" bare   "in/johndoe"              → "https://www.linkedin.com/in/johndoe"
 *   - bare slug        "johndoe"                 → "https://www.linkedin.com/in/johndoe"
 *     (only unambiguous slugs: no dots, no slashes, 3-100 chars)
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

  // Full linkedin.com URL (with or without www.)
  if (/^(www\.)?linkedin\.(com|[a-z]{2,3})\//i.test(stripped)) {
    // Ensure canonical www.linkedin.com host.
    if (!stripped.startsWith("www.")) {
      stripped = `www.${stripped}`;
    }
    return `https://${stripped}`;
  }

  // "in/<slug>" shorthand — prepend the host.
  if (/^in\/[a-z0-9_%-]{1,100}/i.test(stripped)) {
    return `https://www.linkedin.com/${stripped}`;
  }

  // Bare slug (no dots, no slashes, reasonable length) — assume /in/ profile.
  if (/^[a-z0-9_%-]{3,100}$/i.test(stripped)) {
    return `https://www.linkedin.com/in/${stripped}`;
  }

  return null;
}
