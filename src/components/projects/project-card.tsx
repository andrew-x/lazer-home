import Link from "next/link";
import type { ProjectListItem } from "@/actions/projects/getProjectsList";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { formatDateRange } from "@/lib/format/format";

/** One project as a clickable card linking to its detail page. */
export function ProjectCard({ project }: { project: ProjectListItem }) {
  // `Card` is a plain <div> that does not forward a Base UI `render` prop, so we
  // wrap it in the Link and carry the padding/hover/layout classes on the Card.
  return (
    <Link
      href={`/projects/${project.id}`}
      aria-label={project.name}
      className="block"
    >
      <Card className="flex h-full flex-col gap-3 p-5 transition-colors hover:bg-accent">
        <div className="flex flex-col gap-0.5">
          <span className="truncate font-medium">{project.name}</span>
          <span className="truncate text-sm text-muted-foreground">
            {project.companyName}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <ProjectStatusBadge status={project.status} />
          {project.linesOfBusiness.map((lob) => (
            <Badge key={lob} variant="outline">
              {LINE_OF_BUSINESS_LABELS[lob]}
            </Badge>
          ))}
        </div>

        <dl className="mt-auto flex flex-col gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">Delivery</dt>
            <dd className="truncate">
              {project.deliveryManagerNames.length > 0 ? (
                project.deliveryManagerNames.join(", ")
              ) : (
                <span className="text-muted-foreground">Unassigned</span>
              )}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">Dates</dt>
            <dd className="truncate">
              {project.startDate && project.endDate ? (
                formatDateRange(project.startDate, project.endDate)
              ) : (
                <span className="text-muted-foreground">No dates</span>
              )}
            </dd>
          </div>
        </dl>
      </Card>
    </Link>
  );
}
