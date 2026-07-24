import type { StaffProjectSummary } from "@/actions/staff/getStaffProjects";
import { InternalLink } from "@/components/internal-link";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";

/**
 * The projects a person has worked on — staffed roles and delivery-manager
 * seats, one row per project. Presentational; the read (`getStaffProjects`) owns
 * the query. Project names link to the project detail page (`/projects/[id]`).
 */
export function StaffProjectsSection({
  projects,
}: {
  projects: StaffProjectSummary[];
}) {
  if (projects.length === 0) {
    return <p className="text-sm text-muted-foreground">No projects yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {projects.map((project) => (
        <li
          key={project.id}
          className="flex items-baseline justify-between gap-4"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <InternalLink
              href={`/projects/${project.id}`}
              className="truncate font-medium"
            >
              {project.name}
            </InternalLink>
            <span className="text-sm text-muted-foreground">
              {project.companyName}
              {project.relationships.length > 0
                ? ` · ${project.relationships.join(", ")}`
                : ""}
            </span>
          </div>
          <ProjectStatusBadge status={project.status} />
        </li>
      ))}
    </ul>
  );
}
