/** Pure helpers — no Deno.env (safe for Vitest). */

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
