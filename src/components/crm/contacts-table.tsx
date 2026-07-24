import type { ContactRow } from "@/actions/crm/getContactsPage";
import { ContactNextStepCell } from "@/components/crm/contact-next-step-cell";
import { EmptyCell } from "@/components/empty-cell";
import { EmptyState } from "@/components/empty-state";
import { InternalLink } from "@/components/internal-link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function ContactsTable({
  rows,
  filtered = false,
}: {
  rows: ContactRow[];
  /** Whether a location filter is active — tunes the empty message. */
  filtered?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState>
        {filtered ? "No contacts match your filters." : "No contacts yet."}
      </EmptyState>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Company</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Next steps</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((contact) => (
          <TableRow key={contact.id}>
            <TableCell className="font-medium">
              <InternalLink href={`/contacts/${contact.id}`}>
                {contact.firstName} {contact.lastName}
              </InternalLink>
            </TableCell>
            <TableCell>
              {contact.companyId && contact.companyName ? (
                <InternalLink href={`/companies/${contact.companyId}`}>
                  {contact.companyName}
                </InternalLink>
              ) : (
                <EmptyCell />
              )}
            </TableCell>
            <TableCell>{contact.role ?? <EmptyCell />}</TableCell>
            <TableCell>{contact.location ?? <EmptyCell />}</TableCell>
            <TableCell>
              <ContactNextStepCell
                nextStep={contact.nextStep}
                nextStepAt={contact.nextStepAt}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
