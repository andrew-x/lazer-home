import type { ReactNode } from "react";
import type { ProjectListItem } from "@/actions/projects/getProjectsList";
import { ProjectCard } from "@/components/projects/project-card";

/** A responsive grid of project cards. */
export function ProjectsGrid({ projects }: { projects: ProjectListItem[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}

/**
 * A titled projects section (Tentative / Active / Other): a heading with a count
 * over the card grid. `count` defaults to the number shown, but the paginated
 * Other section passes its total so the heading reflects the whole set, not just
 * the current page. `children` holds anything that follows the grid, e.g. the
 * pagination controls.
 */
export function ProjectsSection({
  title,
  projects,
  count,
  children,
}: {
  title: string;
  projects: ProjectListItem[];
  count?: number;
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-heading text-sm font-semibold tracking-tight text-muted-foreground">
        {title}
        <span className="ml-2 font-normal">{count ?? projects.length}</span>
      </h3>
      <ProjectsGrid projects={projects} />
      {children}
    </section>
  );
}
