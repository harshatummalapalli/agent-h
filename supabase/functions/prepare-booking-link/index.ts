// Agent H Stage 5: Scheduling -- prepare booking link + email preview only.
//
// Builds the Cal.com URL and optional Resend email preview. Does NOT upsert
// public.interviews or send email -- send-booking-link runs only after
// explicit recruiter approval (Phase C human-in-the-loop contract).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  jsonResponse,
  restFetch,
  serveCandidateFacingFunction,
} from "../_shared/candidateFacingEdge.ts";
import {
  buildBookingEmailPreview,
  buildBookingLinkUrl,
} from "../_shared/bookingLinkEmail.ts";

const CAL_BASE_URL = Deno.env.get("CAL_BASE_URL");
const CAL_EVENT_SLUG = Deno.env.get("CAL_EVENT_SLUG");
const CAL_DEFAULT_USERNAME = Deno.env.get("CAL_DEFAULT_USERNAME");

const LIVE_STATUSES = new Set(["booked", "rescheduled", "completed"]);

const prepareBookingLinkHandler = async (req: Request) => {
  if (req.method !== "POST")
    return jsonResponse({ error: "Method Not Allowed" }, 405);

  if (!CAL_BASE_URL || !CAL_EVENT_SLUG) {
    return jsonResponse(
      {
        error:
          "Scheduling isn't configured yet -- CAL_BASE_URL and CAL_EVENT_SLUG must be set as Edge Function secrets first.",
      },
      500,
    );
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
    return jsonResponse(
      { error: "candidate_id and deal_id are required" },
      400,
    );
  }

  const authHeader = req.headers.get("authorization")!;

  const [candidateRes, dealRes, existingRes] = await Promise.all([
    restFetch(
      `candidates?id=eq.${candidateId}&select=id,first_name,last_name,email_jsonb`,
      authHeader,
    ),
    restFetch(`deals?id=eq.${dealId}&select=id,name,sales_id`, authHeader),
    restFetch(
      `interviews?candidate_id=eq.${candidateId}&deal_id=eq.${dealId}&select=*`,
      authHeader,
    ),
  ]);

  if (!candidateRes.ok)
    return jsonResponse({ error: "Failed to load candidate" }, 502);
  if (!dealRes.ok)
    return jsonResponse({ error: "Failed to load role brief" }, 502);
  if (!existingRes.ok) {
    return jsonResponse(
      { error: "Failed to check existing booking state" },
      502,
    );
  }

  const candidate = (await candidateRes.json())?.[0];
  const deal = (await dealRes.json())?.[0];
  const existing = (await existingRes.json())?.[0];

  if (!candidate) {
    return jsonResponse(
      { error: "Candidate not found (or you don't have access to it)" },
      404,
    );
  }
  if (!deal) {
    return jsonResponse(
      { error: "Role brief not found (or you don't have access to it)" },
      404,
    );
  }

  if (existing && LIVE_STATUSES.has(existing.status)) {
    return jsonResponse({
      already_booked: true,
      prepared: false,
      status: existing.status,
      scheduled_at: existing.scheduled_at,
      scheduled_end_at: existing.scheduled_end_at,
      booking_link_url: existing.booking_link_url,
      email_sent: false,
    });
  }

  let recruiterCalUsername: string | null = null;
  if (deal.sales_id) {
    const salesRes = await restFetch(
      `sales?id=eq.${deal.sales_id}&select=id,cal_username`,
      authHeader,
    );
    if (salesRes.ok) {
      recruiterCalUsername = (await salesRes.json())?.[0]?.cal_username ?? null;
    }
  }
  const calUsername = recruiterCalUsername || CAL_DEFAULT_USERNAME;
  if (!calUsername) {
    return jsonResponse(
      {
        error:
          "No Cal.com username configured -- set CAL_DEFAULT_USERNAME, or set cal_username on the owning recruiter's sales row.",
      },
      500,
    );
  }

  const candidateName =
    [candidate.first_name, candidate.last_name].filter(Boolean).join(" ") ||
    "Candidate";
  const candidateEmail: string | null =
    candidate.email_jsonb?.[0]?.address ?? null;

  const bookingLinkUrl = buildBookingLinkUrl(
    candidateId,
    dealId,
    candidateName,
    candidateEmail,
    {
      calBaseUrl: CAL_BASE_URL,
      calEventSlug: CAL_EVENT_SLUG,
      calUsername,
    },
  );

  const emailPreview =
    candidateEmail != null
      ? buildBookingEmailPreview({
          candidateName,
          candidateEmail,
          dealName: deal.name ?? null,
          bookingLinkUrl,
        })
      : null;

  return jsonResponse({
    already_booked: false,
    prepared: true,
    booking_link_url: bookingLinkUrl,
    candidate_email: candidateEmail,
    email_preview: emailPreview,
    email_sent: false,
  });
};

serveCandidateFacingFunction(prepareBookingLinkHandler);
