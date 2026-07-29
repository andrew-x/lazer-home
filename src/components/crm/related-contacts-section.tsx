"use client";

import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { deleteCompanyContactRelationship } from "@/actions/crm/deleteCompanyContactRelationship";
import type { CompanyRelatedContact } from "@/actions/crm/getCompanyDetail";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyCell } from "@/components/empty-cell";
import { IconButton } from "@/components/icon-button";
import { InternalLink } from "@/components/internal-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { INACTIVE_LABEL } from "@/lib/crm/contact-status";
import { DetailSection, DetailTable, TableEmpty } from "./detail-parts";
import { RelationshipDialog } from "./relationship-dialog";

/**
 * "Related contacts" on the company page: people linked to this company who don't
 * work here — a partner's CSM on the account, an embedded FDE, a former employee.
 * Sits beneath the employee directory in the Contacts tab, so the two readings of
 * "who's involved with this company" live side by side.
 *
 * Each row links to the person and to their own employer, which is the column that
 * makes the distinction legible at a glance.
 */
export function RelatedContactsSection({
  companyId,
  rows,
  canEdit,
}: {
  companyId: string;
  rows: CompanyRelatedContact[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CompanyRelatedContact | null>(null);
  const [removing, setRemoving] = useState<CompanyRelatedContact | null>(null);

  const remove = useAction(deleteCompanyContactRelationship, {
    onSuccess: () => setRemoving(null),
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't remove the relationship."),
  });

  return (
    <DetailSection
      title="Related contacts"
      count={rows.length}
      action={
        canEdit ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <IconPlus />
            Add relationship
          </Button>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <TableEmpty>
          No related contacts yet — people who work elsewhere but touch this
          company.
        </TableEmpty>
      ) : (
        <DetailTable
          headers={
            canEdit
              ? ["Name", "Employer", "Relationship", ""]
              : ["Name", "Employer", "Relationship"]
          }
        >
          {rows.map((row) => (
            <TableRow key={row.relationshipId}>
              <TableCell className="font-medium">
                <span className="flex flex-wrap items-center gap-2">
                  <InternalLink href={`/contacts/${row.id}`}>
                    {row.name}
                  </InternalLink>
                  {row.isActive ? null : (
                    <Badge variant="secondary">{INACTIVE_LABEL}</Badge>
                  )}
                </span>
                {row.role ? (
                  <div className="text-xs font-normal text-muted-foreground">
                    {row.role}
                  </div>
                ) : null}
              </TableCell>
              <TableCell>
                {row.employerId && row.employerName ? (
                  <InternalLink href={`/companies/${row.employerId}`}>
                    {row.employerName}
                  </InternalLink>
                ) : (
                  <EmptyCell />
                )}
              </TableCell>
              <TableCell>{row.description}</TableCell>
              {canEdit ? (
                <TableCell className="w-0 text-right whitespace-nowrap">
                  <IconButton
                    label="Edit relationship"
                    onClick={() => setEditing(row)}
                  >
                    <IconPencil />
                  </IconButton>
                  <IconButton
                    label="Remove relationship"
                    onClick={() => setRemoving(row)}
                  >
                    <IconTrash />
                  </IconButton>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </DetailTable>
      )}

      {adding ? (
        <RelationshipDialog
          side="company"
          anchorId={companyId}
          existing={null}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {editing ? (
        <RelationshipDialog
          side="company"
          anchorId={companyId}
          existing={{
            relationshipId: editing.relationshipId,
            targetName: editing.name,
            description: editing.description,
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (!next && !remove.isPending) setRemoving(null);
        }}
        title="Remove relationship?"
        description={
          removing
            ? `This unlinks ${removing.name} from this company. Their contact record and their employer are unchanged.`
            : undefined
        }
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (removing) remove.execute({ id: removing.relationshipId });
        }}
      />
    </DetailSection>
  );
}
