import type {
  HistoryCategory,
  HistoryEntry,
} from "@/actions/staff/getStaffHistory";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";

const CATEGORY_LABEL: Record<HistoryCategory, string> = {
  EMPLOYMENT: "Employment",
  ALLOCATION: "Allocation",
};

/**
 * A category-agnostic timeline of profile changes, newest first. Entries are
 * fetched server-side and passed in (the actions layer owns the read). It stays
 * presentational — a new history category needs only a `CATEGORY_LABEL` entry
 * here, with no other structural change (ADR 0011).
 */
export function HistoryTimeline({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No history yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry) => (
        <div key={entry.id} className="flex flex-col gap-1 border-l-2 pl-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {formatDate(entry.date)}
            </span>
            <Badge variant="secondary">{CATEGORY_LABEL[entry.category]}</Badge>
          </div>
          <span className="text-sm text-muted-foreground">{entry.summary}</span>
        </div>
      ))}
    </div>
  );
}
