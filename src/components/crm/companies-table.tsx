import type { CompanyRow } from "@/actions/crm/getCompaniesPage";
import { EmptyCell } from "@/components/empty-cell";
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
import { COMPANY_STATUS_LABELS, companyStatusTags } from "@/lib/company-status";

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
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((company) => {
          const tags = companyStatusTags(company);
          return (
            <TableRow key={company.id}>
              <TableCell className="font-medium">
                <InternalLink href={`/companies/${company.id}`}>
                  {company.name}
                </InternalLink>
              </TableCell>
              <TableCell>
                {tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {COMPANY_STATUS_LABELS[tag]}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <EmptyCell />
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
