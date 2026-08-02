import { cn } from "@/lib/core/utils";
import { PROJECT_HEALTH_MAX } from "@/lib/projects/project-health";

/**
 * A project's 1–10 delivery-health rating as a row of filled segments.
 *
 * The point is the *column*, not the cell: twenty health figures read as twenty
 * numbers you have to compare one at a time, while twenty bars read as a shape you
 * can sweep. Ten discrete segments rather than one proportional bar because the
 * scale is a ten-point integer, not a percentage.
 *
 * Monochrome, and deliberately so — [ADR 0059](../../../docs/decisions/0059-project-delivery-notes-and-list-health.md)
 * kept the "Low health" tag a neutral badge rather than a red one, and colouring the
 * bar here would quietly reverse that. Losses in the Margin column stay the only
 * coloured thing on the page. Plain `<div>`s, not SVG: `docs/ui.md` says to check
 * whether nesting and borders do the job before drawing, and here they do.
 *
 * `aria-hidden` because it is a redundant rendering — the adjacent figure carries
 * the value for assistive tech, and `HealthCell` gives the pair a text label.
 */
/** The rating each segment stands for, 1…max — built once, and a stable React key. */
const SEGMENTS = Array.from(
  { length: PROJECT_HEALTH_MAX },
  (_, index) => index + 1,
);

export function HealthBar({ value }: { value: number }) {
  return (
    <div aria-hidden className="flex items-center gap-px">
      {SEGMENTS.map((segment) => (
        <span
          key={segment}
          className={cn(
            "h-2.5 w-1 rounded-[1px]",
            segment <= value ? "bg-foreground" : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}
