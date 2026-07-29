"use client";

import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { deleteCompanyContactRelationship } from "@/actions/crm/deleteCompanyContactRelationship";
import type { ContactRelatedCompany } from "@/actions/crm/getContactDetail";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { IconButton } from "@/components/icon-button";
import { InternalLink } from "@/components/internal-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { DetailSection, DetailTable, TableEmpty } from "./detail-parts";
import { RelationshipDialog } from "./relationship-dialog";

/**
 * "Related companies" on the contact page — the mirror of the company page's
 * `RelatedContactsSection`. Their employer stays in the sidebar; this is every
 * *other* company they touch: a client they're the CSM for, a former employer, one
 * they invest in. Partner companies carry a badge, matching the company page.
 */
export function RelatedCompaniesSection({
  contactId,
  employerCompanyId,
  rows,
  canEdit,
}: {
  contactId: string;
  /** Excluded from the picker — employment isn't a relationship row. */
  employerCompanyId: string | null;
  rows: ContactRelatedCompany[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ContactRelatedCompany | null>(null);
  const [removing, setRemoving] = useState<ContactRelatedCompany | null>(null);

  const remove = useAction(deleteCompanyContactRelationship, {
    onSuccess: () => setRemoving(null),
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't remove the relationship."),
  });

  return (
    <DetailSection
      title="Related companies"
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
          No related companies yet — companies this person touches without
          working there.
        </TableEmpty>
      ) : (
        <DetailTable
          headers={
            canEdit
              ? ["Company", "Relationship", ""]
              : ["Company", "Relationship"]
          }
        >
          {rows.map((row) => (
            <TableRow key={row.relationshipId}>
              <TableCell className="font-medium">
                <span className="flex flex-wrap items-center gap-2">
                  <InternalLink href={`/companies/${row.id}`}>
                    {row.name}
                  </InternalLink>
                  {row.isPartner ? (
                    <Badge variant="secondary">Partner</Badge>
                  ) : null}
                </span>
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
          side="contact"
          anchorId={contactId}
          employerCompanyId={employerCompanyId}
          existing={null}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {editing ? (
        <RelationshipDialog
          side="contact"
          anchorId={contactId}
          employerCompanyId={employerCompanyId}
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
            ? `This unlinks this contact from ${removing.name}. Both records are otherwise unchanged.`
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
