import type { CompanyRow } from "@/actions/crm/getCompaniesPage";
import { EmptyCell } from "@/components/empty-cell";
import { ExternalLink } from "@/components/external-link";
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
            <TableCell className="font-medium">
              <InternalLink href={`/companies/${company.id}`}>
                {company.name}
              </InternalLink>
            </TableCell>
            <TableCell>
              {company.websiteUrl ? (
                <ExternalLink href={company.websiteUrl}>
                  {company.websiteUrl.replace(/^https?:\/\//, "")}
                </ExternalLink>
              ) : (
                <EmptyCell />
              )}
            </TableCell>
            <TableCell>
              {company.isPartner ? (
                <Badge variant="secondary">Partner</Badge>
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
