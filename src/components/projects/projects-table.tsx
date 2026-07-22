import type { ProjectRow } from "@/actions/projects/getProjectsPage";
import { EmptyCell } from "@/components/empty-cell";
import { EmptyState } from "@/components/empty-state";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";

export function ProjectsTable({ rows }: { rows: ProjectRow[] }) {
  if (rows.length === 0) {
    return <EmptyState>No projects yet.</EmptyState>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Line of business</TableHead>
          <TableHead>Company</TableHead>
          <TableHead>Delivery managers</TableHead>
          <TableHead>Roles</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((project) => (
          <TableRow key={project.id}>
            <TableCell className="font-medium">{project.name}</TableCell>
            <TableCell>
              <ProjectStatusBadge status={project.status} />
            </TableCell>
            <TableCell>
              {project.linesOfBusiness.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {project.linesOfBusiness.map((lob) => (
                    <Badge key={lob} variant="outline">
                      {LINE_OF_BUSINESS_LABELS[lob]}
                    </Badge>
                  ))}
                </div>
              ) : (
                <EmptyCell />
              )}
            </TableCell>
            <TableCell>{project.companyName}</TableCell>
            <TableCell>
              {project.deliveryManagerNames.length > 0 ? (
                project.deliveryManagerNames.join(", ")
              ) : (
                <EmptyCell />
              )}
            </TableCell>
            <TableCell>{project.roleCount}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
