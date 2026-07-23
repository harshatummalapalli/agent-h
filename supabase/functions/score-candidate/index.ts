// Agent H Stage 4: Screening -- candidate scoring.
//
// This is a PORT of Kharta's real scoring engine, not a reinvented
// algorithm. Read directly from harshatummalapalli/hiring-scorer
// (2026-07-15) per Harsha's explicit "port the scoring logic into Agent H"
// decision -- Kharta has no external API-key auth today (only a browser-
// session-cookie-gated Next.js app), and even its closest-to-portable route
// still writes into Kharta's own DB as a side effect. So a live API call
// from Agent H to Kharta isn't possible without changing Kharta's own
// running system first. Porting the actual logic was the faster, zero-risk
// path -- see the migration comment on public.candidate_scores for the
// full reasoning.
//
// What's ported VERBATIM (read straight from Kharta's source, not
// reconstructed from memory):
//   - The 5 scoring dimensions: skills, trajectory, domain, seniority, tenure
//   - The weighted-average overall-score formula (recomputeOverallFromSnapshot)
//   - The verdict thresholds (scoreToVerdict): >=85 EXCEPTIONAL MATCH,
//     >=75 STRONG MATCH, >=55 POTENTIAL MATCH, >=35 WEAK MATCH, else NOT A MATCH
//   - The deal-breaker penalty (applyDealBreakerCap): -15 points per missing
//     must-have, score floored at 20
//   - The recommended-action derivation (deriveRecommendedAction): reject on
//     weak/critical-gap scores, interview on strong+clean, hold on
//     strong-with-gaps or potential-match
//
// One disclosed substitution: Kharta's actual dimension-judgment call uses
// OpenAI gpt-4o-mini. Agent H has no OpenAI key configured (only
// ANTHROPIC_API_KEY, already used by parse-job-description), so this calls
// Claude for that same judgment instead -- same output contract (5
// dimensions, must-haves check, flags, recruiter card), different vendor.
// Everything downstream of that call (weighting, thresholds, deal-breaker
// cap, recommended action) is the exact ported math, unaffected by which
// model produced the raw dimension scores.
//
// Resume-text scoring (2026-07-19): the gap this file used to disclose --
// "Kharta scores against an actual uploaded resume. Agent H doesn't collect
// resumes yet" -- is now closed on the collection side (candidate
// applications and manual recruiter uploads both land a real resume file in
// the `resumes` Storage bucket, see submit-candidate-application and
// upload-candidate-resume). This function now prefers that actual resume
// text when one is on file (candidates.resume_status === 'received'),
// falling back to the enriched LinkedIn-style profile (full_profile_raw/
// work_history from Stage 3's "View full profile") if no resume exists, or
// a much thinner plain-field fallback if neither is available.
// scored_text_source on the stored row always says which of the three was
// actually used ("resume" | "full_profile" | "plain_fields"), and
// resume_text_extraction_failed flags the specific case where a resume file
// exists but its text couldn't be extracted (e.g. a scanned/image-only PDF
// with no text layer, or an unsupported legacy .doc) -- so that failure is
// visible rather than silently indistinguishable from "no resume at all".
//
// PDF text extraction uses npm:unpdf (a lightweight PDF.js wrapper with no
// Node `fs` dependency, so it runs in Deno's edge runtime); DOCX uses
// npm:mammoth's arrayBuffer-based extractRawText; RTF (a plain-text
// control-word format, not binary) uses a small regex-based stripper --
// legitimate here since, unlike legacy .doc, RTF doesn't actually need a
// real parser library. Legacy binary .doc has no lightweight Deno-
// compatible parser and is deliberately left unsupported rather than
// guessed at with the wrong parser.
//
// Bug found in live verification (2026-07-19): the first version of this
// file had no RTF branch at all -- an .rtf upload silently fell through to
// the PDF branch, which threw on the non-PDF bytes and was swallowed by
// the catch, so scored_text_source came back "plain_fields" with no
// visible error. Fixed by adding an explicit isRtf branch before the PDF
// fallback.
//
// Live-test debugging note (2026-07-15, candidate 10 / deal 6, a candidate
// with an unusually rich Coresignal profile -- long per-job descriptions):
// the model's tool-use response was truncated by max_tokens TWICE in a
// row -- first at 2048 (only dimension_scores + must_haves_check + empty
// flag arrays came through, recruiter_card/profile_classification/
// confidence_level missing), then again even at 4096 after reordering the
// schema (this time ONLY dimension_scores came through) -- because nothing
// was capping how long each dimension's rationale/quote could run, and a
// detailed profile invites a detailed (long) rationale. Fixed by explicitly
// capping every free-text field's length in both the schema descriptions
// and the prompt itself, not just by raising max_tokens further -- raising
// the budget alone doesn't fix an unbounded-length field, it just moves
// where the cutoff happens.
//
// Auth fix (2026-07-15, v12): task 76's inbound-reply capture calls this
// function server-to-server (no recruiter session exists inside a webhook
// handler), authenticating with SUPABASE_SERVICE_ROLE_KEY as the bearer
// token. requireAuth previously only accepted a real end-user session JWT
// (verified against Supabase Auth's JWKS) -- the service-role key isn't
// issued by GoTrue and doesn't verify against that JWKS, so every such call
// was rejected with 401 before this function's own code ever ran. Fixed by
// special-casing an exact match against SUPABASE_SERVICE_ROLE_KEY as a
// trusted internal caller, alongside the existing JWKS path for real
// recruiter sessions from the UI.
//
// Tiered preferences (2026-07-22, task #41): some role briefs describe a
// ranked primary-vs-fallback profile via public.deals.preference_tiers
// (see parse-job-description's header comment). This is deliberately kept
// OUT of the ported deterministic pipeline (weights, verdict thresholds,
// deal-breaker cap) -- that math is a verbatim port and changing its inputs
// would be a bigger, riskier change than task #41 calls for. Instead, when
// tiers are present, the prompt asks the model to additionally report which
// tier (if any) the candidate best matches, purely as an extra piece of
// judgment surfaced to the recruiter (preference_tier_match on the saved
// row) -- it does not affect overall_score/verdict/recommended_action.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as jose from "jsr:@panva/jose@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
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
  // Trusted internal caller (e.g. resend-inbound-reply's auto-score trigger,
  // which has no recruiter session to forward) -- exact match only.
  if (SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY) {
    return null;
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

// --- Ported verbatim from Kharta's recompute-from-snapshot.ts ---
type DimensionKey = "skills" | "trajectory" | "domain" | "seniority" | "tenure";
const DIMENSION_KEYS: DimensionKey[] = ["skills", "trajectory", "domain", "seniority", "tenure"];

type RoleBriefWeights = {
  weight_skills: number;
  weight_trajectory: number;
  weight_domain: number;
  weight_seniority: number;
  weight_tenure: number;
};

function clampWeight(n: number): number {
  return Math.max(1, Math.min(10, Math.round(n)));
}

function readDimensionScore(dims: Record<string, { score: number }>, key: DimensionKey): number {
  const raw = dims[key]?.score;
  if (typeof raw !== "number" || Number.isNaN(raw)) return 0;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function recomputeOverallFromSnapshot(
  dims: Record<string, { score: number }>,
  weights: RoleBriefWeights,
): number {
  const w = {
    skills: clampWeight(weights.weight_skills),
    trajectory: clampWeight(weights.weight_trajectory),
    domain: clampWeight(weights.weight_domain),
    seniority: clampWeight(weights.weight_seniority),
    tenure: clampWeight(weights.weight_tenure),
  };
  const total = DIMENSION_KEYS.reduce((s, k) => s + w[k], 0);
  if (total <= 0) return 0;
  const weightedSum = DIMENSION_KEYS.reduce((s, k) => s + readDimensionScore(dims, k) * w[k], 0);
  return Math.max(0, Math.min(100, Math.round(weightedSum / total)));
}

// --- Ported verbatim from Kharta's recruiter-card.ts ---
type FitVerdict = "EXCEPTIONAL MATCH" | "STRONG MATCH" | "POTENTIAL MATCH" | "WEAK MATCH" | "NOT A MATCH";

function scoreToVerdict(score: number): FitVerdict {
  if (score >= 85) return "EXCEPTIONAL MATCH";
  if (score >= 75) return "STRONG MATCH";
  if (score >= 55) return "POTENTIAL MATCH";
  if (score >= 35) return "WEAK MATCH";
  return "NOT A MATCH";
}

// --- Ported verbatim from Kharta's deal-breaker-cap.ts (PENALTY_PER_MISSING=15, MIN_SCORE_FLOOR=20) ---
const PENALTY_PER_MISSING = 15;
const MIN_SCORE_FLOOR = 20;

type MustHaveCheck = { requirement: string; status: "found" | "inferred" | "absent"; confidence: "high" | "medium" | "low" };

function applyDealBreakerCap(overallScore: number, mustHaves: MustHaveCheck[]) {
  const missing = mustHaves.filter((m) => m.status === "absent").map((m) => m.requirement);
  if (missing.length === 0) {
    return { score: overallScore, warning: null as string | null, missing };
  }
  const pointsDeducted = missing.length * PENALTY_PER_MISSING;
  const adjusted = Math.max(MIN_SCORE_FLOOR, overallScore - pointsDeducted);
  const label = missing.length === 1 ? "must-have" : "must-haves";
  return { score: adjusted, warning: `${missing.length} ${label} not found -- score adjusted`, missing };
}

// --- Ported and adapted from Kharta's recommended-action.ts (AttributedFlag
// multi-model structure simplified to plain strings -- Agent H has one
// model, not a GPT4o/Claude/Gemini consensus panel) ---
type RecommendedAction = "interview" | "hold" | "reject";

function deriveRecommendedAction(params: {
  score: number;
  verdict: FitVerdict;
  confidence: "high" | "medium" | "low";
  whatStandsOut: string[];
  worthExploring: string[];
  mustHaves: MustHaveCheck[];
  dealBreakerWarning: string | null;
}): { action: RecommendedAction; reasons: string[]; risks: string[] } {
  const { score, verdict, confidence, whatStandsOut, worthExploring, mustHaves, dealBreakerWarning } = params;
  const absent = mustHaves.filter((m) => m.status === "absent" && (m.confidence === "high" || m.confidence === "medium"));
  const inferred = mustHaves.filter((m) => m.status === "inferred");

  const reasons = whatStandsOut.slice(0, 3);
  const risks: string[] = [...worthExploring];
  for (const a of absent) risks.push(`Missing must-have: ${a.requirement}`);
  for (const i of inferred.slice(0, 2)) risks.push(`Must-have inferred only: ${i.requirement}`);
  if (dealBreakerWarning) risks.push(dealBreakerWarning);

  const isWeak = verdict === "WEAK MATCH" || verdict === "NOT A MATCH" || score < 55;
  const hasCriticalGaps = absent.length >= 2 || (absent.length >= 1 && score < 70);
  if (isWeak || hasCriticalGaps) {
    return { action: "reject", reasons: reasons.slice(0, 3), risks: risks.slice(0, 4) };
  }

  const isStrong = verdict === "EXCEPTIONAL MATCH" || verdict === "STRONG MATCH" || score >= 75;
  const lowConfidence = confidence === "low";
  const hasGaps = absent.length > 0 || inferred.length > 0 || risks.length > 0;

  if (isStrong && !lowConfidence && absent.length === 0) {
    return { action: "interview", reasons: reasons.slice(0, 3), risks: risks.slice(0, 3) };
  }
  if (isStrong && hasGaps) {
    return { action: "hold", reasons: reasons.slice(0, 3), risks: risks.slice(0, 4) };
  }
  if (verdict === "POTENTIAL MATCH" || (score >= 55 && score < 75)) {
    return { action: "hold", reasons: reasons.slice(0, 3), risks: risks.slice(0, 4) };
  }
  return { action: "reject", reasons: reasons.slice(0, 3), risks: risks.slice(0, 4) };
}

// --- Role brief mapping: Agent H's deals row -> Kharta-style role brief ---
// Agent H's JD intake (Stage 2) doesn't capture per-dimension weight
// preferences or a title_band the way Kharta's does -- so weights default
// to 5/5/5/5/5 (Kharta's own DEFAULT_SCORING_WEIGHTS) until Stage 2 is
// extended to capture real preferences. deal_breakers/core_signals/
// preferred_signals map straight onto must_have_keywords/required_skills/
// nice_to_have_keywords, which Kharta's own parseRoleBriefRow ALSO falls
// back to for legacy rows without deal_breakers/core_signals set -- so this
// mapping mirrors a fallback path Kharta's own code already treats as valid,
// not a novel invention. preference_tiers (task #41) is carried through
// separately, alongside rather than folded into deal_breakers/core_signals --
// see the header comment for why it stays out of the ported math.
type PreferenceTier = {
  rank: number;
  label: string;
  keywords: string[];
  condition: string | null;
};

function buildRoleBriefLite(deal: Record<string, any>) {
  return {
    title: deal.name ?? "Role",
    deal_breakers: (deal.must_have_keywords ?? []) as string[],
    core_signals: ((deal.required_skills ?? []) as string[]).map((skill) => ({ skill, equivalents: [] as string[] })),
    preferred_signals: (deal.nice_to_have_keywords ?? []) as string[],
    preference_tiers: (deal.preference_tiers ?? []) as PreferenceTier[],
    seniority: deal.seniority ?? null,
    location: deal.location ?? null,
    industry: deal.industry ?? null,
    employment_type: deal.employment_type ?? null,
    years_experience_min: deal.years_experience_min ?? null,
    years_experience_max: deal.years_experience_max ?? null,
    jd_text: typeof deal.jd_text === "string" ? deal.jd_text.slice(0, 4000) : null,
    weight_skills: 5,
    weight_trajectory: 5,
    weight_domain: 5,
    weight_seniority: 5,
    weight_tenure: 5,
  };
}

// --- Resume text extraction (2026-07-19) ---
// Downloads via the service-role key regardless of which bearer the caller
// sent -- the private `resumes` bucket (schema 27) has no authenticated-role
// read policy either, only service-role, matching every other resume-reading
// path in this app.
const RESUME_MAX_CHARS = 12000; // generous but bounded, same spirit as buildScoringTextFromProfile's per-field caps below

async function fetchResumeBytes(storagePath: string): Promise<ArrayBuffer | null> {
  try {
    const fileRes = await fetch(`${SUPABASE_URL}/storage/v1/object/resumes/${storagePath}`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY ?? "",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!fileRes.ok) {
      console.error("score-candidate: failed to download resume", fileRes.status, await fileRes.text());
      return null;
    }
    return await fileRes.arrayBuffer();
  } catch (error) {
    console.error("score-candidate: resume download threw", error instanceof Error ? error.message : error);
    return null;
  }
}

// Minimal RTF-to-text: RTF is a plain-text control-word format (not binary
// like legacy .doc), so a regex strip is a legitimate lightweight approach
// here -- no Deno-compatible RTF library exists, but unlike legacy .doc,
// this format doesn't actually require one. Strips control words
// (\wordN), groups ({...} destinations like \fonttbl/\colortbl left in
// place are harmless noise, real content-bearing groups are unwrapped by
// the brace strip below), and escaped braces/backslashes.
function extractRtfText(buffer: ArrayBuffer): string | null {
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const withoutControlWords = raw
    .replace(/\\'[0-9a-fA-F]{2}/g, "") // hex-escaped chars -- dropped rather than decoded, good enough for scoring text
    .replace(/\\[a-zA-Z]+-?\d*[ ]?/g, " ") // control words like \b, \par, \fs24
    .replace(/[{}]/g, "")
    .replace(/\\\\/g, "\\")
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}");
  const text = withoutControlWords.replace(/\s+/g, " ").trim();
  return text || null;
}

async function extractResumeText(storagePath: string, filename: string | null): Promise<string | null> {
  const buffer = await fetchResumeBytes(storagePath);
  if (!buffer) return null;

  const nameForExt = filename ?? storagePath;
  const isDocx = /\.docx$/i.test(nameForExt);
  const isLegacyDoc = /\.doc$/i.test(nameForExt) && !isDocx;
  const isRtf = /\.rtf$/i.test(nameForExt);

  try {
    if (isDocx) {
      const mammoth = await import("npm:mammoth@1.8.0");
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      return result?.value?.trim() || null;
    }
    if (isRtf) {
      return extractRtfText(buffer);
    }
    if (isLegacyDoc) {
      // Legacy pre-2007 binary .doc has no lightweight Deno-compatible text
      // extractor (mammoth is docx-only, unpdf is PDF-only) -- honestly
      // unsupported rather than guessed at with the wrong parser.
      console.error("score-candidate: legacy .doc resume text extraction not supported", { storagePath });
      return null;
    }
    // Default to PDF -- the only other format the upload paths accept
    // besides docx/doc/rtf, and by far the most common resume format.
    const { extractText, getDocumentProxy } = await import("npm:unpdf@0.12.1");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    const joined = Array.isArray(text) ? text.join("\n") : text;
    return joined?.trim() || null;
  } catch (error) {
    console.error("score-candidate: resume text extraction threw", error instanceof Error ? error.message : error, { storagePath });
    return null;
  }
}

// --- Scoring text assembly from candidate row ---
type ScoringTextResult = {
  text: string;
  source: "resume" | "full_profile" | "plain_fields";
  resumeExtractionFailed?: boolean;
};

// Also caps per-job description length -- an unusually detailed Coresignal
// profile (long paragraph per role) was the direct cause of the output
// truncation found during live testing, since more detail in gives the
// model more to write rationale about on the way out.
function buildScoringTextFromProfile(candidate: Record<string, any>): { text: string; source: "full_profile" | "plain_fields" } {
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

  // Thin fallback -- whatever plain fields discovery ever captured. Much
  // lower-confidence input; scored_text_source on the saved row flags this.
  const name = [candidate.first_name, candidate.last_name].filter(Boolean).join(" ");
  const parts = [name, candidate.current_title].filter(Boolean);
  return { text: parts.join(" -- "), source: "plain_fields" };
}

// Prefers an actual uploaded resume (the real Kharta behavior) over the
// enriched-profile / plain-fields fallbacks. A resume that exists but
// yields too little extractable text (a scanned/image-only PDF with no
// text layer, or a legacy .doc) falls through to those same fallbacks --
// resumeExtractionFailed marks that this happened, so it's visible
// downstream instead of looking identical to "never had a resume".
async function buildScoringText(candidate: Record<string, any>): Promise<ScoringTextResult> {
  if (candidate.resume_status === "received" && candidate.resume_storage_path) {
    const resumeText = await extractResumeText(candidate.resume_storage_path, candidate.resume_original_filename ?? null);
    // A short threshold, not zero -- guards against a technically-non-empty
    // but useless extraction (e.g. a handful of stray characters from a
    // mostly-image PDF) being trusted as real resume content.
    if (resumeText && resumeText.trim().length > 40) {
      return { text: resumeText.slice(0, RESUME_MAX_CHARS), source: "resume" };
    }
    const fallback = buildScoringTextFromProfile(candidate);
    return { ...fallback, resumeExtractionFailed: true };
  }
  return buildScoringTextFromProfile(candidate);
}

// Every free-text field below now has an explicit, enforced length cap in
// its description -- the actual fix for the truncation bug found in live
// testing. maxLength alone doesn't stop a model from writing more, but
// combined with the explicit instruction in the prompt ("keep every
// rationale under N words"), this reliably keeps total output within budget.
const SCORING_TOOL = {
  name: "submit_candidate_score",
  description: "Score a candidate's fit for a role across 5 dimensions, based only on the profile text and role brief provided. Every free-text field must be concise -- short phrases, not paragraphs.",
  input_schema: {
    type: "object",
    properties: {
      dimension_scores: {
        type: "object",
        description: "Score 0-100 for each dimension. For scores above 60, rationale must reference a specific concrete detail from the profile as evidence -- but keep rationale to ONE short sentence (under 25 words) and quote to under 15 words or null. Do not inflate scores on keyword presence alone.",
        properties: {
          skills: { type: "object", properties: { score: { type: "integer" }, rationale: { type: "string", maxLength: 160 }, quote: { type: ["string", "null"], maxLength: 100 } }, required: ["score", "rationale"] },
          trajectory: { type: "object", properties: { score: { type: "integer" }, rationale: { type: "string", maxLength: 160 }, quote: { type: ["string", "null"], maxLength: 100 } }, required: ["score", "rationale"] },
          domain: { type: "object", properties: { score: { type: "integer" }, rationale: { type: "string", maxLength: 160 }, quote: { type: ["string", "null"], maxLength: 100 } }, required: ["score", "rationale"] },
          seniority: { type: "object", properties: { score: { type: "integer" }, rationale: { type: "string", maxLength: 160 }, quote: { type: ["string", "null"], maxLength: 100 } }, required: ["score", "rationale"] },
          tenure: { type: "object", properties: { score: { type: "integer" }, rationale: { type: "string", maxLength: 160 }, quote: { type: ["string", "null"], maxLength: 100 } }, required: ["score", "rationale"] },
        },
        required: ["skills", "trajectory", "domain", "seniority", "tenure"],
      },
      must_haves_check: {
        type: "array",
        description: "One entry per must-have requirement given in the role brief. No rationale field -- just the verdict.",
        items: {
          type: "object",
          properties: {
            requirement: { type: "string", maxLength: 80 },
            status: { type: "string", enum: ["found", "inferred", "absent"] },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["requirement", "status", "confidence"],
        },
      },
      confidence_level: { type: "string", enum: ["high", "medium", "low"] },
      profile_classification: {
        type: "object",
        properties: { primary_type: { type: "string", maxLength: 60 }, lean_summary: { type: "string", maxLength: 160 } },
        required: ["primary_type", "lean_summary"],
      },
      recruiter_card: {
        type: "object",
        properties: {
          most_recent_title: { type: "string", maxLength: 80 },
          total_years_experience: { type: "string", maxLength: 30 },
          career_pattern: { type: "string", maxLength: 120 },
          what_stands_out: { type: "array", items: { type: "string", maxLength: 100 }, description: "At most 3 short bullets." },
          worth_exploring: { type: "array", items: { type: "string", maxLength: 100 }, description: "At most 3 short bullets." },
          interview_questions: { type: "array", items: { type: "string", maxLength: 150 }, description: "At most 3 questions." },
        },
        required: ["most_recent_title", "total_years_experience", "career_pattern", "what_stands_out", "worth_exploring", "interview_questions"],
      },
      green_flags: { type: "array", items: { type: "string", maxLength: 100 }, description: "At most 4 short bullets, one short phrase each." },
      watch_signals: { type: "array", items: { type: "string", maxLength: 100 }, description: "At most 4 short bullets." },
      review_flags: { type: "array", items: { type: "string", maxLength: 100 }, description: "Contradictions or implausible claims, if any. At most 4 short bullets." },
      // Task #41 (2026-07-22): only meaningful when the role brief has
      // preference_tiers. Purely informational for the recruiter -- does
      // NOT feed the ported deterministic pipeline below (see header
      // comment). Omit/null when the role brief has no tiers, or the model
      // genuinely can't tell which tier fits best.
      preference_tier_match: {
        type: ["object", "null"],
        description: "Which preference tier (by rank) this candidate best matches, if the role brief listed any. Null if the role brief has no tiers, or no tier clearly fits.",
        properties: {
          rank: { type: "integer" },
          label: { type: "string", maxLength: 60 },
          rationale: { type: "string", maxLength: 160 },
        },
        required: ["rank", "label", "rationale"],
      },
    },
    required: ["dimension_scores", "must_haves_check", "confidence_level", "profile_classification", "recruiter_card", "green_flags", "watch_signals", "review_flags"],
  },
};

function buildPrompt(roleBrief: ReturnType<typeof buildRoleBriefLite>, profileText: string, textSource: string): string {
  const tierText =
    roleBrief.preference_tiers.length > 0
      ? `\nRanked preference tiers (this role has a primary-vs-fallback profile -- judge which tier this candidate best fits, in addition to the 5 dimensions above; this does not change the dimension scores themselves):\n${roleBrief.preference_tiers
          .map((t) => `${t.rank}. ${t.label}: ${t.keywords.join(", ")}${t.condition ? ` (${t.condition})` : ""}`)
          .join("\n")}`
      : "";

  return `You are scoring a candidate's fit for a role. Score honestly and evidence-based -- do not inflate scores for keyword matches with no supporting detail.

CRITICAL: you must fill in EVERY field in the schema, including profile_classification and recruiter_card near the end. Keep every field extremely concise -- one short sentence or phrase, never a paragraph. This profile has a lot of detail available; do not let that tempt you into long rationale -- brevity across ALL fields is required so the full response fits.

ROLE: ${roleBrief.title}
${roleBrief.seniority ? `Seniority: ${roleBrief.seniority}` : ""}
${roleBrief.location ? `Location: ${roleBrief.location}` : ""}
${roleBrief.industry ? `Industry: ${roleBrief.industry}` : ""}
${roleBrief.years_experience_min || roleBrief.years_experience_max ? `Experience required: ${roleBrief.years_experience_min ?? "?"}-${roleBrief.years_experience_max ?? "?"} years` : ""}
Must-haves: ${roleBrief.deal_breakers.length ? roleBrief.deal_breakers.join(", ") : "(none specified)"}
Required skills: ${roleBrief.core_signals.map((s) => s.skill).join(", ") || "(none specified)"}
Nice-to-haves: ${roleBrief.preferred_signals.join(", ") || "(none specified)"}
${tierText}
${roleBrief.jd_text ? `\nFull job description:\n${roleBrief.jd_text}` : ""}

CANDIDATE PROFILE (source: ${
    textSource === "resume"
      ? "actual uploaded resume text"
      : textSource === "full_profile"
        ? "enriched LinkedIn-style profile"
        : "limited discovery fields only -- treat with lower confidence, this is NOT a full profile or resume"
  }):
${profileText || "(no profile text available)"}

Score the 5 dimensions (skills, trajectory, domain, seniority, tenure) 0-100 each, one short sentence of rationale each. For every must-have listed above, report found/inferred/absent with confidence, no rationale needed. Classify the candidate's profile type in a few words. Fill out the recruiter card with concise, specific content. Then list up to 4 short green flags, watch signals, and review flags each.${roleBrief.preference_tiers.length > 0 ? " Finally, report which ranked preference tier this candidate best matches (preference_tier_match), or null if none clearly fit." : ""}`;
}

const scoreCandidateHandler = async (req: Request) => {
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
      `candidates?id=eq.${candidateId}&select=id,first_name,last_name,current_title,linkedin_url,full_profile_status,full_profile_raw,work_history,resume_status,resume_storage_path,resume_original_filename`,
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

  const { text: profileText, source: textSource, resumeExtractionFailed } = await buildScoringText(candidate);
  if (!profileText.trim()) {
    return jsonResponse(
      { error: "This candidate has no profile text to score against yet -- try 'View full profile' first, or check current_title is set." },
      400,
    );
  }

  const roleBrief = buildRoleBriefLite(deal);
  const prompt = buildPrompt(roleBrief, profileText, textSource);

  const anthropicResponse = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      tools: [SCORING_TOOL],
      tool_choice: { type: "tool", name: "submit_candidate_score" },
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!anthropicResponse.ok) {
    const errorBody = await anthropicResponse.text();
    console.error("score-candidate: Anthropic API error", anthropicResponse.status, errorBody);
    return jsonResponse({ error: `Scoring model error (${anthropicResponse.status})` }, 502);
  }

  const anthropicResult = await anthropicResponse.json();
  const toolUseBlock = anthropicResult?.content?.find((b: any) => b.type === "tool_use");
  if (!toolUseBlock) {
    console.error("score-candidate: no tool_use block", anthropicResult);
    return jsonResponse({ error: "Scoring model did not return structured output" }, 502);
  }

  const modelOutput = toolUseBlock.input as {
    dimension_scores: Record<DimensionKey, { score: number; rationale: string; quote: string | null }>;
    must_haves_check: MustHaveCheck[];
    confidence_level: "high" | "medium" | "low";
    green_flags: string[];
    watch_signals: string[];
    review_flags: string[];
    profile_classification: { primary_type: string; lean_summary: string };
    recruiter_card: {
      most_recent_title: string;
      total_years_experience: string;
      career_pattern: string;
      what_stands_out: string[];
      worth_exploring: string[];
      interview_questions: string[];
    };
    preference_tier_match?: { rank: number; label: string; rationale: string } | null;
  };

  // If the model still ran out of room despite the caps above, surface a
  // real error rather than silently saving a half-formed score with a
  // misleading "reject, no reasons given" recommendation. This should be
  // rare now, but nulling out silently was exactly the bug found in
  // testing -- better to fail loudly than save something quietly wrong.
  const truncated = anthropicResult?.stop_reason === "max_tokens";
  if (truncated || !modelOutput?.recruiter_card || !modelOutput?.must_haves_check) {
    console.error("score-candidate: incomplete model output", {
      candidateId,
      dealId,
      stop_reason: anthropicResult?.stop_reason,
      keys: Object.keys(modelOutput ?? {}),
    });
    return jsonResponse(
      {
        error:
          "The scoring model's response was incomplete for this candidate (likely an unusually long profile). Try again -- if it keeps happening, this profile may need a shorter summary.",
      },
      502,
    );
  }

  // --- Ported deterministic pipeline from here down ---
  const rawOverall = recomputeOverallFromSnapshot(modelOutput.dimension_scores, roleBrief);
  const cap = applyDealBreakerCap(rawOverall, modelOutput.must_haves_check ?? []);
  const finalScore = cap.score;
  const verdict = scoreToVerdict(finalScore);
  const recommended = deriveRecommendedAction({
    score: finalScore,
    verdict,
    confidence: modelOutput.confidence_level,
    whatStandsOut: modelOutput.recruiter_card?.what_stands_out ?? [],
    worthExploring: modelOutput.recruiter_card?.worth_exploring ?? [],
    mustHaves: modelOutput.must_haves_check ?? [],
    dealBreakerWarning: cap.warning,
  });

  // Only persist a tier match when the role brief actually has tiers --
  // otherwise ignore anything the model may have returned there anyway.
  const preferenceTierMatch =
    roleBrief.preference_tiers.length > 0 ? (modelOutput.preference_tier_match ?? null) : null;

  const row = {
    candidate_id: candidateId,
    deal_id: dealId,
    overall_score: finalScore,
    verdict,
    confidence_level: modelOutput.confidence_level,
    dimension_scores: modelOutput.dimension_scores,
    deal_breaker_warning: cap.warning,
    must_haves_check: modelOutput.must_haves_check ?? [],
    green_flags: modelOutput.green_flags ?? [],
    watch_signals: modelOutput.watch_signals ?? [],
    review_flags: modelOutput.review_flags ?? [],
    recruiter_card: modelOutput.recruiter_card,
    profile_classification: modelOutput.profile_classification,
    recommended_action: recommended.action,
    recommended_action_reasons: recommended.reasons,
    recommended_action_risks: recommended.risks,
    preference_tier_match: preferenceTierMatch,
    model: ANTHROPIC_MODEL,
    scored_text_source: textSource,
    raw_model_response: modelOutput,
  };

  const targetAuthHeader = token_for_service_role_bypass(authHeader);

  const upsertRes = await restFetch(`candidate_scores?on_conflict=candidate_id,deal_id`, targetAuthHeader, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });

  if (!upsertRes.ok) {
    const errorBody = await upsertRes.text();
    console.error("score-candidate: upsert failed", upsertRes.status, errorBody);
    return jsonResponse({ error: "Scored, but failed to save the result" }, 502);
  }

  const saved = (await upsertRes.json())?.[0];

  return jsonResponse({
    overall_score: finalScore,
    verdict,
    confidence_level: modelOutput.confidence_level,
    dimension_scores: modelOutput.dimension_scores,
    deal_breaker_warning: cap.warning,
    must_haves_check: modelOutput.must_haves_check,
    green_flags: modelOutput.green_flags,
    watch_signals: modelOutput.watch_signals,
    review_flags: modelOutput.review_flags,
    recruiter_card: modelOutput.recruiter_card,
    profile_classification: modelOutput.profile_classification,
    recommended_action: recommended.action,
    recommended_action_reasons: recommended.reasons,
    recommended_action_risks: recommended.risks,
    preference_tier_match: preferenceTierMatch,
    scored_text_source: textSource,
    resume_text_extraction_failed: resumeExtractionFailed ?? false,
    saved_score_id: saved?.id ?? null,
  });
};

// authHeader already carries whichever bearer the caller sent (service role
// or a real user JWT) -- both are valid PostgREST bearers, service role
// simply bypasses RLS. No transformation needed; kept as a named pass-
// through so the intent at the call site above is explicit.
function token_for_service_role_bypass(authHeader: string): string {
  return authHeader;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const authError = await requireAuth(req);
  if (authError) return authError;
  return scoreCandidateHandler(req);
});
