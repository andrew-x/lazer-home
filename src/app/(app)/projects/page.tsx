import type { Metadata } from "next";
import { getProjectsPage } from "@/actions/projects/getProjectsPage";
import { PaginationControls } from "@/components/pagination-controls";
import { AddProjectDialog } from "@/components/projects/add-project-dialog";
import { ProjectsTable } from "@/components/projects/projects-table";
import { getCurrentUser } from "@/lib/auth";
import { parsePage } from "@/lib/pagination";
import { userHasPermission } from "@/lib/permissions";

export const metadata: Metadata = { title: "Projects" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const [projects, user] = await Promise.all([
    getProjectsPage(parsePage(params.projectsPage)),
    getCurrentUser(),
  ]);

  const canEdit = user
    ? userHasPermission(user, { projects: ["edit"] })
    : false;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10">
      <header>
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          Projects
        </h2>
        <p className="text-sm text-muted-foreground">
          Client engagements and the people staffed on them.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-heading text-base font-semibold tracking-tight">
            All projects
          </h3>
          {canEdit ? <AddProjectDialog /> : null}
        </div>
        <div className="rounded-md border">
          <ProjectsTable rows={projects.rows} />
          <PaginationControls
            basePath="/projects"
            params={params}
            paramKey="projectsPage"
            page={projects.page}
            pageCount={projects.pageCount}
          />
        </div>
      </section>
    </div>
  );
}
