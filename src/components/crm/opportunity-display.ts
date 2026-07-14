import { type OpportunityStatus, STATUS_LABELS } from "@/lib/opportunity";
import { OPPORTUNITY_GROUPS } from "@/lib/opportunity-pipeline";

// The source/status label maps are owned by `@/lib/opportunity` (alongside the
// enums they key on). Re-exported here for the existing importers that reach
// for them via this display module.
export { SOURCE_LABELS, STATUS_LABELS } from "@/lib/opportunity";

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
