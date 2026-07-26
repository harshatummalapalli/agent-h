/** Pure helpers — no Deno.env (safe for Vitest). */

/**
 * Extract the public identifier (slug) from a LinkedIn profile URL.
 * Handles both /in/<slug> and /in/<slug>/ forms, plus bare slugs.
 * Returns null if the URL cannot be parsed.
 */
export function extractLinkedInSlug(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    const parts = u.pathname.replace(/\/$/, "").split("/");
    // Expect /in/<slug> path
    const inIdx = parts.indexOf("in");
    if (inIdx !== -1 && parts[inIdx + 1]) return parts[inIdx + 1];
    // Fallback: last non-empty path segment, or hostname if no path
    const last = parts.filter(Boolean).pop();
    if (last) return last;
    // Bare slug was treated as hostname (e.g. new URL("https://satyanadella"))
    if (!u.hostname.includes(".")) return u.hostname;
    return null;
  } catch {
    return url.replace(/\/$/, "").split("/").pop() ?? null;
  }
}

/**
 * Check and advance the daily LinkedIn send counter for a sale row.
 * Returns { sends_today, cap, can_send, cap_remaining } based on the
 * sale's current column values and today's date (UTC).
 */
export function checkDailyCap(sale: {
  linkedin_daily_send_cap?: number | null;
  linkedin_sends_today?: number | null;
  linkedin_sends_reset_date?: string | null;
}): {
  sends_today: number;
  cap: number;
  can_send: boolean;
  cap_remaining: number;
  needs_reset: boolean;
} {
  const cap = sale.linkedin_daily_send_cap ?? 80;
  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const needsReset =
    !sale.linkedin_sends_reset_date ||
    sale.linkedin_sends_reset_date !== todayStr;
  const sends_today = needsReset ? 0 : (sale.linkedin_sends_today ?? 0);
  const cap_remaining = Math.max(0, cap - sends_today);
  return {
    sends_today,
    cap,
    can_send: sends_today < cap,
    cap_remaining,
    needs_reset: needsReset,
  };
}

function _seatFromPremiumFeatures(features: unknown): string | null {
  if (!Array.isArray(features)) return null;
  const f = features.map((x) => String(x).toLowerCase());
  if (f.includes("recruiter")) return "recruiter";
  if (f.some((x) => x.includes("sales"))) return "sales_navigator";
  if (f.includes("premium")) return "premium";
  return null;
}

export function detectLinkedInSeatType(
  account: Record<string, unknown>,
): string | null {
  // Real Unipile shape: connection_params.im.premiumFeatures at account root
  const rootParams = account.connection_params as
    | Record<string, unknown>
    | undefined;
  const rootIm = rootParams?.im as Record<string, unknown> | undefined;
  const rootSeat = _seatFromPremiumFeatures(rootIm?.premiumFeatures);
  if (rootSeat) return rootSeat;

  const sources = account.sources;
  if (Array.isArray(sources)) {
    for (const source of sources) {
      if (!source || typeof source !== "object") continue;
      const row = source as Record<string, unknown>;
      if (typeof row.seat_type === "string") return row.seat_type;
      if (typeof row.account_type === "string") return row.account_type;
      const params = row.connection_params as
        | Record<string, unknown>
        | undefined;
      const im = params?.im as Record<string, unknown> | undefined;
      const srcSeat = _seatFromPremiumFeatures(im?.premiumFeatures);
      if (srcSeat) return srcSeat;
      // Legacy boolean flags
      if (params?.recruiter === true) return "recruiter";
      if (params?.sales_navigator === true) return "sales_navigator";
      if (params?.premium === true) return "premium";
    }
  }

  const type = String(account.type ?? account.provider ?? "").toLowerCase();
  if (type.includes("recruiter")) return "recruiter";
  if (type.includes("sales")) return "sales_navigator";
  if (type.includes("premium")) return "premium";
  return account.id ? "classic" : null;
}

export function mapUnipileAccountStatus(account: Record<string, unknown>): {
  status: string;
  checkpoint_type: string | null;
} {
  // Checkpoint takes priority regardless of where status appears
  const checkpoint = account.checkpoint;
  if (checkpoint && typeof checkpoint === "object") {
    const cp = checkpoint as Record<string, unknown>;
    return {
      status: "checkpoint_pending",
      checkpoint_type: String(cp.type ?? "unknown"),
    };
  }

  // Real Unipile /accounts/{id}: status lives in sources[].status, not top-level
  const sources = account.sources;
  if (Array.isArray(sources) && sources.length > 0) {
    const statuses = sources
      .filter((s) => s && typeof s === "object")
      .map((s) =>
        String((s as Record<string, unknown>).status ?? "").toUpperCase(),
      );
    if (
      statuses.some(
        (s) => s === "CREDENTIALS" || s === "DISCONNECTED" || s === "ERROR",
      )
    ) {
      return { status: "credentials_required", checkpoint_type: null };
    }
    if (
      statuses.some((s) => s === "OK" || s === "CONNECTED" || s === "RUNNING")
    ) {
      return { status: "connected", checkpoint_type: null };
    }
  }

  // Fallback: top-level status/state for forward-compat and older Unipile shapes
  const rawStatus = String(account.status ?? account.state ?? "").toUpperCase();
  if (rawStatus === "CREDENTIALS" || rawStatus === "DISCONNECTED") {
    return { status: "credentials_required", checkpoint_type: null };
  }
  if (rawStatus === "ERROR") {
    return { status: "credentials_required", checkpoint_type: null };
  }
  if (
    rawStatus === "OK" ||
    rawStatus === "CONNECTED" ||
    rawStatus === "RUNNING"
  ) {
    return { status: "connected", checkpoint_type: null };
  }

  return {
    status: rawStatus ? rawStatus.toLowerCase() : "unknown",
    checkpoint_type: null,
  };
}
