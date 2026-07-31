# Harvest Re-integration — 2026-07-31

## Goal

Re-integrate Harvest for **skills (+ certifications), photo, free incidental emails** — concurrency-safe for free tier (1 concurrent). Do NOT use paid `findEmail=true` yet. GitHub stays Crustdata-only (out of scope).

This supersedes handoff §4 enrichment vendor choice for skills cost ($0.0064 Harvest vs $0.30 Crustdata enrich).

## Current State

- `_shared/harvestClient.ts` exists (`enrichProfileFromHarvest`, `batchEnrichFromHarvest`) — currently uses a worker-loop approach with default concurrency 5; needs hard concurrency limit of 1 (env-configurable) + retry
- `calibration-session` already has some Harvest wiring — needs audit and alignment to this doc (top-N, concurrency 1, Map contract with skills + photoUrl + email)
- May also still call or have residual Crustdata skills enrich — prefer Harvest for skills when `HARVESTAPI_KEY` set; fall back to Crustdata enrich only if Harvest unavailable

---

## Implementation Spec

### 1. `_shared/harvestClient.ts`

- `HARVEST_CONCURRENCY` env var (default `1`)
- `runWithConcurrency` helper — serialises async tasks to at most N concurrent inflight
- Retry-with-backoff on 429/503 (2–3 attempts, ~500 ms / 1 s / 2 s) inside the fetch wrapper
- `fetchHarvestProfile(url, { cheap?: boolean })` — if `cheap: true`, pass `main=true` query param (note: `main=true` caps lists such as experience/skills; default `cheap: true` for pilot cost/latency unless why-fit quality clearly requires full profile)
- **Do NOT set `findEmail=true`**
- Parse response:
  - skills array (string[])
  - certifications array if present (string[])
  - photo URL (`profilePictureUrl`)
  - emails via existing `extractEmails` if present in the raw response — inspect/preserve any email `type` field; sort personal-first only if type metadata exists, else take as-is
- `enrichCandidatesWithHarvestSkills(linkedinUrls: string[]): Promise<Map<string, { skills: string[]; certifications?: string[]; photoUrl: string | null; email: string | null }>>` — uses `runWithConcurrency` + cheap mode

### 2. `calibration-session/index.ts`

After Crustdata pull + exclude post-filter + dedup:

1. Cheap pre-rank/sort on free Crustdata data (title/skill keyword overlap — no LLM if possible)
2. Take top ~10–15 candidates
3. `enrichCandidatesWithHarvestSkills(topN urls)` only — do NOT enrich the full pool
4. Merge skills (union), photoUrl, free email onto those candidates; rest of pool keeps search-only data (do NOT drop from pool)
5. Final `rankCandidates` / rank-discovery-batch with enriched skills when present

- Replace/remove `enrichCandidatesWithCrustdataSkills` call for the default path when Harvest key is set; keep as fallback only when Harvest key is missing
- Remove the `batchEnrichFromHarvest(harvestUrls, 5)` call (concurrency 5) — use `enrichCandidatesWithHarvestSkills` (respects `HARVEST_CONCURRENCY`)
- Update stale header comments about Harvest ↔ Crustdata swap
- Remove `HARVEST_COST_PER_ROLE_CEILING_USD` cost-gate blocking logic (or keep ceiling but don't skip enrichment entirely — just log and proceed for top-N)

### 3. Photo / Email Persistence

- `candidates.photo_url` / `harvest_enriched_at` should already be in schemas — confirm existence; write photo when saving candidates if the path exists
- Carry `photoUrl` into `CandidateCard` (already supports `photoUrl`) through calibration card metadata if not already wired
- Free incidental email: store if candidate contact fields exist without invoking paid lookup; Contact button still PDL for personal email/phone as primary

### 4. Tests (`_shared/harvestClient.test.ts`)

- `runWithConcurrency` respects limit (e.g., concurrency 1 → calls are sequential)
- Retry on 429 (mock fetch returning 429 once then 200)
- `enrichCandidatesWithHarvestSkills` Map shape (`skills`, `certifications`, `photoUrl`, `email`)
- Calibration top-N only enriches slice (unit test if feasible — mock `enrichCandidatesWithHarvestSkills` and verify only topN urls passed)

### 5. Do NOT

- Background async enrich UI for pilot
- Distributed cross-role lock
- Paid `findEmail`
- GitHub via Harvest
- New photo migration if columns already exist

---

## Env Vars

| Variable | Default | Purpose |
|---|---|---|
| `HARVESTAPI_KEY` | — | Harvest API auth key (required for enrichment) |
| `HARVEST_CONCURRENCY` | `1` | Max concurrent Harvest API calls (keep at 1 for free tier) |

---

## Deploy

Functions: `calibration-session` + `_shared/harvestClient.ts`

Steps:
1. `npx supabase functions deploy calibration-session` (picks up `_shared` automatically)
2. Verify `HARVESTAPI_KEY` secret still set in Supabase project dashboard
3. Set `HARVEST_CONCURRENCY=1` if not already present (default is 1)

---

## Live Verify

- Trigger a calibration session with a real role brief
- Confirm skills appear in why-fit output for enriched candidates
- Confirm photo shows in CandidateCard for at least one enriched profile
- Confirm no `findEmail=true` in outbound requests (no paid email flag)
- Confirm sequential fetch behaviour — no 429 storm in logs

---

## Open Item

`main=true` on the Harvest API caps list lengths (skills, experience). If why-fit quality drops noticeably vs. full profile, disable cheap mode (`cheap: false`) for the top-3 candidates and leave cheap for the rest.
