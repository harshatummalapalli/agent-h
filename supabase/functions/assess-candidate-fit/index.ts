// Agent H Stage 3: Sourcing -- LinkedIn-stage holistic fit assessment.
//
// Built 2026-07-15 as the direct fix for a real gap Harsha identified right
// after the first live scores came back: score-candidate (Kharta's ported
// numeric engine) was calibrated against RESUMES, where an unmentioned
// requirement is real negative signal because the document was tailored for
// this exact application. A LinkedIn profile is the opposite -- generic,
// unmaintained for any specific role, often with zero description per job
// (confirmed directly in testing: one candidate's most recent job had no
// title on file at all, purely a Coresignal data gap, not a real gap). Run
// the same deal-breaker penalty math against that and you systematically
// punish good candidates for under-documentation, not lack of skill -- and
// a 0-100 number invites a false sense of precision, especially for
// recruiters who (Harsha's words) "rely on titles" and don't already know
// how to weigh signals like company type or tenure pattern themselves.
//
// This function does NOT score. It produces a holistic, plain-language
// narrative that explicitly does the translation work a less experienced
// recruiter can't yet do themselves: what a service-vs-product company
// background actually implies, what a tenure pattern might mean (without
// assuming the worst), why a title alone can be misleading, and -- the
// core design principle -- treats anything the profile is simply SILENT on
// as a question worth asking in a screen, not a penalty to apply. Only
// genuine, evidenced gaps go in clear_gaps; everything merely unconfirmed
// goes in worth_verifying instead.
//
// score-candidate/public.candidate_scores are NOT replaced by this --
// Harsha's explicit call was to keep both side by side (this is the right
// tool once a candidate has a real resume; this function is the right tool
// while all that exists is an enriched LinkedIn profile).
//
// Live-test bugfix (2026-07-15): the very first live call came back with
// `matches` as a malformed STRING containing stray pseudo-XML tags
// ("<item>...</item>", even a leaked "</invoke>" fragment) instead of a
// clean JSON array of strings, while the other two array fields
// (worth_verifying/clear_gaps) came back correctly shaped in the SAME
// response -- a one-off model formatting glitch, not a schema-wide
// problem. Fixed two ways: (1) the prompt now explicitly says every list
// field must be a plain JSON array of strings, never XML-tagged text: (2)
// normalizeToStringArray defensively repairs it if it happens again anyway
// (extracts <item> content, or falls back to splitting lines) rather than
// saving/showing broken data.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_SCORING_MODEL") || "claude-haiku-4-5-20251001";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

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
  if (!authHeader) return jsonResponse({ error: "Missing authorization header" }, 401);
  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer" || !token) {
    return jsonResponse({ error: "Invalid authorization header" }, 401);
  }
  try {
    await jose.jwtVerify(token, SUPABASE_JWT_KEYS, { issuer: SUPABASE_JWT_ISSUER });
    return null;
  } catch {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
}

async function restFetch(path: string, authHeader: string, init: RequestInit = {}) {
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

// Defensively repairs an array-of-strings field that may have come back as
// a malformed XML-tagged string instead -- see this file's header comment
// for the exact glitch this was written for. Never throws; worst case
// returns an empty array rather than saving/showing garbage.
function normalizeToStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  }
  if (typeof value === "string") {
    const itemMatches = [...value.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1].trim());
    if (itemMatches.length > 0) return itemMatches.filter(Boolean);
    return value
      .split(/\n+/)
      .map((line) => line.replace(/<\/?[a-z]+>/gi, "").trim())
      .filter(Boolean);
  }
  return [];
}

// --- Role brief mapping: Agent H's deals row -> plain-language context.
// Deliberately simpler than score-candidate's buildRoleBriefLite -- no
// weights, no deal_breakers-as-hard-constraints framing, since none of that
// deterministic math applies here. company_type is included explicitly
// because "product vs service company" is exactly the kind of signal
// Harsha named as one recruiters can't already translate themselves.
function buildRoleContext(deal: Record<string, any>) {
  return {
    title: deal.name ?? "Role",
    must_haves: (deal.must_have_keywords ?? []) as string[],
    required_skills: (deal.required_skills ?? []) as string[],
    nice_to_haves: (deal.nice_to_have_keywords ?? []) as string[],
    seniority: deal.seniority ?? null,
    location: deal.location ?? null,
    industry: deal.industry ?? null,
    employment_type: deal.employment_type ?? null,
    years_experience_min: deal.years_experience_min ?? null,
    years_experience_max: deal.years_experience_max ?? null,
    company_type: deal.company_type ?? null,
    jd_text: typeof deal.jd_text === "string" ? deal.jd_text.slice(0, 4000) : null,
  };
}

// --- Scoring text assembly -- identical approach to score-candidate's
// buildScoringText (same length caps, learned from that function's own
// live-testing truncation bug), duplicated rather than shared because the
// two functions are meant to evolve independently as candidate_scores'
// resume path and this LinkedIn path diverge further over time.
function buildProfileText(candidate: Record<string, any>): { text: string; source: "full_profile" | "plain_fields" } {
  const raw = candidate.full_profile_raw as Record<string, any> | null;
  const workHistory = candidate.work_history as Array<Record<string, any>> | null;

  if (candidate.full_profile_status === "enriched" && (raw || workHistory)) {
    const lines: string[] = [];
    const name = [candidate.first_name, candidate.last_name].filter(Boolean).join(" ");
    if (name) lines.push(name);
    if (raw?.headline) lines.push(String(raw.headline));
    if (raw?.summary) lines.push(String(raw.summary).slice(0, 400));

    if (Array.isArray(workHistory) && workHistory.length > 0) {
      lines.push("\nEXPERIENCE:");
      for (const job of workHistory.slice(0, 8)) {
        const range = [job.date_from, job.date_to].filter(Boolean).join(" - ");
        lines.push(`- ${job.title ?? "(title not on file)"} at ${job.company ?? "?"} ${range ? `(${range})` : ""}`);
        if (job.description) lines.push(`  ${String(job.description).slice(0, 350)}`);
      }
    }

    const education = Array.isArray(raw?.education) ? raw!.education : [];
    if (education.length > 0) {
      lines.push("\nEDUCATION:");
      for (const edu of education.slice(0, 5)) {
        lines.push(`- ${edu.institution_name ?? "?"}${edu.degree ? ` -- ${edu.degree}` : ""}`);
      }
    }

    const skills = Array.isArray(raw?.inferred_skills) ? raw!.inferred_skills : [];
    if (skills.length > 0) lines.push(`\nSKILLS: ${skills.slice(0, 40).join(", ")}`);

    const certs = Array.isArray(raw?.certifications) ? raw!.certifications : [];
    if (certs.length > 0) {
      lines.push(`\nCERTIFICATIONS: ${certs.slice(0, 8).map((c: any) => c.title).filter(Boolean).join(", ")}`);
    }

    return { text: lines.join("\n"), source: "full_profile" };
  }

  const name = [candidate.first_name, candidate.last_name].filter(Boolean).join(" ");
  const parts = [name, candidate.current_title].filter(Boolean);
  return { text: parts.join(" -- "), source: "plain_fields" };
}

const FIT_ASSESSMENT_TOOL = {
  name: "submit_fit_assessment",
  description: "Give a holistic, plain-language read on how well this LinkedIn profile fits a role -- NOT a numeric score. Translate ambiguous signals for a recruiter who may not already know how to weigh them. Every array field must be a plain JSON array of short strings -- never a single string, never XML/HTML tags.",
  input_schema: {
    type: "object",
    properties: {
      fit_bucket: {
        type: "string",
        enum: ["worth_reaching_out", "possible_check", "not_a_fit"],
        description: "A coarse, honest triage bucket. Use worth_reaching_out only when the fit is genuinely clear and strong; possible_check for anything with real ambiguity or partial fit; not_a_fit only when there's clear, evidenced misalignment (not just missing detail).",
      },
      summary: {
        type: "string",
        maxLength: 600,
        description: "2-4 sentences, plain English, bottom-line read on fit. This is the main output -- do the translation work: explain what a company-type, tenure pattern, or title actually implies for this comparison, don't just restate the profile.",
      },
      matches: {
        type: "array",
        items: { type: "string", maxLength: 150 },
        description: "A JSON array of up to 5 short plain strings -- concrete, evidenced strengths tied to the role's real requirements. Example shape: [\"7 years hands-on AWS across 3 roles\", \"Direct Terraform + Kubernetes ownership\"]. Do NOT return a single string or use XML tags.",
      },
      worth_verifying: {
        type: "array",
        items: { type: "string", maxLength: 180 },
        description: "A JSON array of up to 5 short plain strings. Anything plausible-but-unconfirmed by the profile goes HERE, phrased as a question to ask in a screen -- e.g. 'Doesn't explicitly mention Terraform, but their tooling and seniority make it plausible -- worth a direct question.' This is the default bucket for silence; do not treat an unmentioned skill as absent. Do NOT return a single string or use XML tags.",
      },
      clear_gaps: {
        type: "array",
        items: { type: "string", maxLength: 180 },
        description: "A JSON array of up to 3 short plain strings, and often empty. Reserve for requirements with ACTUAL negative evidence (e.g. their whole career is in a clearly unrelated domain, or they explicitly describe using a conflicting approach) -- not merely unmentioned skills, which belong in worth_verifying instead. Do NOT return a single string or use XML tags.",
      },
    },
    required: ["fit_bucket", "summary", "matches", "worth_verifying", "clear_gaps"],
  },
};

function buildPrompt(role: ReturnType<typeof buildRoleContext>, profileText: string, textSource: string): string {
  return `You are helping a recruiter judge whether a candidate is worth pursuing for a role, based ONLY on their LinkedIn-style profile (not a resume -- this profile was never tailored for this role, so treat silence on a topic as "unknown," not "absent").

Your job is NOT to produce a score. It's to translate signals a less experienced recruiter might not know how to read on their own:
- Company type: if this role prefers a certain company type (see below) and the candidate's history differs, explain concretely what that difference likely means day-to-day (e.g. service-company roles often mean delivering to someone else's spec rather than owning architecture decisions) -- don't just flag it as a mismatch.
- Tenure pattern: multiple short stints could mean many things (layoffs, contract roles, genuine hopping, fast promotions) -- do not assume the worst without other evidence.
- Titles can be inflated or deflated by company -- infer seniority from described scope/responsibility where possible, not the title alone.
- Anything the profile is simply silent on is NOT evidence of absence -- put it in worth_verifying as a question to ask, never in clear_gaps.

IMPORTANT formatting rule: matches, worth_verifying, and clear_gaps must EACH be a plain JSON array of short strings (e.g. ["item one", "item two"]). Never combine them into one string, and never use XML or HTML-style tags anywhere in your output.

ROLE: ${role.title}
${role.seniority ? `Seniority: ${role.seniority}` : ""}
${role.location ? `Location: ${role.location}` : ""}
${role.industry ? `Industry: ${role.industry}` : ""}
${role.company_type ? `Preferred employer type: ${role.company_type}` : ""}
${role.years_experience_min || role.years_experience_max ? `Experience wanted: ${role.years_experience_min ?? "?"}-${role.years_experience_max ?? "?"} years` : ""}
Must-haves: ${role.must_haves.length ? role.must_haves.join(", ") : "(none specified)"}
Required skills: ${role.required_skills.join(", ") || "(none specified)"}
Nice-to-haves: ${role.nice_to_haves.join(", ") || "(none specified)"}
${role.jd_text ? `\nFull job description:\n${role.jd_text}` : ""}

CANDIDATE PROFILE (source: ${textSource === "full_profile" ? "enriched LinkedIn-style profile" : "limited discovery fields only -- very little to go on, say so plainly in the summary"}):
${profileText || "(no profile text available)"}

Give your holistic read: a bottom-line summary that does real translation work, concrete matches, things worth verifying in a screen (the default for anything unconfirmed), and only genuinely evidenced gaps (often none). Keep every field concise -- this is a quick recruiter-facing read, not a report.`;
}

const assessFitHandler = async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);

  if (!ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "ANTHROPIC_API_KEY is not set for this project." }, 500);
  }

  let candidateId: number | undefined;
  let dealId: number | undefined;
  try {
    const body = await req.json();
    candidateId = body?.candidate_id;
    dealId = body?.deal_id;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!candidateId || !dealId) {
    return jsonResponse({ error: "candidate_id and deal_id are required" }, 400);
  }

  const authHeader = req.headers.get("authorization")!;

  const [candidateRes, dealRes] = await Promise.all([
    restFetch(
      `candidates?id=eq.${candidateId}&select=id,first_name,last_name,current_title,linkedin_url,full_profile_status,full_profile_raw,work_history`,
      authHeader,
    ),
    restFetch(`deals?id=eq.${dealId}&select=*`, authHeader),
  ]);

  if (!candidateRes.ok) return jsonResponse({ error: "Failed to load candidate" }, 502);
  if (!dealRes.ok) return jsonResponse({ error: "Failed to load role brief" }, 502);

  const candidate = (await candidateRes.json())?.[0];
  const deal = (await dealRes.json())?.[0];

  if (!candidate) return jsonResponse({ error: "Candidate not found (or you don't have access to it)" }, 404);
  if (!deal) return jsonResponse({ error: "Role brief not found (or you don't have access to it)" }, 404);

  const { text: profileText, source: textSource } = buildProfileText(candidate);
  if (!profileText.trim()) {
    return jsonResponse(
      { error: "This candidate has no profile text to assess yet -- try 'View full profile' first, or check current_title is set." },
      400,
    );
  }

  const role = buildRoleContext(deal);
  const prompt = buildPrompt(role, profileText, textSource);

  const anthropicResponse = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      tools: [FIT_ASSESSMENT_TOOL],
      tool_choice: { type: "tool", name: "submit_fit_assessment" },
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!anthropicResponse.ok) {
    const errorBody = await anthropicResponse.text();
    console.error("assess-candidate-fit: Anthropic API error", anthropicResponse.status, errorBody);
    return jsonResponse({ error: `Assessment model error (${anthropicResponse.status})` }, 502);
  }

  const anthropicResult = await anthropicResponse.json();
  const toolUseBlock = anthropicResult?.content?.find((b: any) => b.type === "tool_use");
  if (!toolUseBlock) {
    console.error("assess-candidate-fit: no tool_use block", anthropicResult);
    return jsonResponse({ error: "Assessment model did not return structured output" }, 502);
  }

  const rawOutput = toolUseBlock.input as {
    fit_bucket: "worth_reaching_out" | "possible_check" | "not_a_fit";
    summary: string;
    matches: unknown;
    worth_verifying: unknown;
    clear_gaps: unknown;
  };

  if (anthropicResult?.stop_reason === "max_tokens" || !rawOutput?.summary || !rawOutput?.fit_bucket) {
    console.error("assess-candidate-fit: incomplete model output", {
      candidateId,
      dealId,
      stop_reason: anthropicResult?.stop_reason,
      keys: Object.keys(rawOutput ?? {}),
    });
    return jsonResponse(
      { error: "The assessment model's response was incomplete for this candidate. Try again." },
      502,
    );
  }

  const modelOutput = {
    fit_bucket: rawOutput.fit_bucket,
    summary: rawOutput.summary,
    matches: normalizeToStringArray(rawOutput.matches),
    worth_verifying: normalizeToStringArray(rawOutput.worth_verifying),
    clear_gaps: normalizeToStringArray(rawOutput.clear_gaps),
  };

  const row = {
    candidate_id: candidateId,
    deal_id: dealId,
    fit_bucket: modelOutput.fit_bucket,
    summary: modelOutput.summary,
    matches: modelOutput.matches,
    worth_verifying: modelOutput.worth_verifying,
    clear_gaps: modelOutput.clear_gaps,
    model: ANTHROPIC_MODEL,
    scored_text_source: textSource,
    raw_model_response: rawOutput,
  };

  const upsertRes = await restFetch(`candidate_fit_assessments?on_conflict=candidate_id,deal_id`, authHeader, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });

  if (!upsertRes.ok) {
    const errorBody = await upsertRes.text();
    console.error("assess-candidate-fit: upsert failed", upsertRes.status, errorBody);
    return jsonResponse({ error: "Assessed, but failed to save the result" }, 502);
  }

  const saved = (await upsertRes.json())?.[0];

  return jsonResponse({
    fit_bucket: modelOutput.fit_bucket,
    summary: modelOutput.summary,
    matches: modelOutput.matches,
    worth_verifying: modelOutput.worth_verifying,
    clear_gaps: modelOutput.clear_gaps,
    scored_text_source: textSource,
    saved_assessment_id: saved?.id ?? null,
  });
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const authError = await requireAuth(req);
  if (authError) return authError;
  return assessFitHandler(req);
});
