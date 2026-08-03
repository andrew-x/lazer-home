import type { ReactNode } from "react";
import { cn } from "@/lib/core/utils";

/**
 * A height-capped, scrolling list body for a home-dashboard card.
 *
 * These lists are **unbounded** — how many people are on the bench, away, or lent
 * out is whatever the org happens to be doing that week. Each panel used to cut its
 * list to a handful of rows and print a "N more" line, which kept the cards tidy at
 * the cost of making the tail unreachable from the dashboard: the eleventh person
 * freeing up next week is exactly as worth seeing as the first.
 *
 * Capping the height instead keeps the cards a predictable size while every record
 * stays reachable. The caps are deliberately set to a *fraction* of a row, so a
 * half-visible row at the fold is the scroll affordance — cleaner than a gradient,
 * and it can't lie about whether there's more.
 *
 * The negative right margin parks the scrollbar in the card's own gutter, so rows
 * don't shift sideways when one appears. Pass `className` to override the cap
 * (`max-h-*`) or the row gap for a denser or taller list.
 */
export function ScrollList({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "-mr-2 flex max-h-72 flex-col gap-1 overflow-y-auto pr-2",
        className,
      )}
    >
      {children}
    </div>
  );
}
