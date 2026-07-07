import type {
  OpportunitySource,
  OpportunityStatus,
} from "@/actions/crm/createOpportunity.schema";

/** Human labels for the opportunity source enum. */
export const SOURCE_LABELS: Record<OpportunitySource, string> = {
  inbound: "Inbound",
  farming: "Farming",
  extension: "Extension",
  change_request: "Change request",
  staff_referral: "Staff referral",
  contact_referral: "Contact referral",
};

/** Human labels for the opportunity status/stage enum. */
export const STATUS_LABELS: Record<OpportunityStatus, string> = {
  maturing: "Maturing",
  lead: "Lead",
  qualifying: "Qualifying",
  scoping: "Scoping",
  closing: "Closing",
  closed_lost: "Closed – Lost",
  closed_won: "Closed – Won",
};
