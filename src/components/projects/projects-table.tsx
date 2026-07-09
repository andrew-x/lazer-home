import type { ProjectRow } from "@/actions/projects/getProjectsPage";
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
          <TableHead>Company</TableHead>
          <TableHead>Delivery managers</TableHead>
          <TableHead>Roles</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((project) => (
          <TableRow key={project.id}>
            <TableCell className="font-medium">{project.name}</TableCell>
            <TableCell>{project.companyName}</TableCell>
            <TableCell>
              {project.deliveryManagerNames.length > 0 ? (
                project.deliveryManagerNames.join(", ")
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>{project.roleCount}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
