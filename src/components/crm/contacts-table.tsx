import type { ContactRow } from "@/actions/crm/getContactsPage";
import { EmptyCell } from "@/components/empty-cell";
import { InternalLink } from "@/components/internal-link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatShortDate } from "@/lib/format";

export function ContactsTable({ rows }: { rows: ContactRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-2 py-8 text-center text-sm text-muted-foreground">
        No contacts yet.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Company</TableHead>
          <TableHead>Role</TableHead>
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
            <TableCell>
              {contact.nextStep ? (
                <span className="flex flex-col gap-0.5">
                  <span className="line-clamp-2">{contact.nextStep}</span>
                  {contact.nextStepAt ? (
                    <span className="text-xs text-muted-foreground">
                      {formatShortDate(new Date(contact.nextStepAt))}
                    </span>
                  ) : null}
                </span>
              ) : (
                <EmptyCell />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
