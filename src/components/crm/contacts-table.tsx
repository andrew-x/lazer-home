import { IconBrandLinkedin } from "@tabler/icons-react";
import type { ContactRow } from "@/actions/crm/getContactsPage";
import { EmptyCell } from "@/components/empty-cell";
import { ExternalLink } from "@/components/external-link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
          <TableHead>Email</TableHead>
          <TableHead>Phone</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Company</TableHead>
          <TableHead>Manager</TableHead>
          <TableHead>LinkedIn</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((contact) => (
          <TableRow key={contact.id}>
            <TableCell className="font-medium">
              {contact.firstName} {contact.lastName}
            </TableCell>
            <TableCell>
              <a
                href={`mailto:${contact.email}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {contact.email}
              </a>
            </TableCell>
            <TableCell>
              {contact.phone ? (
                <a
                  href={`tel:${contact.phone}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {contact.phone}
                </a>
              ) : (
                <EmptyCell />
              )}
            </TableCell>
            <TableCell>{contact.role ?? <EmptyCell />}</TableCell>
            <TableCell>{contact.companyName ?? <EmptyCell />}</TableCell>
            <TableCell>{contact.managerName ?? <EmptyCell />}</TableCell>
            <TableCell>
              {contact.linkedinUrl ? (
                <ExternalLink
                  href={contact.linkedinUrl}
                  className="inline-flex items-center gap-1"
                >
                  <IconBrandLinkedin className="size-4" />
                  Profile
                </ExternalLink>
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
