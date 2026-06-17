"use client";

import { useState } from "react";
import type { PtoSpan } from "@/actions/staff/getStaffPto";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, humanizeEnum } from "@/lib/format";

function formatRange(span: PtoSpan): string {
  return span.startDate === span.endDate
    ? formatDate(span.startDate)
    : `${formatDate(span.startDate)} – ${formatDate(span.endDate)}`;
}

/**
 * A titled list of leave spans. When `collapseAfter` is set and there are more
 * spans than that, only the first `collapseAfter` show until the reader expands
 * — used to keep a long "Past" history from dominating the page height.
 */
export function PtoList({
  title,
  spans,
  collapseAfter,
}: {
  title: string;
  spans: PtoSpan[];
  collapseAfter?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const canCollapse = collapseAfter != null && spans.length > collapseAfter;
  const visible =
    canCollapse && !expanded ? spans.slice(0, collapseAfter) : spans;
  const hiddenCount = spans.length - visible.length;

  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="flex flex-col divide-y">
        {visible.map((span) => (
          <li
            key={span.id}
            className="flex items-center justify-between gap-4 py-2"
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium">{formatRange(span)}</span>
              <span className="text-sm text-muted-foreground">
                {humanizeEnum(span.type)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {span.isPending ? (
                <Badge variant="secondary">Pending</Badge>
              ) : null}
              <span className="text-sm text-muted-foreground">
                {span.workingDays} working{" "}
                {span.workingDays === 1 ? "day" : "days"}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {canCollapse ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : `Show ${hiddenCount} more`}
        </Button>
      ) : null}
    </div>
  );
}
