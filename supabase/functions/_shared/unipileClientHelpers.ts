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

export function detectLinkedInSeatType(
  account: Record<string, unknown>,
): string | null {
  const sources = account.sources;
  if (Array.isArray(sources)) {
    for (const source of sources) {
      if (!source || typeof source !== "object") continue;
      const row = source as Record<string, unknown>;
      const provider = String(row.provider ?? row.type ?? "").toUpperCase();
      if (provider !== "LINKEDIN") continue;
      if (typeof row.seat_type === "string") return row.seat_type;
      if (typeof row.account_type === "string") return row.account_type;
      const params = row.connection_params as
        | Record<string, unknown>
        | undefined;
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
  const rawStatus = String(account.status ?? account.state ?? "").toUpperCase();
  if (rawStatus === "CREDENTIALS" || rawStatus === "DISCONNECTED") {
    return { status: "credentials_required", checkpoint_type: null };
  }

  const checkpoint = account.checkpoint;
  if (checkpoint && typeof checkpoint === "object") {
    const cp = checkpoint as Record<string, unknown>;
    return {
      status: "checkpoint_pending",
      checkpoint_type: String(cp.type ?? "unknown"),
    };
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
