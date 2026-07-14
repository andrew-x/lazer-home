"use client";

import { IconCalendar, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDate, formatIsoDate, parseIsoDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A single-date picker bound to a "YYYY-MM-DD" string (or null when cleared).
 * Composes the shadcn date-picker recipe on the project's Base UI primitives.
 */
export function DatePicker({
  id,
  value,
  onChange,
  placeholder = "Pick a date",
  className,
}: {
  id?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  /** Applied to the root; pass `w-full` to fill the field slot. The trigger
   * grows to fill, so it stretches when the root is full-width and stays
   * content-sized otherwise. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              variant="outline"
              className={cn(
                "flex-1 justify-start gap-2 font-normal",
                !value && "text-muted-foreground",
              )}
            >
              <IconCalendar className="size-4" />
              {value ? formatDate(value) : placeholder}
            </Button>
          }
        />
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value ? parseIsoDate(value) : undefined}
            onSelect={(date) => {
              onChange(date ? formatIsoDate(date) : null);
              setOpen(false);
            }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Clear date"
          onClick={() => onChange(null)}
        >
          <IconX className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
