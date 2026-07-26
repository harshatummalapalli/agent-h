export {
  checkDailyCap,
  detectLinkedInSeatType,
  extractLinkedInSlug,
  mapUnipileAccountStatus,
} from "./unipileClientHelpers.ts";

export const UNIPILE_API_KEY = Deno.env.get("UNIPILE_API_KEY");
export const UNIPILE_DSN = Deno.env.get("UNIPILE_DSN");

export function isUnipileConfigured(): boolean {
  return Boolean(UNIPILE_API_KEY && UNIPILE_DSN);
}

export function unipileApiUrl(path: string): string {
  const base = UNIPILE_DSN!.replace(/\/$/, "");
  return `${base}/api/v1${path.startsWith("/") ? path : `/${path}`}`;
}

export async function unipileFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!isUnipileConfigured()) {
    throw new Error(
      "LinkedIn outreach isn't configured on this server yet. Ask your admin to add LinkedIn outreach secrets in Supabase Edge Function settings.",
    );
  }
  return fetch(unipileApiUrl(path), {
    ...init,
    headers: {
      "X-API-KEY": UNIPILE_API_KEY!,
      accept: "application/json",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export async function fetchUnipileAccount(
  accountId: string,
): Promise<Record<string, unknown>> {
  const response = await unipileFetch(
    `/accounts/${encodeURIComponent(accountId)}`,
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Unipile account fetch failed (${response.status}): ${JSON.stringify(
        (body as Record<string, unknown>)?.detail ?? body,
      )}`,
    );
  }
  return body as Record<string, unknown>;
}

export type UnipileUserProfile = {
  provider_id: string;
  public_identifier: string;
  first_name?: string;
  last_name?: string;
  is_open_profile?: boolean;
  is_premium?: boolean;
  headline?: string;
};

/**
 * Fetch a LinkedIn user profile from Unipile.
 * `identifier` is the public slug (e.g. "satyanadella") extracted from linkedin_url.
 * Throws on network error or non-OK response.
 */
export async function fetchUnipileUserProfile(
  accountId: string,
  identifier: string,
): Promise<UnipileUserProfile> {
  const path = `/users/${encodeURIComponent(identifier)}?account_id=${encodeURIComponent(accountId)}`;
  const response = await unipileFetch(path);
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new Error(
      `Unipile profile fetch failed (${response.status}): ${JSON.stringify(body?.detail ?? body)}`,
    );
  }
  if (!body.provider_id) {
    throw new Error("Unipile profile response missing provider_id");
  }
  return {
    provider_id: body.provider_id as string,
    public_identifier: (body.public_identifier ?? identifier) as string,
    first_name: body.first_name as string | undefined,
    last_name: body.last_name as string | undefined,
    is_open_profile: Boolean(body.is_open_profile),
    is_premium: Boolean(body.is_premium),
    headline: body.headline as string | undefined,
  };
}

/**
 * Send a LinkedIn connection request via Unipile.
 * message must be ≤300 characters (LinkedIn limit).
 * Throws on failure.
 */
export async function sendUnipileConnectionInvite(
  accountId: string,
  providerId: string,
  message: string,
): Promise<void> {
  const response = await unipileFetch("/users/invite", {
    method: "POST",
    body: JSON.stringify({
      account_id: accountId,
      provider_id: providerId,
      message,
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    throw new Error(
      `Unipile connection invite failed (${response.status}): ${JSON.stringify(body?.detail ?? body)}`,
    );
  }
}

/**
 * Send a LinkedIn open-profile InMail via Unipile (POST /chats, multipart/form-data).
 * Only works when the recipient's profile is_open_profile=true or the recruiter has InMail credits.
 * Throws on failure.
 */
export async function sendUnipileInMail(
  accountId: string,
  providerId: string,
  message: string,
): Promise<void> {
  const form = new FormData();
  form.append("account_id", accountId);
  form.append("text", message);
  form.append("attendees_ids", providerId);
  form.append("linkedin[api]", "classic");
  form.append("linkedin[inmail]", "true");

  // For FormData, we must NOT set content-type (browser/runtime sets the boundary).
  const response = await fetch(unipileApiUrl("/chats"), {
    method: "POST",
    headers: {
      "X-API-KEY": UNIPILE_API_KEY!,
      accept: "application/json",
      // content-type intentionally omitted — FormData sets it with boundary
    },
    body: form,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    throw new Error(
      `Unipile InMail send failed (${response.status}): ${JSON.stringify(body?.detail ?? body)}`,
    );
  }
}
