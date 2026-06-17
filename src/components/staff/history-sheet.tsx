"use client";

import { IconHistory } from "@tabler/icons-react";
import type {
  HistoryCategory,
  HistoryEntry,
} from "@/actions/staff/getStaffHistory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatDate } from "@/lib/format";

const CATEGORY_LABEL: Record<HistoryCategory, string> = {
  EMPLOYMENT: "Employment",
  COMPENSATION: "Compensation",
  ALLOCATION: "Allocation",
};

/**
 * "History" button that opens a right-side drawer listing every change to the
 * profile, newest first — a category-agnostic timeline. Entries are fetched
 * server-side and passed in (the actions layer owns the read); this stays a
 * presentational client component, so new categories need no change here.
 */
export function HistorySheet({ entries }: { entries: HistoryEntry[] }) {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm">
            <IconHistory />
            History
          </Button>
        }
      />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>History</SheetTitle>
          <SheetDescription>
            Changes to your profile over time, newest first.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-4">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No history yet.</p>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-col gap-1 border-l-2 pl-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {formatDate(entry.date)}
                  </span>
                  <Badge variant="secondary">
                    {CATEGORY_LABEL[entry.category]}
                  </Badge>
                </div>
                <span className="text-sm text-muted-foreground">
                  {entry.summary}
                </span>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
