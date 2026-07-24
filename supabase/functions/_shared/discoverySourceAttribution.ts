// Server-side discovery vendor attribution (2026-07-24): maps vendor person
// ids (source_id) to the provider that returned them for a role-brief search,
// so save-sourced-candidate can set sourced_via without trusting the client.
// Pure helpers live here (Vitest-testable without Deno); HTTP persistence is
// called from source-candidates-discovery/index.ts via persistDiscoverySourceAttribution.

export type DiscoveryAttributionRow = {
  deal_id: number;
  source_id: string;
  vendor: string;
  expires_at: string;
};

export function isDiscoverySearchContinuation(params: {
  scrollToken?: string;
  isPreview: boolean;
  cachedScrollQuery: string | null;
  cachedScrollToken: string | null;
  queryText: string;
}): boolean {
  if (params.isPreview) return false;
  if (params.scrollToken) return true;
  return (
    params.cachedScrollQuery === params.queryText &&
    Boolean(params.cachedScrollToken)
  );
}

export function buildDiscoveryAttributionRows(
  dealId: number,
  vendor: string,
  candidates: Array<Record<string, unknown>>,
  now: Date = new Date(),
): DiscoveryAttributionRow[] {
  const expiresAt = new Date(
    now.getTime() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rows: DiscoveryAttributionRow[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const sourceId =
      typeof candidate.id === "string" && candidate.id.length > 0
        ? candidate.id
        : null;
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    rows.push({
      deal_id: dealId,
      source_id: sourceId,
      vendor,
      expires_at: expiresAt,
    });
  }

  return rows;
}

export function vendorToSourcedVia(vendor: string | null | undefined): string {
  if (!vendor) return "manual";
  return `${vendor}_search`;
}

export function stripVendorFieldsForClient(
  candidate: Record<string, unknown>,
): Record<string, unknown> {
  const { _source_vendor: _omit, ...clientCandidate } = candidate;
  return clientCandidate;
}

export function buildDiscoveryAttributionLookupPath(
  dealId: number,
  sourceId: string,
  nowIso: string,
): string {
  return (
    `discovery_source_attribution?deal_id=eq.${dealId}` +
    `&source_id=eq.${encodeURIComponent(sourceId)}` +
    `&expires_at=gt.${encodeURIComponent(`"${nowIso}"`)}` +
    `&select=vendor&limit=1`
  );
}

export function parseAttributionVendorFromRows(rows: unknown): string | null {
  const vendor = (rows as Array<{ vendor?: unknown }> | null)?.[0]?.vendor;
  return typeof vendor === "string" ? vendor : null;
}

export function resolveSourcedViaFromAttributionVendor(
  vendor: string | null | undefined,
): string {
  return vendorToSourcedVia(vendor);
}
