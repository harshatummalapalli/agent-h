# Enrichment research notes — Crustdata People Enrich vs PDL

**Date:** 2026-07-28  
**Status:** Docs research complete. Live permission probe + Deal 14 comparison pending (needs Supabase-deployed harness; no vendor keys in Cursor pod).  
**Credit discipline:** free `/account/credits` + `/account/endpoints` first; one Contact Enrich probe before any batch.

## Existing codebase (untouched so far)

| Artifact | Role |
|---|---|
| `enrich-candidate-workhistory` | Waterfall: CoreSignal Collect (**disabled**) → **PDL Person Enrich** `GET /v5/person/enrich?api_key=&profile=` |
| `source-candidates-discovery` comment (~L223) | Prior live finding: `/person/enrich` worked; `/person/contact/enrich` returned **403 `permission_error`** on the trial key then |
| `enrich-candidate-contact` | Hunter → Apollo (also disabled under Phase 1 vendor consolidation) |
| ADR-unipile | Phase 1: Crustdata sole discovery; Coresignal Collect / contact vendors off |

## Crustdata Person API (docs.crustdata.com, `x-api-version: 2025-11-01`)

Confirmed against public docs + `llms.txt` index (2026-07-28). Auth: `Authorization: Bearer <key>`.

### Endpoints relevant to this eval

| Endpoint | Path | Credits (docs) | Plan notes |
|---|---|---|---|
| **Person Enrich** (cached) | `POST /person/enrich` | Base profile **1**; +1 business email path on this endpoint is in-DB only; +1 `dev_platform_profiles`; max ~2–3 depending on field set | Self-serve OK |
| **Contact Enrich** | `POST /person/contact/enrich` | Per type per match: business email **1**, personal emails **2**, phone **2**; omit `fields` → all three (**5**). No-match free | **Enterprise / higher-tier**; docs: *self-serve keys receive a `403`* |
| **Live Enrich** | `POST /person/professional_network/enrich/live` | **7** / profile | Plan-gated |
| Account credits | `GET /account/credits` | **Free** | Use before/after |
| Account permissions | `GET /account/endpoints` | **Free** | Check Contact Enrich status without spending |

### Person Enrich request / response (confirmed)

Request (exactly one identifier type, max 25):

```json
{
  "professional_network_profile_urls": ["https://www.linkedin.com/in/..."],
  "fields": [
    "basic_profile",
    "experience",
    "education",
    "skills",
    "social_handles",
    "professional_network",
    "contact"
  ]
}
```

Default `fields` if omitted: only `basic_profile` + `social_handles`.

Response: top-level array:

```
[{ matched_on, match_type, matches: [{ confidence_score, person_data }] }]
```

`person_data` sections of interest:

| Section | Contents | Sourced vs inferred (docs language) |
|---|---|---|
| `basic_profile` | name, headline, title, summary, location, languages, `last_updated` | Cached dataset profile |
| `experience` | `employment_details.current[]` / `.past[]` with company, title, dates, `crustdata_company_id` | Employment history from dataset |
| `social_handles` | professional_network / twitter / `dev_platform_identifier` URLs | Identifiers when present |
| `contact` **on `/person/enrich`** | **In-DB business emails only** | Docs explicit: personal emails + phones are **empty / unsupported** here — use Contact Enrich |
| `dev_platform_profiles` | GitHub-style context | Extra credit |

Email objects (when returned): `{ email, status }` with `status ∈ {deliverable, catch_all, invalid, unknown}` — deliverability verification, not a separate "inferred" flag.

### Contact Enrich (confirmed)

```
POST https://api.crustdata.com/person/contact/enrich
```

Fields allowed: `contact`, `contact.business_emails`, `contact.personal_emails`, `contact.phone_numbers` (non-contact fields → `400`).

Response contact shape:

```json
{
  "contact": {
    "business_emails": [{ "email": "...", "status": "deliverable" }],
    "personal_emails": [{ "email": "...", "status": "deliverable" }],
    "phone_numbers": ["+1..."],
    "websites": []
  }
}
```

**Prior 403:** codebase comment + **current docs both say self-serve → 403**. Still re-verify live via free `/account/endpoints?path=/person/contact/enrich` before burning Contact Enrich credits.

### Live Enrich (confirmed path only; full schema behind login wall)

```
POST https://api.crustdata.com/person/professional_network/enrich/live
```

7 credits / profile; use only when cached enrich is stale/missing. Out of scope for the first comparison pass unless cached enrich is empty.

## PDL Person Enrichment (docs.peopledatalabs.com)

Already integrated in `enrich-candidate-workhistory`:

```
GET https://api.peopledatalabs.com/v5/person/enrich?api_key=<key>&profile=<linkedin_url>
```

Match → `200` + `{ status, likelihood, data }`; no match → `404` (charged per match only).

### Fields for completeness comparison

| Need | PDL field(s) | Provenance signal |
|---|---|---|
| Personal email | `personal_emails[]`, `recommended_personal_email`, also `emails[]` with `type` | Each email has `num_sources`, `first_seen`, `last_seen`. Separate **`possible_emails`** = weaker associations |
| Mobile | `mobile_phone` (single), `phone_numbers[]`, `phones[]` | Docs: mobile is "highly confident source"; phones carry `num_sources`. **`possible_phones`** = weaker |
| Employment | `experience[]` | Structured job history (title/company/dates) |
| Social | `profiles[]`, `linkedin_url`, `twitter_url`, `facebook_url`, etc. | `possible_profiles` = weaker |
| Explicitly inferred | `inferred_salary`, `inferred_years_experience`, `job_company_inferred_revenue`, `possible_location_names` | Field names / docs say inferred or "possible" |

**Sourced vs inferred (PDL):** treat primary contact arrays + `num_sources ≥ 1` as sourced associations; treat `possible_*` and `inferred_*` as inferred/predicted. Free plans may redact contact values to booleans — note plan tier in live results.

## Comparison dimensions (for live report)

Mirror `docs/CORESIGNAL_VS_CRUSTDATA_COMPARISON.md` structure when writing the final report:

1. Methodology (same LinkedIn URLs from Deal 14 `role_discovery_cache`)
2. Permission / plan gate results (Contact Enrich enabled?)
3. Per-candidate matrix: personal email, mobile, employment depth, social profiles
4. Sourced vs inferred labeling per vendor
5. Credit cost per candidate
6. Recommendation: complement vs replace vs keep current waterfall

## Next live steps (deploy `compare-enrichment-vendors`)

1. `mode: "permissions"` — free credits + endpoints check  
2. `mode: "probe_contact"` — **one** known LinkedIn URL  
3. `mode: "compare"` — Deal 14 URLs through Crustdata Person Enrich (+ Contact if permitted) and PDL Enrich  
4. Write `docs/ENRICHMENT_CRUSTDATA_VS_PDL.md` from the JSON output
