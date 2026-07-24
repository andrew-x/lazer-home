"use client";

import { IconCheck, IconLoader2 } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useRef, useState } from "react";
import { updateStaffAllocationNotes } from "@/actions/staff/updateStaffAllocationNotes";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const DEBOUNCE_MS = 600;

/**
 * Inline, debounced-autosave editor for one staff member's allocation notes —
 * the planner's manager-only Notes column. Typing settles for `DEBOUNCE_MS`,
 * then persists via `updateStaffAllocationNotes`, with a subtle inline
 * Saving…/Saved/error status. The textarea grows vertically with content
 * (`field-sizing-content`) but is width-bounded by its cell.
 *
 * Single field, so it skips the queued drain engine of `use-response-autosave`:
 * it tracks the last persisted value (`savedValue`, trimmed to match the
 * server's stored form) and the in-flight value (`pendingRef`) to avoid saving
 * on mount, re-saving an edit that lands back on the saved text, or firing a
 * duplicate save for a value already in flight.
 */
export function AllocationNoteCell({
  staffId,
  initialNotes,
}: {
  staffId: string;
  initialNotes: string | null;
}) {
  const [value, setValue] = useState(initialNotes ?? "");
  const [savedValue, setSavedValue] = useState((initialNotes ?? "").trim());
  const debounced = useDebouncedValue(value, DEBOUNCE_MS);
  const pendingRef = useRef<string | null>(null);

  const { execute, isPending, result } = useAction(updateStaffAllocationNotes, {
    onSuccess: () => {
      if (pendingRef.current !== null) setSavedValue(pendingRef.current);
    },
  });

  useEffect(() => {
    const next = debounced.trim();
    // Nothing to do if we've already saved (or are saving) exactly this text.
    if (next === savedValue || next === pendingRef.current) return;
    pendingRef.current = next;
    execute({ staffId, allocationNotes: debounced });
  }, [debounced, savedValue, staffId, execute]);

  const error = Boolean(result.serverError);
  const dirty = value.trim() !== savedValue;
  // "Saved" only after a save actually landed this session and the field still
  // matches it — never on an untouched row at mount.
  const justSaved = !dirty && !isPending && !error && Boolean(result.data?.ok);

  return (
    <div className="flex flex-col gap-1">
      <Textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label="Allocation note"
        aria-invalid={error}
        rows={1}
        className="min-h-8 resize-none px-2 py-1 text-xs"
      />
      <NoteStatus isPending={isPending} error={error} justSaved={justSaved} />
    </div>
  );
}

/** Compact autosave status beneath the note field (never a toast). */
function NoteStatus({
  isPending,
  error,
  justSaved,
}: {
  isPending: boolean;
  error: boolean;
  justSaved: boolean;
}) {
  if (isPending) {
    return (
      <span className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
        <IconLoader2 className="size-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (error) {
    return (
      <span className="text-[0.6875rem] text-destructive">
        Couldn't save — edit to retry.
      </span>
    );
  }
  if (justSaved) {
    return (
      <span className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
        <IconCheck className="size-3 text-primary" />
        Saved
      </span>
    );
  }
  return null;
}
