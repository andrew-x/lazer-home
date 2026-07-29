import type { ContactRow } from "@/actions/crm/getContactsPage";
import { ContactTasksCell } from "@/components/crm/contact-tasks-cell";
import { EmptyCell } from "@/components/empty-cell";
import { EmptyState } from "@/components/empty-state";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { InternalLink } from "@/components/internal-link";
import { ROOMY_TABLE } from "@/components/table-density";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { INACTIVE_LABEL } from "@/lib/crm/contact-status";

/**
 * The contacts list table. A server component: only the "Next steps" cell
 * crosses the client boundary, so it can be worked in place (see
 * {@link ContactTasksCell}). The job title rides under the name rather than
 * taking a column of its own.
 */
export function ContactsTable({
  rows,
  filtered = false,
  canEdit,
  currentStaff,
}: {
  rows: ContactRow[];
  /** Whether a search or location filter is active — tunes the empty message. */
  filtered?: boolean;
  /** Whether the viewer holds `crm.edit` — enables the editable tasks cell. */
  canEdit: boolean;
  /** The viewer's own staff `{ id, name }` — the tasks composer's default owner. */
  currentStaff: EntityOption | null;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState>
        {filtered ? "No contacts match your filters." : "No contacts yet."}
      </EmptyState>
    );
  }

  return (
    <Table className={ROOMY_TABLE}>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Company</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Next steps</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((contact) => (
          <TableRow key={contact.id}>
            <TableCell className="font-medium">
              <span className="flex flex-wrap items-center gap-2">
                <InternalLink href={`/contacts/${contact.id}`}>
                  {contact.firstName} {contact.lastName}
                </InternalLink>
                {/* Inactive contacts are hidden unless the "Include inactive"
                    filter is on, so when one appears it has to be obvious why. */}
                {contact.isActive ? null : (
                  <Badge variant="secondary">{INACTIVE_LABEL}</Badge>
                )}
              </span>
              {contact.role ? (
                <div className="text-xs font-normal text-muted-foreground">
                  {contact.role}
                </div>
              ) : null}
              {/* An inactive row is otherwise a dead end: the one thing worth knowing
                  is where this person went, so link the newer record right here
                  rather than making someone open the page to find out. */}
              {contact.successor ? (
                <div className="text-xs font-normal text-muted-foreground">
                  Moved to{" "}
                  <InternalLink href={`/contacts/${contact.successor.id}`}>
                    {contact.successor.name}
                  </InternalLink>
                  {contact.successor.companyName
                    ? ` at ${contact.successor.companyName}`
                    : null}
                </div>
              ) : null}
            </TableCell>
            <TableCell>
              {contact.companyId && contact.companyName ? (
                // Capped on the link, not the cell: `max-width` on a `td` is
                // only advisory outside `table-layout: fixed`, so the clamp has
                // to live on a block inside it. `title` keeps the full name
                // reachable once it's clipped.
                <InternalLink
                  href={`/companies/${contact.companyId}`}
                  title={contact.companyName}
                  className="block max-w-36 truncate"
                >
                  {contact.companyName}
                </InternalLink>
              ) : (
                <EmptyCell />
              )}
            </TableCell>
            <TableCell>{contact.location ?? <EmptyCell />}</TableCell>
            <TableCell>
              <ContactTasksCell
                contactId={contact.id}
                tasks={contact.openTasks}
                canEdit={canEdit}
                currentStaff={currentStaff}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
