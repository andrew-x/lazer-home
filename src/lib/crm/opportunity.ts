/**
 * The opportunity pipeline enums and their human labels. Declared here as a
 * pure, client-importable module (no `db`/drizzle, no UI) so the pgEnums in
 * `opportunities-schema.ts`, the zod schemas, the display labels, and the
 * pipeline grouping all derive from exactly one source of truth — mirrors
 * `src/lib/line-of-business.ts`. Everything imports these DOWNWARD from here;
 * nothing reaches back up into the actions layer for them. See docs/domains/crm.md.
 */
export const OPPORTUNITY_SOURCES = [
  "inbound",
  "farming",
  "extension",
  "change_request",
  "staff_referral",
  "contact_referral",
] as const;

/**
 * The pipeline stages, as flat leaf statuses in strict pipeline order. Array
 * index === pipeline position — both the pgEnum and the group structure in
 * `@/lib/crm/opportunity-pipeline` derive from this order, so keep them ordered.
 * Grouping (Scoping/Allocating/Closing hold several substatuses; the rest are
 * single-status groups) lives in `opportunity-pipeline.ts`.
 */
export const OPPORTUNITY_STATUSES = [
  "maturing",
  "lead",
  "qualifying",
  "scoping_awaiting_info",
  "scoping",
  "scoping_reviewing",
  "allocating_awaiting_profiles",
  "allocating_introing_profiles",
  "negotiating",
  "closing_awaiting_contracts",
  "closing_redlining",
  "closing_awaiting_signatures",
  "closed_won",
  "closed_lost",
] as const;

export type OpportunitySource = (typeof OPPORTUNITY_SOURCES)[number];
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

/**
 * The terminal pipeline statuses — a deal that's been decided, won or lost. An
 * opportunity is "open" iff its status is not one of these. Kept here beside the
 * status list so anything distinguishing live vs. closed deals (e.g. a company's
 * derived "prospect" status) shares one source of truth.
 */
export const CLOSED_OPPORTUNITY_STATUSES = [
  "closed_won",
  "closed_lost",
] as const satisfies readonly OpportunityStatus[];

/** Human labels for the opportunity source enum. */
export const SOURCE_LABELS: Record<OpportunitySource, string> = {
  inbound: "Inbound",
  farming: "Farming",
  extension: "Extension",
  change_request: "Change request",
  staff_referral: "Staff referral",
  contact_referral: "Contact referral",
};

/**
 * Human labels for each leaf status. These are the substatus labels shown on
 * cards; the group labels (Scoping, Allocating, Closing, …) live in
 * `@/lib/crm/opportunity-pipeline`.
 */
export const STATUS_LABELS: Record<OpportunityStatus, string> = {
  maturing: "Maturing",
  lead: "Lead",
  qualifying: "Qualifying",
  scoping_awaiting_info: "Awaiting info",
  scoping: "Scoping",
  scoping_reviewing: "Reviewing scope",
  allocating_awaiting_profiles: "Awaiting profiles",
  allocating_introing_profiles: "Introing profiles",
  negotiating: "Negotiating",
  closing_awaiting_contracts: "Awaiting contracts",
  closing_redlining: "Redlining",
  closing_awaiting_signatures: "Awaiting signatures",
  closed_won: "Closed – Won",
  closed_lost: "Closed – Lost",
};
