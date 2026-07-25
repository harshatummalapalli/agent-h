export {
  detectLinkedInSeatType,
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
      "Unipile is not configured — set UNIPILE_API_KEY and UNIPILE_DSN as Edge Function secrets.",
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
