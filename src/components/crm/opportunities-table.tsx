import type { OpportunityRow } from "@/actions/crm/getOpportunitiesPage";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SOURCE_LABELS, STATUS_LABELS } from "./opportunity-display";

export function OpportunitiesTable({ rows }: { rows: OpportunityRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-2 py-8 text-center text-sm text-muted-foreground">
        No opportunities yet.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Company</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Owners</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((opportunity) => (
          <TableRow key={opportunity.id}>
            <TableCell className="font-medium">{opportunity.name}</TableCell>
            <TableCell>{opportunity.companyName}</TableCell>
            <TableCell>
              <Badge variant="secondary">
                {STATUS_LABELS[opportunity.status]}
              </Badge>
            </TableCell>
            <TableCell>{SOURCE_LABELS[opportunity.source]}</TableCell>
            <TableCell>
              {opportunity.ownerNames.length > 0 ? (
                opportunity.ownerNames.join(", ")
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
