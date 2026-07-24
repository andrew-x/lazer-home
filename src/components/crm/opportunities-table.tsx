"use client";

import { useState } from "react";
import type { OpportunityRow } from "@/actions/crm/getOpportunitiesPage";
import { EmptyCell } from "@/components/empty-cell";
import { EmptyState } from "@/components/empty-state";
import { InternalLink } from "@/components/internal-link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { formatShortDate } from "@/lib/format/format";
import { OpportunityDetailSheet } from "./opportunity-detail-sheet";
import { OpportunityStatusBadge } from "./opportunity-status-badge";

/**
 * The opportunities list view: a flat, paginated table (filters + pagination are
 * the page's job). The name opens the same detail drawer the board uses — reusing
 * `OpportunityDetailSheet` (which is edit-gated), so it only mounts for `crm.edit`
 * users; everyone else sees the name as plain text. There's no standalone
 * opportunity detail route, so the drawer is the detail affordance here too.
 */
export function OpportunitiesTable({
  rows,
  canEdit,
  canCreateProject,
}: {
  rows: OpportunityRow[];
  canEdit: boolean;
  canCreateProject: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const open = (id: string) => {
    setSelectedId(id);
    setDrawerOpen(true);
  };

  if (rows.length === 0) {
    return <EmptyState>No opportunities match these filters.</EmptyState>;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Line of business</TableHead>
            <TableHead>Owners</TableHead>
            <TableHead>Last updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => open(row.id)}
                    className="text-left text-primary underline-offset-4 hover:underline"
                  >
                    {row.name}
                  </button>
                ) : (
                  row.name
                )}
              </TableCell>
              <TableCell>
                <InternalLink href={`/companies/${row.companyId}`}>
                  {row.companyName}
                </InternalLink>
              </TableCell>
              <TableCell>
                <OpportunityStatusBadge status={row.status} />
              </TableCell>
              <TableCell>
                <Badge variant="secondary">
                  {LINE_OF_BUSINESS_LABELS[row.lineOfBusiness]}
                </Badge>
              </TableCell>
              <TableCell>
                {row.ownerNames.length > 0 ? (
                  row.ownerNames.join(", ")
                ) : (
                  <EmptyCell />
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatShortDate(new Date(row.updatedAt))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {canEdit ? (
        <OpportunityDetailSheet
          opportunityId={selectedId}
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          canCreateProject={canCreateProject}
        />
      ) : null}
    </>
  );
}
