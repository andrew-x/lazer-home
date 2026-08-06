"use client";

import { IconArchive, IconArrowBackUp } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { dismissTranscript } from "@/actions/drive/dismissTranscript";
import { getDismissedTranscripts } from "@/actions/drive/getDismissedTranscripts";
import { EmptyState } from "@/components/empty-state";
import { SearchFilter } from "@/components/form/search-filter";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatShortDate } from "@/lib/format/format";

/**
 * Everything this person dismissed, with one click to put it back.
 *
 * Dismissal is the only way the triage list clears, so it needs an undo that isn't
 * "remember what you clicked" — otherwise the safe move is never to dismiss anything,
 * and the list stops being usable. Restoring writes through the same
 * `dismissTranscript` action with `dismissed: false`.
 *
 * Loads **on open**, not on mount: most people never open this, and the read is a
 * query nobody should pay for on every dashboard load. Built from the vendored Dialog
 * primitives rather than `FormDialog`, which is the shell for forms — the same call
 * `TaskArchiveDialog` makes.
 *
 * Search is in-memory here, unlike the panel's: these rows are our own and already
 * all on the client, so there is no older data a server search could reach.
 */
export function TranscriptArchiveDialog({
  onRestored,
}: {
  onRestored: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const archive = useAction(getDismissedTranscripts);
  const { execute: loadArchive } = archive;

  useEffect(() => {
    if (open) loadArchive({});
  }, [open, loadArchive]);

  const restore = useAction(dismissTranscript, {
    onSuccess: () => {
      loadArchive({});
      onRestored();
      toast.success("Transcript restored to your triage list.");
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't restore that transcript."),
  });

  const rows = archive.result.data ?? [];
  const query = search.trim().toLowerCase();
  const visible = query
    ? rows.filter((row) => row.name.toLowerCase().includes(query))
    : rows;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline">
            <IconArchive className="size-4" />
            Dismissed
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dismissed transcripts</DialogTitle>
          <DialogDescription>
            Transcripts you marked as not relevant. Nothing was deleted — they
            are still in your Drive.
          </DialogDescription>
        </DialogHeader>

        <SearchFilter
          value={search}
          onChange={setSearch}
          placeholder="Search dismissed transcripts…"
        />

        {archive.isPending && rows.length === 0 ? (
          <EmptyState bordered>Loading…</EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState bordered>
            {query
              ? "Nothing dismissed matches that search."
              : "You have not dismissed any transcripts."}
          </EmptyState>
        ) : (
          <ul className="max-h-[50vh] overflow-y-auto rounded-md border px-3">
            {visible.map((row) => (
              <li
                key={row.fileId}
                className="flex items-center gap-3 border-b py-2 last:border-b-0"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{row.name}</span>
                  <span className="text-xs text-muted-foreground">
                    Dismissed {formatShortDate(new Date(row.dismissedAt))}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={restore.isPending}
                  onClick={() =>
                    restore.execute({
                      fileId: row.fileId,
                      fileName: row.name,
                      dismissed: false,
                    })
                  }
                >
                  <IconArrowBackUp className="size-4" />
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
