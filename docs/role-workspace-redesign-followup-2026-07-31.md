# Role Workspace Redesign — Follow-up 2026-07-31

## Changes in this batch

### Gap 1 — Removed dead "Active criteria" block
`RoleMemoryPanel` no longer shows the always-empty "Active criteria / None yet — calibrate to learn." section. The `learnedCriteria` query, `activeCriteria` derived array, and `handleRelax` handler have all been removed — `learnedCriteria` was not populated by the current calibration flow so the block was pure noise.

### Gap 2 Option 2 — Structural transcript suppression
`RoleConversationTranscript` now renders historical `candidate_card` turns as a compact summary line ("Sourced N candidates — see Review tab") instead of full CandidateCard components. Only the very latest batch (computed via `latestBatchIds`) renders as full cards, and those are still guarded by the existing `hideCardTurns` prop. Consecutive historical card turns are grouped into a single summary line per batch. This fix is reload-safe: historical batches never flood the transcript regardless of `lastBatch` state. A new `onOpenReview?: () => void` prop is accepted; if provided, the summary line is a clickable link that calls it.

### Gap 2 Option 1 — lastBatch rehydration on mount
`RoleWorkspacePage` now rehydrates `lastBatch` on mount from conversation turns (the same data already fetched by `RoleConversationTranscript`; React Query caches the result so no extra network call is made). On load, the component scans the latest trailing run of `candidate_card` turns and maps each turn's metadata to `CalibrationCandidate` shape, then calls `setLastBatch`. This fires only when `lastBatch` is still `null` (i.e., no live sourcing batch has been set). The Review tab is therefore populated after a reload without re-running sourcing.

The tabs are now controlled (`value`/`onValueChange`) instead of uncontrolled (`defaultValue`). The initial tab is set reactively once `pipelinePending` resolves. `onOpenReview={() => setActiveTab("review")}` is passed to `RoleConversationTranscript` so clicking a historical-batch summary line switches the active tab.

## Verification

After sourcing candidates and reloading `/roles/N`:
- Transcript shows dialogue + compact "Sourced N candidates — see Review tab" summary lines only — no full CandidateCard components in history.
- Clicking a summary line switches to the Review tab.
- Review tab lists candidates from the last batch (rehydrated from turns on mount).
- "Active criteria / None yet" section is gone from the Role memory panel.

## Out of scope (this batch)
- Stage 2→3 parse bugs
- Harvest enrichment on reload
- Font/color changes
