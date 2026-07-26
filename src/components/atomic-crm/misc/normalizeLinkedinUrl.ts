/**
 * Normalise a raw linkedin_url value that may or may not already carry a
 * protocol prefix.  Returns a clean "https://..." URL, or null when the
 * input is missing or does not look like a LinkedIn profile.
 *
 * Handles double-prefixed values such as "https://https://linkedin.com/in/..."
 * that Exa and some free portals produce.
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
  if (!/^(www\.)?linkedin\.(com|[a-z]{2,3})\//i.test(stripped)) return null;
  return `https://${stripped}`;
}
