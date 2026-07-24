import { IconLayoutKanban, IconList } from "@tabler/icons-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/core/utils";

export type OpportunityView = "board" | "list";

/**
 * Segmented Board/List switch for the opportunities page. Link-based (not local
 * state) so the choice lives in the URL — the board's "Show more" links can deep
 * -link straight into the list view. Selecting "Board" drops any list-only params
 * (stage/lob/search/page); "List" carries the plain `?view=list`.
 */
export function OpportunityViewToggle({
  current,
}: {
  current: OpportunityView;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border p-0.5">
      <Button
        size="sm"
        variant={current === "board" ? "secondary" : "ghost"}
        aria-current={current === "board"}
        className={cn(current !== "board" && "text-muted-foreground")}
        render={<Link href="/opportunities" />}
      >
        <IconLayoutKanban />
        Board
      </Button>
      <Button
        size="sm"
        variant={current === "list" ? "secondary" : "ghost"}
        aria-current={current === "list"}
        className={cn(current !== "list" && "text-muted-foreground")}
        render={<Link href="/opportunities?view=list" />}
      >
        <IconList />
        List
      </Button>
    </div>
  );
}
