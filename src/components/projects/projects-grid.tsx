import { IconChevronRight } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { ProjectListItem } from "@/actions/projects/getProjectsList";
import { ProjectCard } from "@/components/projects/project-card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

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

const HEADING_CLASS =
  "font-heading text-sm font-semibold tracking-tight text-muted-foreground";

/**
 * A titled projects section (Tentative / Paused / Active / Other): a heading with
 * a count over the card grid. `count` defaults to the number shown, but the
 * paginated Other section passes its total so the heading reflects the whole set,
 * not just the current page. `children` holds anything that follows the grid, e.g.
 * the pagination controls. `collapsible` turns the heading into a disclosure that
 * starts **closed** (unless `defaultOpen`), keeping the lower-priority statuses
 * present but out of the way of the active work.
 */
export function ProjectsSection({
  title,
  projects,
  count,
  collapsible = false,
  defaultOpen = false,
  children,
}: {
  title: string;
  projects: ProjectListItem[];
  count?: number;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children?: ReactNode;
}) {
  const heading = (
    <>
      {title}
      <span className="ml-2 font-normal">{count ?? projects.length}</span>
    </>
  );

  if (collapsible) {
    return (
      <Collapsible
        className="flex flex-col gap-3"
        defaultOpen={defaultOpen}
        render={<section />}
      >
        <h3 className={HEADING_CLASS}>
          {/* The chevron trails the count so titles stay flush-left with the
              non-collapsible sections' headings. */}
          <CollapsibleTrigger className="group flex items-center gap-2 hover:text-foreground">
            {heading}
            <IconChevronRight className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
          </CollapsibleTrigger>
        </h3>
        <CollapsibleContent className="flex flex-col gap-3">
          <ProjectsGrid projects={projects} />
          {children}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className={HEADING_CLASS}>{heading}</h3>
      <ProjectsGrid projects={projects} />
      {children}
    </section>
  );
}
