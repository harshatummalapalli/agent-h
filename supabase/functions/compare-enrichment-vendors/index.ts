// Agent H — Enrichment vendor comparison harness (Task 2).
//
// Modes (POST JSON body.mode):
//   permissions   — FREE: Crustdata /account/credits + /account/endpoints
//                   (esp. /person/contact/enrich). No PDL spend.
//   probe_contact — ONE LinkedIn URL through Crustdata Contact Enrich only.
//                   Refuse if permissions say disabled (unless force: true).
//   compare       — Profile enrich (Crustdata + PDL) for up to N LinkedIn
//                   URLs from body.linkedin_urls OR deal_id → role_discovery_cache.
//                   Optionally include Contact Enrich when permitted.
//
// Credit discipline matches the standing brief: confirm taxonomy/permissions
// before burning credits; do not assume the old Contact Enrich 403 still holds
// without checking /account/endpoints first.
//
// Secrets: CRUSTDATA_API_KEY, PDL_API_KEY (already used by other functions).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";

import {
  enrichCrustdataContact,
  enrichCrustdataProfiles,
  getCrustdataCredits,
  getCrustdataEndpointPermissions,
  normalizeCrustdataEnrichment,
  type NormalizedEnrichment,
} from "../_shared/crustdataEnrichClient.ts";
import {
  enrichPdlPerson,
  normalizePdlEnrichment,
} from "../_shared/pdlEnrichClient.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

const CRUSTDATA_API_KEY = Deno.env.get("CRUSTDATA_API_KEY");
const PDL_API_KEY = Deno.env.get("PDL_API_KEY");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });

async function requireAuth(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing authorization header" }, 401);
  }
  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer" || !token) {
    return jsonResponse({ error: "Invalid authorization header" }, 401);
  }
  try {
    await jose.jwtVerify(token, SUPABASE_JWT_KEYS, {
      issuer: SUPABASE_JWT_ISSUER,
    });
    return null;
  } catch {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
}

async function restFetch(
  path: string,
  authHeader: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_ANON_KEY ?? "",
      Authorization: authHeader,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

// role_discovery_cache: one row per deal; payload is RawCandidate[]
// (see schemas/36_agent_h_role_discovery_cache.sql + calibration-session).
type PayloadCandidate = {
  linkedin_url?: string | null;
  full_name?: string | null;
};

async function loadDealLinkedinUrls(
  dealId: number,
  authHeader: string,
  limit: number,
): Promise<Array<{ linkedin_url: string; label: string | null }>> {
  const response = await restFetch(
    `role_discovery_cache?deal_id=eq.${dealId}&select=payload`,
    authHeader,
  );
  if (!response.ok) {
    throw new Error(
      `Failed to read role_discovery_cache (${response.status}): ${await response.text()}`,
    );
  }
  const rows = (await response.json()) as Array<{
    payload?: PayloadCandidate[];
  }>;
  const payload = rows?.[0]?.payload;
  if (!Array.isArray(payload)) return [];

  const out: Array<{ linkedin_url: string; label: string | null }> = [];
  const seen = new Set<string>();
  for (const item of payload) {
    const url =
      typeof item?.linkedin_url === "string" ? item.linkedin_url.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      linkedin_url: url,
      label: typeof item.full_name === "string" ? item.full_name : null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function contactEndpointStatus(
  endpointsBody: {
    endpoints?: Array<{ path: string; status: string }>;
  } | null,
): { path: string; status: string } | null {
  const hit = endpointsBody?.endpoints?.find(
    (e) => e.path === "/person/contact/enrich",
  );
  return hit ?? null;
}

function summarizePair(crust: NormalizedEnrichment, pdl: NormalizedEnrichment) {
  return {
    linkedin_url: crust.linkedin_url,
    crustdata: {
      matched: crust.matched,
      personal_email_count: crust.personal_emails.length,
      business_email_count: crust.business_emails.length,
      phone_count: crust.phones.length,
      employment_count: crust.employment.length,
      social_count: crust.social_profiles.length,
      notes: crust.notes,
    },
    pdl: {
      matched: pdl.matched,
      personal_email_count: pdl.personal_emails.length,
      business_email_count: pdl.business_emails.length,
      phone_count: pdl.phones.length,
      employment_count: pdl.employment.length,
      social_count: pdl.social_profiles.length,
      notes: pdl.notes,
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  const authFail = await requireAuth(req);
  if (authFail) return authFail;
  const authHeader = req.headers.get("authorization")!;

  let body: {
    mode?: string;
    linkedin_url?: string;
    linkedin_urls?: string[];
    deal_id?: number;
    limit?: number;
    include_contact?: boolean;
    force?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const mode = body.mode ?? "permissions";

  if (!CRUSTDATA_API_KEY && mode !== "compare") {
    // compare can still run PDL-only if Crustdata missing, but permissions
    // / probe need Crustdata.
    return jsonResponse(
      {
        error:
          "CRUSTDATA_API_KEY is not configured on this project (Edge Function secrets).",
      },
      400,
    );
  }

  // ── permissions (free) ────────────────────────────────────────────────
  if (mode === "permissions") {
    const [credits, allEndpoints, contactEndpoints] = await Promise.all([
      getCrustdataCredits(CRUSTDATA_API_KEY!),
      getCrustdataEndpointPermissions(CRUSTDATA_API_KEY!),
      getCrustdataEndpointPermissions(
        CRUSTDATA_API_KEY!,
        "/person/contact/enrich",
      ),
    ]);
    return jsonResponse({
      mode,
      credits: {
        ok: credits.ok,
        status: credits.status,
        remaining: credits.body?.account?.credits ?? null,
        raw: credits.body,
      },
      contact_enrich: contactEndpointStatus(contactEndpoints.body),
      endpoints_sample: (allEndpoints.body?.endpoints ?? [])
        .filter((e) => e.path.startsWith("/person/"))
        .map((e) => ({ path: e.path, status: e.status })),
      note: "These account calls are free. Next: mode=probe_contact with one LinkedIn URL if contact_enrich.status is enabled.",
    });
  }

  // ── probe_contact (1 URL) ─────────────────────────────────────────────
  if (mode === "probe_contact") {
    const url = body.linkedin_url?.trim();
    if (!url) {
      return jsonResponse(
        { error: "linkedin_url is required for probe_contact" },
        400,
      );
    }

    const perm = await getCrustdataEndpointPermissions(
      CRUSTDATA_API_KEY!,
      "/person/contact/enrich",
    );
    const contactStatus = contactEndpointStatus(perm.body);
    if (contactStatus?.status === "disabled" && !body.force) {
      return jsonResponse({
        mode,
        skipped: true,
        reason:
          "GET /account/endpoints reports /person/contact/enrich as disabled. Not spending credits. Pass force:true to attempt anyway.",
        contact_enrich: contactStatus,
        credits_before: (await getCrustdataCredits(CRUSTDATA_API_KEY!)).body
          ?.account?.credits,
      });
    }

    const creditsBefore = await getCrustdataCredits(CRUSTDATA_API_KEY!);
    const result = await enrichCrustdataContact(
      CRUSTDATA_API_KEY!,
      [url],
      [
        "contact.business_emails",
        "contact.personal_emails",
        "contact.phone_numbers",
      ],
    );
    const creditsAfter = await getCrustdataCredits(CRUSTDATA_API_KEY!);
    const entry = result.body?.[0] ?? null;
    const normalized = normalizeCrustdataEnrichment(url, entry, {
      contactOnly: true,
    });

    return jsonResponse({
      mode,
      contact_enrich_permission: contactStatus,
      http_status: result.status,
      error_type: result.errorType ?? null,
      credits_before: creditsBefore.body?.account?.credits ?? null,
      credits_after: creditsAfter.body?.account?.credits ?? null,
      normalized,
      raw: result.body,
      note:
        result.status === 403
          ? "403 — still plan-gated or key-restricted (matches earlier trial finding + current docs for self-serve)."
          : "Inspect personal_emails / phone_numbers; email status is deliverability, not inferred.",
    });
  }

  // ── compare ───────────────────────────────────────────────────────────
  if (mode === "compare") {
    const limit = Math.min(Math.max(body.limit ?? 5, 1), 10);
    let targets: Array<{ linkedin_url: string; label: string | null }> = [];

    if (Array.isArray(body.linkedin_urls) && body.linkedin_urls.length) {
      targets = body.linkedin_urls.slice(0, limit).map((u) => ({
        linkedin_url: u,
        label: null,
      }));
    } else if (typeof body.deal_id === "number") {
      targets = await loadDealLinkedinUrls(body.deal_id, authHeader, limit);
    } else {
      return jsonResponse(
        {
          error:
            "compare requires linkedin_urls[] or deal_id (e.g. 14 for the Hyderabad brief).",
        },
        400,
      );
    }

    if (targets.length === 0) {
      return jsonResponse(
        {
          mode,
          error: "No LinkedIn URLs found for comparison.",
          deal_id: body.deal_id ?? null,
        },
        404,
      );
    }

    const includeContact = body.include_contact === true;
    let contactAllowed = false;
    if (includeContact && CRUSTDATA_API_KEY) {
      const perm = await getCrustdataEndpointPermissions(
        CRUSTDATA_API_KEY,
        "/person/contact/enrich",
      );
      contactAllowed =
        contactEndpointStatus(perm.body)?.status === "enabled" ||
        body.force === true;
    }

    const creditsBefore = CRUSTDATA_API_KEY
      ? await getCrustdataCredits(CRUSTDATA_API_KEY)
      : null;

    const rows: Array<{
      label: string | null;
      summary: ReturnType<typeof summarizePair>;
      crustdata_profile: NormalizedEnrichment | null;
      crustdata_contact: NormalizedEnrichment | null;
      pdl: NormalizedEnrichment | null;
    }> = [];

    for (const target of targets) {
      let crustProfile: NormalizedEnrichment | null = null;
      let crustContact: NormalizedEnrichment | null = null;
      let pdlNorm: NormalizedEnrichment | null = null;

      if (CRUSTDATA_API_KEY) {
        const profileRes = await enrichCrustdataProfiles(CRUSTDATA_API_KEY, [
          target.linkedin_url,
        ]);
        crustProfile = normalizeCrustdataEnrichment(
          target.linkedin_url,
          profileRes.body?.[0],
        );
        if (!profileRes.ok) {
          crustProfile.notes.push(
            `profile enrich HTTP ${profileRes.status} ${profileRes.errorType ?? ""}`,
          );
        }

        if (includeContact && contactAllowed) {
          const contactRes = await enrichCrustdataContact(CRUSTDATA_API_KEY, [
            target.linkedin_url,
          ]);
          crustContact = normalizeCrustdataEnrichment(
            target.linkedin_url,
            contactRes.body?.[0],
            { contactOnly: true },
          );
          if (!contactRes.ok) {
            crustContact.notes.push(
              `contact enrich HTTP ${contactRes.status} ${contactRes.errorType ?? ""}`,
            );
          }
        }
      }

      if (PDL_API_KEY) {
        const pdlRes = await enrichPdlPerson(PDL_API_KEY, target.linkedin_url);
        pdlNorm = normalizePdlEnrichment(target.linkedin_url, pdlRes);
        if (!pdlRes.ok && pdlRes.status !== 404) {
          pdlNorm.notes.push(`PDL HTTP ${pdlRes.status}`);
        }
      } else {
        pdlNorm = {
          vendor: "pdl",
          linkedin_url: target.linkedin_url,
          matched: false,
          personal_emails: [],
          business_emails: [],
          phones: [],
          employment: [],
          social_profiles: [],
          notes: ["PDL_API_KEY not configured"],
        };
      }

      const mergedCrust: NormalizedEnrichment = crustProfile ?? {
        vendor: "crustdata",
        linkedin_url: target.linkedin_url,
        matched: false,
        personal_emails: [],
        business_emails: [],
        phones: [],
        employment: [],
        social_profiles: [],
        notes: ["CRUSTDATA_API_KEY not configured"],
      };
      if (crustContact?.matched) {
        mergedCrust.personal_emails = crustContact.personal_emails;
        mergedCrust.phones = crustContact.phones;
        mergedCrust.mobile = crustContact.mobile;
        mergedCrust.business_emails = [
          ...mergedCrust.business_emails,
          ...crustContact.business_emails,
        ];
        mergedCrust.notes = [
          ...mergedCrust.notes,
          ...crustContact.notes.map((n) => `contact: ${n}`),
        ];
      }

      rows.push({
        label: target.label,
        summary: summarizePair(mergedCrust, pdlNorm!),
        crustdata_profile: crustProfile,
        crustdata_contact: crustContact,
        pdl: pdlNorm,
      });
    }

    const creditsAfter = CRUSTDATA_API_KEY
      ? await getCrustdataCredits(CRUSTDATA_API_KEY)
      : null;

    return jsonResponse({
      mode,
      deal_id: body.deal_id ?? null,
      include_contact: includeContact,
      contact_attempted: includeContact && contactAllowed,
      credits_before: creditsBefore?.body?.account?.credits ?? null,
      credits_after: creditsAfter?.body?.account?.credits ?? null,
      count: rows.length,
      summaries: rows.map((r) => ({ label: r.label, ...r.summary })),
      rows,
      next: "Paste summaries into docs/ENRICHMENT_CRUSTDATA_VS_PDL.md (mirror CoreSignal report structure).",
    });
  }

  return jsonResponse(
    {
      error: `Unknown mode '${mode}'. Use permissions | probe_contact | compare.`,
    },
    400,
  );
});
