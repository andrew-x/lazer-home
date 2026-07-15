import { Badge } from "@/components/ui/badge";
import type { OpportunityStatus } from "@/lib/opportunity";
import { groupOfStatus } from "@/lib/opportunity-pipeline";

/**
 * A pipeline status shown as its group label ("Scoping", "Won", …) — the same
 * grouping the kanban board uses. Won reads as the primary (default) badge;
 * everything else, including lost, stays muted.
 */
export function OpportunityStatusBadge({
  status,
}: {
  status: OpportunityStatus;
}) {
  return (
    <Badge variant={status === "closed_won" ? "default" : "secondary"}>
      {groupOfStatus(status).label}
    </Badge>
  );
}
