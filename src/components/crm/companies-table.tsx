import type { CompanyRow } from "@/actions/crm/getCompaniesPage";
import { EmptyCell } from "@/components/empty-cell";
import { EmptyState } from "@/components/empty-state";
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
import {
  COMPANY_STATUS_LABELS,
  companyStatusTags,
} from "@/lib/crm/company-status";

export function CompaniesTable({
  rows,
  filtered = false,
}: {
  rows: CompanyRow[];
  /** Whether a search/status filter is active — tunes the empty message. */
  filtered?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState>
        {filtered ? "No companies match your filters." : "No companies yet."}
      </EmptyState>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Location</TableHead>
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
              <TableCell>{company.location ?? <EmptyCell />}</TableCell>
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
