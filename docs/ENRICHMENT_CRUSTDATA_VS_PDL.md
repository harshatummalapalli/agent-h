# Enrichment comparison — Crustdata People Enrich vs PDL

**Status:** Scaffold only — live results pending.  
**Date started:** 2026-07-28  
**Harness:** `supabase/functions/compare-enrichment-vendors`  
**Research:** `docs/ENRICHMENT_RESEARCH_NOTES.md`

## Recommendation

_TBD after live `permissions` → `probe_contact` → `compare` runs._

## Methodology

1. Free Crustdata `GET /account/credits` + `GET /account/endpoints?path=/person/contact/enrich`.
2. One Contact Enrich probe on a known Deal 14 LinkedIn URL (skip if endpoints report `disabled`, unless forced).
3. Compare up to 5 Deal 14 discovery-cache LinkedIn URLs through:
   - Crustdata `POST /person/enrich` (profile + employment + social; business email in-DB only)
   - Crustdata `POST /person/contact/enrich` (only if permitted)
   - PDL `GET /v5/person/enrich`
4. Score completeness: personal email, mobile, employment depth, social profiles; label sourced vs inferred.

## Docs baseline (pre-live)

| Capability | Crustdata | PDL |
|---|---|---|
| Personal email | Contact Enrich only (enterprise; self-serve docs say 403) | `personal_emails` / `emails` (+ `possible_emails` inferred) |
| Mobile | Contact Enrich `phone_numbers` | `mobile_phone` / `phone_numbers` (+ `possible_phones`) |
| Employment history | `experience` on Person Enrich (1 credit base) | `experience[]` |
| Social profiles | `social_handles` / `dev_platform_profiles` | `profiles[]` + platform URL fields |
| Deliverability / provenance | Email `status` (deliverable/catch_all/…) | `num_sources`, `first_seen`, `last_seen` |

## Live results

_Empty — deploy harness and fill from JSON output._

### Permissions probe

```
(pending)
```

### Contact probe

```
(pending)
```

### Per-candidate matrix

| Candidate | CD personal email | CD phone | CD jobs | PDL personal email | PDL phone | PDL jobs | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## Cost

| Step | Est. credits |
|---|---|
| Account credits/endpoints | 0 |
| Contact probe (all tiers) | ≤5 if match |
| Profile enrich × N | ~1 × N (Crustdata) + 1 match credit × N (PDL) |

## How to run (after deploy)

```bash
# 1) Deploy (include shared clients in the bundle)
npx supabase functions deploy compare-enrichment-vendors --project-ref fbkdypullttetardrgdu

# 2) Free permission check
curl -s -X POST "$SUPABASE_URL/functions/v1/compare-enrichment-vendors" \
  -H "Authorization: Bearer $RECRUITER_JWT" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mode":"permissions"}'

# 3) One contact probe (only if permissions say enabled, or force)
curl -s -X POST "$SUPABASE_URL/functions/v1/compare-enrichment-vendors" \
  -H "Authorization: Bearer $RECRUITER_JWT" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mode":"probe_contact","linkedin_url":"https://www.linkedin.com/in/<slug>"}'

# 4) Compare Deal 14
curl -s -X POST "$SUPABASE_URL/functions/v1/compare-enrichment-vendors" \
  -H "Authorization: Bearer $RECRUITER_JWT" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mode":"compare","deal_id":14,"limit":5,"include_contact":true}'
```
