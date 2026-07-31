/**
 * Normalise a raw linkedin_url value into a canonical, dedup-safe key.
 *
 * Rules:
 *   - null / undefined / "" / non-linkedin → null
 *   - strip protocol (http:// or https://)
 *   - strip leading www.
 *   - strip trailing slash
 *   - strip query string / fragment
 *   - lowercase
 *
 * Output is always in the form "linkedin.com/in/slug" (no protocol, no www).
 * Returns null for anything that doesn't contain "linkedin.com".
 *
 * Pure function — no runtime dependencies.  Safe to import from both Deno
 * edge functions and Vitest test suites.
 */
export function normalizeLinkedinUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;

  let s = url.trim().toLowerCase();
  if (!s) return null;

  // Strip protocol
  s = s.replace(/^https?:\/\//i, "");

  // Strip leading www.
  s = s.replace(/^www\./i, "");

  // Strip fragment
  const hashIdx = s.indexOf("#");
  if (hashIdx !== -1) s = s.slice(0, hashIdx);

  // Strip query string
  const qIdx = s.indexOf("?");
  if (qIdx !== -1) s = s.slice(0, qIdx);

  // Strip trailing slash
  s = s.replace(/\/+$/, "");

  // Must contain linkedin.com to be a valid linkedin URL
  if (!s.includes("linkedin.com")) return null;

  return s;
}
