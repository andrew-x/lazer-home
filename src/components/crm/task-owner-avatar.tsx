"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/core/utils";
import { initialsFor } from "@/lib/format/format";

/**
 * A task's owner as a small initials disc, named in a tooltip — the most compact
 * way to carry "whose next step is this" inside a table cell. Unassigned tasks
 * get an empty dashed disc rather than nothing, so the column still lines up and
 * the gap reads as "nobody owns this".
 *
 * Sized off the default avatar (not `size="sm"`) because the variant's
 * `data-[size=sm]:size-6` would out-specify a plain `size-5` override.
 */
export function TaskOwnerAvatar({ name }: { name: string | null }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Avatar
            className={cn(
              "size-5 cursor-default",
              !name && "after:border-dashed",
            )}
          >
            <AvatarFallback className="text-[10px]">
              {name ? initialsFor(name, "") : ""}
            </AvatarFallback>
          </Avatar>
        }
      />
      <TooltipContent side="top">{name ?? "Unassigned"}</TooltipContent>
    </Tooltip>
  );
}
