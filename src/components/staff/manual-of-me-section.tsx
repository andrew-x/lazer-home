import type { ManualOfMeEntry } from "@/actions/responses/getManualOfMe";

/**
 * Read view of a person's Manual of Me, inside the profile card. Shows only the
 * questions they've answered (title + answer); unanswered ones are omitted to
 * keep the card focused. Falls back to a muted empty state when nothing's filled
 * in yet. The guided editor (`/staff/[id]/manual-of-me`) handles writing.
 */
export function ManualOfMeSection({ entries }: { entries: ManualOfMeEntry[] }) {
  const answered = entries.filter((entry) => entry.textResponse !== null);

  if (answered.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing shared yet — a few notes here help the team work with you well.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {answered.map((entry) => (
        <div key={entry.id} className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{entry.title}</h3>
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
            {entry.textResponse}
          </p>
        </div>
      ))}
    </div>
  );
}
