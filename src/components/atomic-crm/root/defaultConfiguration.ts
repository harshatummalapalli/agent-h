import type { ConfigurationContextValue } from "./ConfigurationContext";

export const defaultDarkModeLogo = "./logos/logo_atomic_crm_dark.svg";
export const defaultLightModeLogo = "./logos/logo_atomic_crm_light.svg";

export const defaultCurrency = "USD";

export const defaultTitle = "TalentCursor";

export const defaultCompanySectors = [
  { value: "communication-services", label: "Communication Services" },
  { value: "consumer-discretionary", label: "Consumer Discretionary" },
  { value: "consumer-staples", label: "Consumer Staples" },
  { value: "energy", label: "Energy" },
  { value: "financials", label: "Financials" },
  { value: "health-care", label: "Health Care" },
  { value: "industrials", label: "Industrials" },
  { value: "information-technology", label: "Information Technology" },
  { value: "materials", label: "Materials" },
  { value: "real-estate", label: "Real Estate" },
  { value: "utilities", label: "Utilities" },
];

// Agent H: replaced Atomic CRM's sales-deal lifecycle (Opportunity / Proposal
// Sent / In Negotiation / Won / Lost / Delayed) with a recruiting pipeline.
// "value" is the literal string stored in deals.stage (free text column, no
// DB constraint -- see supabase/schemas/01_tables.sql) so renaming a label
// here never requires a migration; only the id itself needs one, and this
// pass migrated the few existing rows via SQL rather than keeping the old
// "opportunity" id around under a new label. Offer/Placed/Lost are included
// even though there's no dedicated Offer-stage tooling yet -- the stage
// field itself (drag-to-reorder, filtering) already works for any value;
// only the automation behind later stages is still to be built.
export const defaultDealStages = [
  { value: "sourcing", label: "Sourcing" },
  { value: "screening", label: "Screening" },
  { value: "client-review", label: "Client Review" },
  { value: "offer", label: "Offer Extended" },
  { value: "placed", label: "Placed" },
  { value: "lost", label: "Lost / Closed" },
];

export const defaultDealPipelineStatuses = ["placed"];

export const defaultDealCategories = [
  { value: "other", label: "Other" },
  { value: "engineering", label: "Engineering" },
  { value: "product", label: "Product" },
  { value: "design", label: "Design" },
  { value: "sales", label: "Sales" },
  { value: "operations", label: "Operations" },
];

export const defaultNoteStatuses = [
  { value: "cold", label: "Cold", color: "#7dbde8" },
  { value: "warm", label: "Warm", color: "#e8cb7d" },
  { value: "hot", label: "Hot", color: "#e88b7d" },
  { value: "in-contract", label: "In Contract", color: "#a4e87d" },
];

export const defaultTaskTypes = [
  { value: "none", label: "None" },
  { value: "email", label: "Email" },
  { value: "demo", label: "Demo" },
  { value: "lunch", label: "Lunch" },
  { value: "meeting", label: "Meeting" },
  { value: "follow-up", label: "Follow-up" },
  { value: "thank-you", label: "Thank you" },
  { value: "ship", label: "Ship" },
  { value: "call", label: "Call" },
];

export const defaultConfiguration: ConfigurationContextValue = {
  companySectors: defaultCompanySectors,
  currency: defaultCurrency,
  dealCategories: defaultDealCategories,
  dealPipelineStatuses: defaultDealPipelineStatuses,
  dealStages: defaultDealStages,
  noteStatuses: defaultNoteStatuses,
  taskTypes: defaultTaskTypes,
  title: defaultTitle,
  darkModeLogo: defaultDarkModeLogo,
  lightModeLogo: defaultLightModeLogo,
};
