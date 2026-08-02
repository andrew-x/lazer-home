import Link from "next/link";
import { buildListHref, type SearchParams } from "@/lib/core/list-href";
import { cn } from "@/lib/core/utils";
import {
  PROJECT_STATUS_BUCKET_LABELS,
  type ProjectStatusBucket,
} from "@/lib/projects/project-derived";
import {
  DEFAULT_PROJECT_STATUS,
  PROJECT_STATUS_TABS,
  PROJECTS_PAGE_KEY,
  PROJECTS_STATUS_KEY,
} from "@/lib/projects/projects-list-sort";

/**
 * The list's status tabs — Active, Tentative, Paused, Past, Cancelled — replacing
 * the five collapsed disclosure sections the page used to stack
 * ([ADR 0060](../../../docs/decisions/0060-projects-list-as-a-sortable-table.md)).
 * The old layout opened on Active with the other four behind chevrons, so four
 * fifths of the portfolio was one click away *and* invisible; a tab strip costs the
 * same click and shows you what you're choosing between.
 *
 * **Links, not a `Tabs` primitive.** Switching buckets changes the server query, so
 * these are navigation, not client-side panel switching — a `<nav>` of links is what
 * that actually is, and it keeps every tab a real URL you can share, open in a new
 * tab, and reach with the back button. The underline treatment matches
 * `Tabs variant="line"` so it reads as the same control.
 *
 * Every bucket is always rendered, including empty ones: the strip must not reshuffle
 * as filters change, and "Cancelled 0" is a fact worth stating.
 */
export function ProjectsStatusTabs({
  params,
  active,
  counts,
}: {
  params: SearchParams;
  active: ProjectStatusBucket;
  /**
   * Per-bucket totals **under the active filters** — so a search that matches
   * nothing in the current tab still advertises the tab where it does match. This is
   * what stands in for the flat cross-status search view the tabs replaced.
   */
  counts: Record<ProjectStatusBucket, number>;
}) {
  return (
    <nav aria-label="Project status" className="flex gap-4 border-b">
      {PROJECT_STATUS_TABS.map((bucket) => {
        const isActive = bucket === active;
        const count = counts[bucket];

        return (
          <Link
            key={bucket}
            href={buildListHref("/projects", PROJECTS_PAGE_KEY, params, {
              // The default tab stays a bare `/projects`, so the canonical URL of
              // the page people land on carries no state at all.
              [PROJECTS_STATUS_KEY]:
                bucket === DEFAULT_PROJECT_STATUS ? null : bucket,
            })}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm font-medium transition-colors",
              isActive
                ? "border-foreground text-foreground"
                : "border-transparent text-foreground/60 hover:text-foreground",
            )}
          >
            {PROJECT_STATUS_BUCKET_LABELS[bucket]}
            <span
              className={cn(
                "tabular-nums",
                count === 0
                  ? "text-muted-foreground/60"
                  : "text-muted-foreground",
              )}
            >
              {count}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
