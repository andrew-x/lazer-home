import type { ProjectRow } from "@/actions/projects/getProjectsPage";
import { EmptyCell } from "@/components/empty-cell";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function ProjectsTable({ rows }: { rows: ProjectRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-2 py-8 text-center text-sm text-muted-foreground">
        No projects yet.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
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
