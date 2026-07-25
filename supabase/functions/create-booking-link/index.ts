// Agent H Stage 5: Scheduling -- DEPRECATED one-shot entry point.
//
// create-booking-link previously generated the link, upserted interviews, and
// emailed the candidate in one call. That bypassed recruiter approval. Use
// prepare-booking-link (draft preview) then send-booking-link (Resend after
// explicit approve) instead.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  jsonResponse,
  serveCandidateFacingFunction,
} from "../_shared/candidateFacingEdge.ts";

const deprecatedHandler = async (req: Request) => {
  if (req.method !== "POST")
    return jsonResponse({ error: "Method Not Allowed" }, 405);

  return jsonResponse(
    {
      error:
        "create-booking-link is deprecated. Call prepare-booking-link to draft the link and email preview, then send-booking-link after the recruiter approves.",
    },
    410,
  );
};

serveCandidateFacingFunction(deprecatedHandler);
