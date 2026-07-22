import { type OpportunityStatus, STATUS_LABELS } from "@/lib/crm/opportunity";
import { OPPORTUNITY_GROUPS } from "@/lib/crm/opportunity-pipeline";

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
