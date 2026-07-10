import type {
  OpportunitySource,
  OpportunityStatus,
} from "@/actions/crm/createOpportunity.schema";
import { OPPORTUNITY_GROUPS } from "@/lib/opportunity-pipeline";

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
 * `@/lib/opportunity-pipeline`.
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

/**
 * Status labels for a dropdown that lists every leaf status with no column
 * context — substatuses are qualified with their group (e.g. "Scoping – Awaiting
 * info") so they read unambiguously. Shared by the add-opportunity dialog and the
 * detail drawer.
 */
export const STATUS_SELECT_LABELS: Record<OpportunityStatus, string> =
  Object.fromEntries(
    OPPORTUNITY_GROUPS.flatMap((group) =>
      group.statuses.map((status) => [
        status,
        group.statuses.length > 1
          ? `${group.label} – ${STATUS_LABELS[status]}`
          : STATUS_LABELS[status],
      ]),
    ),
  ) as Record<OpportunityStatus, string>;
