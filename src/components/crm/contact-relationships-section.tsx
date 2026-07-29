"use client";

import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { deleteContactRelationship } from "@/actions/crm/deleteContactRelationship";
import type { ContactRelation } from "@/actions/crm/getContactDetail";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { IconButton } from "@/components/icon-button";
import { InternalLink } from "@/components/internal-link";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  atCompany,
  CONTACT_RELATIONSHIP_GROUP_LABELS,
} from "@/lib/crm/contact-relationship";
import { ContactRelationshipDialog } from "./contact-relationship-dialog";
import { SidebarGroup } from "./detail-parts";

/** How many direct reports show before the rest go behind a disclosure. */
const REPORTS_PREVIEW = 5;

/**
 * The one place every contact ↔ contact relationship is read, added and removed —
 * a group in the contact page's sidebar rail, where the old read-only "Manager"
 * meta field used to be.
 *
 * The rail is 320px, so this deliberately does **not** reuse the
 * `DetailSection` + `DetailTable` shape the `related-*-section` components use:
 * three columns of contact names don't fit. Instead each kind is a captioned group
 * of two-line rows.
 *
 * **Direction lives in the caption**, never in the row. Every caption is phrased
 * from this contact's point of view ("Reports to" vs "Direct reports",
 * "Previously" vs "Moved to"), which is what makes a bare list of names
 * unambiguous without spending rail width on "…reports to them" suffixes.
 *
 * The two *reverse* groups (Direct reports, Moved to) are read-only: their
 * authoritative row is owned by the other contact — whose page is one click away —
 * so removing one from here would silently rewrite someone else's record.
 */
export function ContactRelationshipsSection({
  contactId,
  contactName,
  employerCompanyId,
  manager,
  directReports,
  predecessor,
  successor,
  relatedContacts,
  canEdit,
}: {
  contactId: string;
  contactName: string;
  /** Null ⇒ the dialog can't offer "their manager" (that's scoped to an employer). */
  employerCompanyId: string | null;
  manager: ContactRelation | null;
  directReports: ContactRelation[];
  predecessor: ContactRelation | null;
  successor: ContactRelation | null;
  relatedContacts: ContactRelation[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ContactRelation | null>(null);
  const [removing, setRemoving] = useState<ContactRelation | null>(null);

  const remove = useAction(deleteContactRelationship, {
    onSuccess: () => setRemoving(null),
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't remove the relationship."),
  });

  const isEmpty =
    manager === null &&
    directReports.length === 0 &&
    predecessor === null &&
    successor === null &&
    relatedContacts.length === 0;

  // Nothing to show and nothing to do: don't leave a dead heading in a narrow
  // rail. (A deliberate break from `MetaField`'s always-show-an-em-dash rule —
  // that's for a scalar fact with a stable slot, this is a collection with an
  // action.)
  if (isEmpty && !canEdit) return null;

  return (
    <SidebarGroup
      label="Relationships"
      action={
        canEdit ? (
          <IconButton
            label="Add relationship"
            className="size-7 text-muted-foreground"
            onClick={() => setAdding(true)}
          >
            <IconPlus />
          </IconButton>
        ) : null
      }
    >
      {isEmpty ? (
        <p className="text-sm text-muted-foreground">
          No relationships yet — who they report to, an earlier record for the
          same person, or anyone else they're tied to.
        </p>
      ) : null}

      {manager ? (
        <RelationshipGroup
          caption={CONTACT_RELATIONSHIP_GROUP_LABELS.reportsTo}
        >
          <RelationshipRow
            relation={manager}
            meta={manager.role}
            actions={
              canEdit ? (
                <IconButton
                  label="Remove manager"
                  className="size-7 text-muted-foreground"
                  onClick={() => setRemoving(manager)}
                >
                  <IconTrash />
                </IconButton>
              ) : null
            }
          />
        </RelationshipGroup>
      ) : null}

      {directReports.length > 0 ? (
        <RelationshipGroup
          caption={CONTACT_RELATIONSHIP_GROUP_LABELS.directReports}
          count={directReports.length}
        >
          {directReports.slice(0, REPORTS_PREVIEW).map((row) => (
            <RelationshipRow
              key={row.relationshipId}
              relation={row}
              meta={row.role}
            />
          ))}
          {directReports.length > REPORTS_PREVIEW ? (
            // A disclosure rather than a scroller: a nested `overflow-y-auto`
            // inside a page column reads as broken.
            <Collapsible>
              <CollapsibleContent className="flex flex-col gap-2">
                {directReports.slice(REPORTS_PREVIEW).map((row) => (
                  <RelationshipRow
                    key={row.relationshipId}
                    relation={row}
                    meta={row.role}
                  />
                ))}
              </CollapsibleContent>
              <CollapsibleTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    // `group` is load-bearing: the two labels below swap on
                    // `group-data-[panel-open]`, which needs the marker on the
                    // element Base UI stamps `data-panel-open` onto (the trigger).
                    className="group -ml-2 self-start text-muted-foreground"
                  />
                }
              >
                <span className="group-data-[panel-open]:hidden">
                  Show all {directReports.length}
                </span>
                <span className="hidden group-data-[panel-open]:inline">
                  Show fewer
                </span>
              </CollapsibleTrigger>
            </Collapsible>
          ) : null}
        </RelationshipGroup>
      ) : null}

      {predecessor ? (
        <RelationshipGroup caption={CONTACT_RELATIONSHIP_GROUP_LABELS.succeeds}>
          <RelationshipRow
            relation={predecessor}
            withCompany
            meta="Inactive record"
            actions={
              canEdit ? (
                <IconButton
                  label="Remove succession link"
                  className="size-7 text-muted-foreground"
                  onClick={() => setRemoving(predecessor)}
                >
                  <IconTrash />
                </IconButton>
              ) : null
            }
          />
        </RelationshipGroup>
      ) : null}

      {successor ? (
        <RelationshipGroup
          caption={CONTACT_RELATIONSHIP_GROUP_LABELS.succeededBy}
        >
          <RelationshipRow
            relation={successor}
            withCompany
            meta="Active record"
          />
        </RelationshipGroup>
      ) : null}

      {relatedContacts.length > 0 ? (
        <RelationshipGroup
          caption={CONTACT_RELATIONSHIP_GROUP_LABELS.related}
          count={relatedContacts.length}
        >
          {relatedContacts.map((row) => (
            <RelationshipRow
              key={row.relationshipId}
              relation={row}
              meta={row.description}
              actions={
                canEdit ? (
                  <>
                    <IconButton
                      label="Edit connection"
                      className="size-7 text-muted-foreground"
                      onClick={() => setEditing(row)}
                    >
                      <IconPencil />
                    </IconButton>
                    <IconButton
                      label="Remove connection"
                      className="size-7 text-muted-foreground"
                      onClick={() => setRemoving(row)}
                    >
                      <IconTrash />
                    </IconButton>
                  </>
                ) : null
              }
            />
          ))}
        </RelationshipGroup>
      ) : null}

      {adding ? (
        <ContactRelationshipDialog
          contactId={contactId}
          contactName={contactName}
          employerCompanyId={employerCompanyId}
          currentManagerName={manager?.name ?? null}
          hasPredecessor={predecessor !== null}
          existing={null}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {editing ? (
        <ContactRelationshipDialog
          contactId={contactId}
          contactName={contactName}
          employerCompanyId={employerCompanyId}
          currentManagerName={manager?.name ?? null}
          hasPredecessor={predecessor !== null}
          existing={{
            relationshipId: editing.relationshipId,
            targetName: editing.name,
            description: editing.description ?? "",
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (!next && !remove.isPending) setRemoving(null);
        }}
        title={removing ? removeCopy(removing).title : undefined}
        description={
          removing ? removeCopy(removing, contactName).body : undefined
        }
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (removing) remove.execute({ id: removing.relationshipId });
        }}
      />
    </SidebarGroup>
  );
}

/**
 * Confirm-dialog copy per kind. The `succeeds` body deliberately does **not**
 * promise the predecessor goes back to active: `deleteContactRelationship` leaves
 * `isActive` alone on purpose, so saying otherwise would be a lie.
 */
function removeCopy(
  relation: ContactRelation,
  contactName = "This contact",
): { title: string; body: string } {
  switch (relation.kind) {
    case "reports_to":
      return {
        title: "Remove manager?",
        body: `${contactName} will no longer report to ${relation.name}. Both contact records are otherwise unchanged.`,
      };
    case "succeeds":
      return {
        title: "Remove succession link?",
        body: `${contactName} will no longer continue ${atCompany(relation.name, relation.companyName)}. That record stays inactive — change its status on their page if it should be active again.`,
      };
    case "related":
      return {
        title: "Remove connection?",
        body: `This unlinks ${contactName} from ${relation.name}. Both records are otherwise unchanged.`,
      };
  }
}

/** A captioned run of relationship rows. The caption is what carries direction. */
function RelationshipGroup({
  caption,
  count,
  children,
}: {
  caption: string;
  /** Shown after the caption when there's more than one row. */
  count?: number;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {caption}
        {count !== undefined && count > 1 ? ` · ${count}` : null}
      </p>
      {children}
    </div>
  );
}

/**
 * One relationship: the other contact's name as a link, plus a muted second line
 * doing double duty as their role, the free-text description, or a succession note.
 * `withCompany` appends the employer as plain text — the succession groups need it,
 * because both records carry the *same person's name* and only the company tells
 * them apart. Plain text, not a second link: two links in a 320px row is mush, and
 * the person's record is the useful destination.
 */
function RelationshipRow({
  relation,
  meta,
  withCompany = false,
  actions,
}: {
  relation: ContactRelation;
  meta?: string | null;
  withCompany?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-1">
      <div className="min-w-0 flex-1 text-sm">
        <span>
          <InternalLink href={`/contacts/${relation.id}`}>
            {relation.name}
          </InternalLink>
          {withCompany && relation.companyName
            ? ` at ${relation.companyName}`
            : null}
        </span>
        {meta ? (
          <div className="text-xs text-muted-foreground">{meta}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center">{actions}</div>
      ) : null}
    </div>
  );
}
