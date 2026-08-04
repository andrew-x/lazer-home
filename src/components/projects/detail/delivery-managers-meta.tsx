import { MetaField } from "@/components/crm/detail-parts";
import { InternalLink } from "@/components/internal-link";
import { formatDateRange } from "@/lib/format/format";
import type { DeliveryManagerSummary } from "@/lib/projects/delivery-coverage";

/**
 * The project's delivery managers in the detail sidebar — **read-only**, because
 * they are *derived* from the people on its live `DELIVERY` roles, exactly like the
 * "Line of business" field directly above it (ADR 0068). This field used to carry a
 * pencil and write a junction table; a delivery manager is now named by adding a
 * delivery role in the Roles tab, which is strictly more capable since the
 * assignment is dated, statused and priced.
 *
 * The list is **all-time**, not "who runs it today": the projects list and its `dm`
 * filter use the same derivation, and a current-only field would render empty on
 * every finished engagement, reading as missing data rather than as "it's over". The
 * dated reality is carried in each name's `title` — `docs/ui.md`'s rule that dates
 * belong in tooltips rather than inline, where they make every row two lines and
 * ragged.
 *
 * Three explicit branches, and none of them falls through to `MetaField`'s em dash:
 * on a field that just lost its pencil, a bare dash reads as lost data.
 */
export function DeliveryManagersMeta({
  deliveryManagers,
  hasDeliveryRole,
}: {
  deliveryManagers: DeliveryManagerSummary[];
  /** Whether any live delivery role exists, staffed or not. */
  hasDeliveryRole: boolean;
}) {
  return (
    <MetaField label="Delivery managers">
      {deliveryManagers.length > 0 ? (
        <span className="flex flex-wrap items-center gap-x-1">
          {deliveryManagers.map((manager, index) => (
            <span
              key={manager.id}
              title={manager.spans
                .map((span) => formatDateRange(span.startDate, span.endDate))
                .join(" · ")}
            >
              <InternalLink href={`/staff/${manager.id}`}>
                {manager.name}
              </InternalLink>
              {index < deliveryManagers.length - 1 ? "," : null}
            </span>
          ))}
        </span>
      ) : hasDeliveryRole ? (
        // A delivery role exists but nobody is in it. Saying "Unassigned" here would
        // contradict the Roles tab, which shows the open line.
        <span className="text-muted-foreground">
          Open delivery role — nobody assigned
        </span>
      ) : (
        <span className="text-muted-foreground">Unassigned</span>
      )}
    </MetaField>
  );
}
