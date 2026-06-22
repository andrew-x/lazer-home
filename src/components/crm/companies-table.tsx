import type { CompanyRow } from "@/actions/crm/getCompaniesPage";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function CompaniesTable({ rows }: { rows: CompanyRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-2 py-8 text-center text-sm text-muted-foreground">
        No companies yet.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Website</TableHead>
          <TableHead>Partner</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((company) => (
          <TableRow key={company.id}>
            <TableCell className="font-medium">{company.name}</TableCell>
            <TableCell>
              {company.websiteUrl ? (
                <a
                  href={company.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {company.websiteUrl.replace(/^https?:\/\//, "")}
                </a>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>
              {company.isPartner ? (
                <Badge variant="secondary">Partner</Badge>
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
