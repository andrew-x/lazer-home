"use client";

import { IconExternalLink, IconFileText, IconX } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { dismissTranscript } from "@/actions/drive/dismissTranscript";
import { ExternalLink } from "@/components/external-link";
import { IconButton } from "@/components/icon-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DriveFolderKind } from "@/lib/drive/folder";
import { formatTimeOfDay } from "@/lib/format/format";
import type { TranscriptView } from "@/lib/home/transcripts";
import { TranscriptAssignDialog } from "./transcript-assign-dialog";

/**
 * One transcript in the triage list: its title, the time of the meeting, where it
 * has already been filed, and the controls to file or dismiss it.
 *
 * Each row owns its **own** `useAction` for dismissal, deliberately — a list-wide
 * hook keeps one result slot, so touching a second row would swallow the first
 * row's error. Same reasoning as `MyTaskRow`.
 *
 * A filed transcript **stays in the list**, badged with where it went, rather than
 * disappearing: one call about a deal that became a project legitimately belongs to
 * both, and the badge is the only place that history is visible.
 */
export function TranscriptRow({
  transcript,
  assignableKinds,
  onChanged,
}: {
  transcript: TranscriptView;
  /** Kinds this viewer may file to. Empty means no assign control at all. */
  assignableKinds: readonly DriveFolderKind[];
  onChanged: () => void;
}) {
  const [assignOpen, setAssignOpen] = useState(false);

  const dismiss = useAction(dismissTranscript, {
    onSuccess: () => onChanged(),
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't dismiss that transcript."),
  });

  // Dismissal is one-way *from here*: the fold drops dismissed transcripts, so a
  // successful dismiss reloads this row out of existence. Restoring lives in the
  // archive dialog, which is the only surface that can see a dismissed row at all —
  // so this component deliberately has no restore branch. The strike-through is the
  // in-flight state, not a toggled one.
  const leaving = dismiss.isPending;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b py-2 last:border-b-0">
      <IconFileText className="size-4 shrink-0 text-muted-foreground" />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center gap-2">
          {transcript.webViewLink ? (
            <ExternalLink
              href={transcript.webViewLink}
              className={leaving ? "truncate line-through" : "truncate"}
            >
              {transcript.name}
            </ExternalLink>
          ) : (
            <span className={leaving ? "truncate line-through" : "truncate"}>
              {transcript.name}
            </span>
          )}
        </div>
        {/* Time only — the day is on the group header this row sits under, so
            repeating the date here would be noise. The time is what distinguishes
            the three meetings someone had on the same afternoon. */}
        {transcript.createdAt ? (
          <span className="text-xs text-muted-foreground">
            {formatTimeOfDay(new Date(transcript.createdAt))}
          </span>
        ) : null}
      </div>

      {transcript.assignments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {transcript.assignments.map((assignment) => (
            <Badge
              key={`${assignment.kind}-${assignment.recordId}`}
              variant="secondary"
              className="gap-1"
            >
              {assignment.recordName}
              {assignment.copyUrl ? (
                <ExternalLink
                  href={assignment.copyUrl}
                  aria-label="Open the copy"
                >
                  <IconExternalLink className="size-3" />
                </ExternalLink>
              ) : null}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="flex shrink-0 items-center gap-1">
        {assignableKinds.length > 0 && !leaving ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAssignOpen(true)}
          >
            File
          </Button>
        ) : null}

        <IconButton
          label="Not relevant"
          disabled={leaving}
          onClick={() =>
            dismiss.execute({
              fileId: transcript.fileId,
              fileName: transcript.name,
              dismissed: true,
            })
          }
        >
          <IconX className="size-4" />
        </IconButton>
      </div>

      {assignOpen && assignableKinds.length > 0 ? (
        <TranscriptAssignDialog
          transcript={transcript}
          kinds={assignableKinds}
          open={assignOpen}
          onOpenChange={setAssignOpen}
          onAssigned={onChanged}
        />
      ) : null}
    </li>
  );
}
