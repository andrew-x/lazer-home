import { IconBriefcase, IconUsers } from "@tabler/icons-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { buildListHref, type SearchParams } from "@/lib/core/list-href";
import { cn } from "@/lib/core/utils";

export type AllocationsView = "staff" | "project";

/**
 * Segmented By staff / By project switch for `/allocations`, mirroring the
 * staff directory/org-chart toggle. Link-based (not local state) so the choice
 * lives in the URL and a project view can be deep-linked; everything *inside*
 * each view filters in memory, which is why `?view=` is the only allocations
 * param.
 *
 * `/allocations` has no pagination, so the `"page"` key passed to
 * `buildListHref` is a no-op — kept so the call reads like every other
 * list-href call in the app.
 */
export function AllocationsViewToggle({
  current,
  params,
}: {
  current: AllocationsView;
  params: SearchParams;
}) {
  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-md border p-0.5">
      <Button
        size="sm"
        variant={current === "staff" ? "secondary" : "ghost"}
        aria-current={current === "staff"}
        className={cn(current !== "staff" && "text-muted-foreground")}
        render={
          <Link
            href={buildListHref("/allocations", "page", params, {
              view: null,
            })}
          />
        }
      >
        <IconUsers />
        By staff
      </Button>
      <Button
        size="sm"
        variant={current === "project" ? "secondary" : "ghost"}
        aria-current={current === "project"}
        className={cn(current !== "project" && "text-muted-foreground")}
        render={
          <Link
            href={buildListHref("/allocations", "page", params, {
              view: "project",
            })}
          />
        }
      >
        <IconBriefcase />
        By project
      </Button>
    </div>
  );
}
