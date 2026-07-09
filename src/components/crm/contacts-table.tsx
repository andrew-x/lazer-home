import { IconBrandLinkedin } from "@tabler/icons-react";
import type { ContactRow } from "@/actions/crm/getContactsPage";
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
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>
              {contact.role ?? <span className="text-muted-foreground">—</span>}
            </TableCell>
            <TableCell>
              {contact.companyName ?? (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>
              {contact.managerName ?? (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>
              {contact.linkedinUrl ? (
                <a
                  href={contact.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  <IconBrandLinkedin className="size-4" />
                  Profile
                </a>
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
