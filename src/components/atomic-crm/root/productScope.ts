// Agent H: single source of truth for which ATS phases are actually live in
// the product, vs. built later. The PRD covers five stages end to end (JD
// Intake+Sourcing, Screening, Scheduling, Offer, plus the underlying
// CRM/pipeline); shipping the front end as if all five already existed --
// nav tabs, buttons, empty pages -- looks unfinished to anyone previewing
// this product. Instead the nav (see layout/Header.tsx) only renders what a
// flag here marks `true`; flipping a flag to `true` once a phase's backend
// functions are actually built "unlocks" it in the UI, matching the phased
// build plan agreed with the product owner. This is intentionally a plain
// boolean map, not a database table or per-tenant setting -- at MVP/single-
// tenant stage there is exactly one deployment to configure, so a config
// table would be premature (see coding-style.md: YAGNI).
export const PRODUCT_SCOPE = {
  // Phase 1 (live): JD intake, sourcing, and screening -- role creation,
  // candidate discovery/ranking, and the evaluation-card work.
  sourcing: true,
  screening: true,
  // Phase 2 (not yet built): interview scheduling / coordinator-style
  // calendar booking. Flip to true once that stage ships.
  scheduling: false,
  // Phase 3 (not yet built): offer stage tooling.
  offer: false,
} as const;

export type ProductScopeKey = keyof typeof PRODUCT_SCOPE;
