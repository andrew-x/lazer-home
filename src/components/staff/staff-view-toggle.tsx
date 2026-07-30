import { IconLayoutGrid, IconSitemap } from "@tabler/icons-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { buildListHref, type SearchParams } from "@/lib/core/list-href";
import { cn } from "@/lib/core/utils";

export type StaffView = "directory" | "org";

/**
 * Segmented Directory/Org chart switch for `/staff`, mirroring the opportunities
 * board/list toggle. Link-based (not local state) so the choice lives in the URL
 * and a chart can be deep-linked; everything *inside* each view filters in memory,
 * which is why `?view=` is the only staff param.
 *
 * `/staff` has no pagination, so the `"page"` key passed to `buildListHref` is a
 * no-op — kept so the call reads like every other list-href call in the app.
 */
export function StaffViewToggle({
  current,
  params,
}: {
  current: StaffView;
  params: SearchParams;
}) {
  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-md border p-0.5">
      <Button
        size="sm"
        variant={current === "directory" ? "secondary" : "ghost"}
        aria-current={current === "directory"}
        className={cn(current !== "directory" && "text-muted-foreground")}
        render={
          <Link
            href={buildListHref("/staff", "page", params, { view: null })}
          />
        }
      >
        <IconLayoutGrid />
        Directory
      </Button>
      <Button
        size="sm"
        variant={current === "org" ? "secondary" : "ghost"}
        aria-current={current === "org"}
        className={cn(current !== "org" && "text-muted-foreground")}
        render={
          <Link
            href={buildListHref("/staff", "page", params, { view: "org" })}
          />
        }
      >
        <IconSitemap />
        Org chart
      </Button>
    </div>
  );
}
