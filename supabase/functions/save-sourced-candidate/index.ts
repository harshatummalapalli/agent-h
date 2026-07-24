// Agent H Stage 3, checkpoint 3b: turn a discovery-vendor search hit into a
// real, saved candidate record -- and make sure the same person is never
// saved twice.
//
// Vendor-neutral update (2026-07-11 session): originally written when PDL
// was the only discovery vendor, so the dedup column was named pdl_id and
// both candidates.source / deal_candidates.sourced_via were hardcoded to
// "pdl_search". Coresignal is now the sole active discovery provider (see
// source-candidates-discovery/index.ts's DISCOVERY_PROVIDERS), so those
// hardcoded PDL-specific values were actively wrong -- every saved
// candidate was being mislabeled regardless of which vendor actually found
// them. Fixed here: the dedup column is renamed to source_id (migration
// agent_h_stage3_contact_and_devsignal_enrichment).
//
// Server-side attribution (2026-07-24): _source_vendor is stripped from
// discovery API responses before they reach the browser, so source and
// sourced_via are resolved here from discovery_source_attribution (written
// by source-candidates-discovery per search batch), not from client fields.
//
// Scope: this function only runs when a recruiter explicitly clicks "Add to
// pipeline" on a specific PDL result in the Source Candidates screen (see
// SourceCandidatesPage.tsx). It deliberately does NOT run automatically for
// every result checkpoint 3a returns -- Harsha's call: an unreviewed PDL hit
// is not the same thing as a candidate someone decided is worth tracking,
// and auto-saving all 315 hits from a single search would flood
// public.candidates with records no recruiter has looked at.
//
// What "add to pipeline" actually does, step by step:
//   1. Confirms the role brief (deals row) is one this recruiter's tenant
//      can see (same RLS-riding pattern as source-candidates-discovery).
//   2. Checks whether this exact person is already saved -- by the
//      discovery vendor's own person id first (most reliable), then by
//      LinkedIn URL as a fallback -- so searching the same role twice, or
//      two different roles surfacing the same person, never creates a
//      duplicate candidate row.
//   3. If they're new: inserts one public.candidates row, normalized fields
//      (name/title/linkedin/email) extracted for display and dedup, full
//      raw vendor payload kept in source_raw so nothing (skills, location,
//      etc.) is lost even though candidates has no dedicated columns for
//      them yet.
//   4. Either way (new or already-known), links the candidate to this role
//      brief via public.deal_candidates, so "who did we source for this
//      role" is answerable later -- using Postgres's own unique constraint
//      (deal_id, candidate_id) + PostgREST's ignore-duplicates behavior so
//      re-adding someone already linked is a harmless no-op, not an error.
//
// Deliberately NOT in scope here (later checkpoints):
//   - no fuzzy name/company matching -- PDL id + LinkedIn URL are both
//     effectively unique identifiers already, which covers the realistic
//     case for a PDL-only pipeline. Fuzzy matching matters once resumes /
//     manual entries (no pdl_id) flow through the same table.
//   - no GitHub enrichment here (see enrich-candidate-devsignals, 3d).
//
// Candidate-visibility follow-up (2026-07-11): the deal_candidates row now
// also carries match_score -- the Voyage score computed at search time (3c)
// was previously discarded the moment a recruiter left the search screen,
// which meant a saved candidate had no way to be shown in rank order once
// they were actually in the pipeline. Persisted here, read by the
// Candidates admin views and the role-brief's Candidates tab.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";
import {
  buildDiscoveryAttributionLookupPath,
  parseAttributionVendorFromRows,
  resolveSourcedViaFromAttributionVendor,
} from "../source-candidates-discovery/discoverySourceAttribution.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST",
};

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
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

type PdlCandidate = {
  id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  job_company_name?: string;
  location_name?: string;
  linkedin_url?: string;
  emails?: unknown;
  phone_numbers?: unknown;
  skills?: unknown;
  // The Voyage cosine-similarity score computed at search time (see
  // SourceCandidatesPage.tsx's sortByMatchScore) -- 0..1, or absent when
  // scoring wasn't available for this result. Previously thrown away the
  // moment a recruiter left the search screen; now persisted onto
  // deal_candidates.match_score so a saved candidate stays sorted by rank
  // instead of just save order.
  _match_score?: number | null;
  [key: string]: unknown;
};

// Reads _match_score defensively -- it arrives as `unknown` off the wire, and
// a malformed/out-of-range value should be dropped (null), not stored as
// junk that would silently corrupt future rank-sorted views.
function matchScore(candidate: PdlCandidate): number | null {
  const raw = candidate._match_score;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

// Looks up the vendor that returned this source_id for the role brief's
// current search window. Non-fatal on failure -- falls back to "manual".
async function resolveSourcedVia(
  dealId: number,
  candidate: PdlCandidate,
  authHeader: string,
): Promise<string> {
  if (!candidate.id) return "manual";

  try {
    const nowIso = new Date().toISOString();
    const response = await restFetch(
      buildDiscoveryAttributionLookupPath(dealId, candidate.id, nowIso),
      authHeader,
    );
    if (!response.ok) return "manual";
    const rows = await response.json();
    return resolveSourcedViaFromAttributionVendor(
      parseAttributionVendorFromRows(rows),
    );
  } catch {
    return "manual";
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

// Confirms the role brief exists and this recruiter's tenant can see it --
// rides on the same RLS policy every other read in this app uses, rather
// than trusting the deal_id the client sent.
async function fetchRoleBrief(
  dealId: number,
  authHeader: string,
): Promise<{ id: number } | null> {
  const response = await restFetch(
    `deals?id=eq.${dealId}&select=id`,
    authHeader,
  );
  if (!response.ok) return null;
  const rows = await response.json();
  return rows?.[0] ?? null;
}

// Looks for an existing candidate matching this discovery-vendor person,
// tenant-scoped automatically by RLS (the request rides the caller's own
// JWT). Tries the vendor's own person id first (most reliable -- it's that
// vendor's permanent identifier for this exact profile), then falls back to
// LinkedIn URL, since a person could in principle have been saved before
// through a path that captured the LinkedIn URL but not (yet) a source_id.
async function findExistingCandidate(
  candidate: PdlCandidate,
  authHeader: string,
): Promise<number | null> {
  if (candidate.id) {
    const response = await restFetch(
      `candidates?source_id=eq.${encodeURIComponent(candidate.id)}&select=id`,
      authHeader,
    );
    if (response.ok) {
      const rows = await response.json();
      if (rows?.[0]?.id) return rows[0].id;
    }
  }

  if (candidate.linkedin_url) {
    const response = await restFetch(
      `candidates?linkedin_url=eq.${encodeURIComponent(candidate.linkedin_url)}&select=id`,
      authHeader,
    );
    if (response.ok) {
      const rows = await response.json();
      if (rows?.[0]?.id) return rows[0].id;
    }
  }

  return null;
}

// Best-effort company match-or-create so current_company_id isn't left null
// whenever we can reasonably fill it in. Deliberately simple (case-
// insensitive exact name match within the tenant) -- company name dedup has
// the same fuzzy-matching problem candidate dedup does, and solving that
// properly isn't this checkpoint's job. Non-fatal on any failure: a missing
// company link is a lesser problem than failing the whole save.
async function findOrCreateCompany(
  companyName: string | undefined,
  authHeader: string,
): Promise<number | null> {
  if (!companyName) return null;
  try {
    const existing = await restFetch(
      `companies?name=ilike.${encodeURIComponent(companyName)}&select=id`,
      authHeader,
    );
    if (existing.ok) {
      const rows = await existing.json();
      if (rows?.[0]?.id) return rows[0].id;
    }

    const created = await restFetch(`companies`, authHeader, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        name: companyName,
        relationship_type: "past_employer",
      }),
    });
    if (created.ok) {
      const rows = await created.json();
      return rows?.[0]?.id ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

function splitName(candidate: PdlCandidate): {
  first: string | null;
  last: string | null;
} {
  if (candidate.first_name || candidate.last_name) {
    return {
      first: candidate.first_name ?? null,
      last: candidate.last_name ?? null,
    };
  }
  if (!candidate.full_name) return { first: null, last: null };
  const parts = candidate.full_name.trim().split(/\s+/);
  return {
    first: parts[0] ?? null,
    last: parts.length > 1 ? parts.slice(1).join(" ") : null,
  };
}

const saveSourcedCandidate = async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  let roleBriefId: number | undefined;
  let candidate: PdlCandidate | undefined;
  try {
    const body = await req.json();
    roleBriefId = body?.role_brief_id;
    candidate = body?.candidate;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!roleBriefId || typeof roleBriefId !== "number") {
    return jsonResponse({ error: "role_brief_id is required" }, 400);
  }
  if (!candidate || typeof candidate !== "object") {
    return jsonResponse({ error: "candidate is required" }, 400);
  }

  const authHeader = req.headers.get("authorization")!;

  const roleBrief = await fetchRoleBrief(roleBriefId, authHeader);
  if (!roleBrief) {
    return jsonResponse(
      { error: "Role brief not found (or you don't have access to it)" },
      404,
    );
  }

  try {
    const sourcedVia = await resolveSourcedVia(
      roleBriefId,
      candidate,
      authHeader,
    );
    let candidateId = await findExistingCandidate(candidate, authHeader);
    let created = false;

    if (!candidateId) {
      const { first, last } = splitName(candidate);
      const companyId = await findOrCreateCompany(
        candidate.job_company_name,
        authHeader,
      );

      const insertResponse = await restFetch(`candidates`, authHeader, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          first_name: first,
          last_name: last,
          current_title: candidate.job_title ?? null,
          current_company_id: companyId,
          linkedin_url: candidate.linkedin_url ?? null,
          email_jsonb: candidate.emails ?? null,
          phone_jsonb: candidate.phone_numbers ?? null,
          source_id: candidate.id ?? null,
          source: sourcedVia,
          status: "sourced",
          source_raw: candidate,
        }),
      });

      if (insertResponse.ok) {
        const rows = await insertResponse.json();
        candidateId = rows?.[0]?.id ?? null;
        created = true;
      } else {
        // Bugfix-shaped edge case, handled defensively rather than assumed:
        // if two requests raced (e.g. double-click, or the same person
        // saved from two different role searches at nearly the same time),
        // the unique index on source_id/linkedin_url rejects the second insert
        // with a conflict. Treat that as "already exists" and re-look it up,
        // instead of surfacing a 500 for what is actually a harmless race.
        const errorBody = await insertResponse.text();
        const isConflict =
          insertResponse.status === 409 || errorBody.includes("23505");
        if (!isConflict) {
          console.error(
            "candidate insert failed",
            insertResponse.status,
            errorBody,
          );
          return jsonResponse({ error: "Failed to save candidate" }, 502);
        }
        candidateId = await findExistingCandidate(candidate, authHeader);
        if (!candidateId) {
          return jsonResponse({ error: "Failed to save candidate" }, 502);
        }
      }
    }

    // Link candidate to this role brief. ignore-duplicates makes re-adding
    // someone already linked to the same role a harmless no-op rather than
    // a 409 the caller has to handle specially.
    const linkResponse = await restFetch(`deal_candidates`, authHeader, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify({
        deal_id: roleBriefId,
        candidate_id: candidateId,
        sourced_via: sourcedVia,
        match_score: matchScore(candidate),
      }),
    });

    if (!linkResponse.ok) {
      const errorBody = await linkResponse.text();
      console.error(
        "deal_candidates link failed",
        linkResponse.status,
        errorBody,
      );
      return jsonResponse(
        { error: "Saved candidate but failed to link to role brief" },
        502,
      );
    }

    return jsonResponse({
      status: created ? "created" : "linked_existing",
      candidate_id: candidateId,
    });
  } catch (error) {
    console.error("save-sourced-candidate failed", error);
    return jsonResponse({ error: "Failed to save candidate" }, 500);
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const authError = await requireAuth(req);
  if (authError) return authError;
  return saveSourcedCandidate(req);
});
