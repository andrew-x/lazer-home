"use client";

import { IconAlertTriangle, IconFolderPlus } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { assignTranscript } from "@/actions/drive/assignTranscript";
import { searchTranscriptTargets } from "@/actions/drive/searchTranscriptTargets";
import { EntityCombobox } from "@/components/form/entity-combobox";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { SegmentedFilter } from "@/components/form/filters";
import { InlineNotice } from "@/components/inline-notice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DRIVE_FOLDER_KINDS, type DriveFolderKind } from "@/lib/drive/folder";
import { TRANSCRIPT_TARGET_LABELS } from "@/lib/drive/transcript";
import type { TranscriptView } from "@/lib/home/transcripts";

/**
 * Where a transcript should be filed: pick an opportunity or a project, then
 * confirm creating that record's Drive folder if it doesn't have one yet.
 *
 * Two steps rather than one, and the second is not a formality. `assignTranscript`
 * returns `needs-folder` without touching Drive when the record has no folder, so
 * this dialog is the only place a folder gets created — creating one is always
 * something the person read and agreed to, never a side effect of filing a file.
 *
 * `canAssign` is passed per kind rather than derived here, because the two
 * capabilities are disjoint: `sales` holds `crm.edit` only, `delivery-manager`
 * `projects.edit` only. A viewer who holds neither never sees the trigger at all
 * (the row hides it), and one who holds one of the two sees only that segment —
 * showing a disabled segment would advertise an action that can never succeed.
 */
export function TranscriptAssignDialog({
  transcript,
  kinds,
  open,
  onOpenChange,
  onAssigned,
}: {
  transcript: TranscriptView;
  /** The kinds this viewer may file to. Never empty — the row checks first. */
  kinds: readonly DriveFolderKind[];
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onAssigned: () => void;
}) {
  const [kind, setKind] = useState<DriveFolderKind>(kinds[0] ?? "project");
  const [selected, setSelected] = useState<EntityOption | null>(null);
  const [needsFolder, setNeedsFolder] = useState<{
    recordName: string;
    folderName: string;
  } | null>(null);

  const assign = useAction(assignTranscript, {
    onSuccess: ({ data }) => {
      if (data?.status === "needs-folder") {
        // Not an error — the record has no folder yet. Hold the answer and ask.
        setNeedsFolder({
          recordName: data.recordName,
          folderName: data.folderName,
        });
        return;
      }
      if (data?.status === "assigned") {
        toast.success(
          data.folderCreated
            ? `Folder created and transcript filed to ${selected?.name ?? "the record"}.`
            : `Transcript filed to ${selected?.name ?? "the record"}.`,
        );
        close();
        onAssigned();
      }
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't file that transcript."),
  });

  function close() {
    setSelected(null);
    setNeedsFolder(null);
    assign.reset();
    onOpenChange(false);
  }

  // `EntityCombobox` re-runs its search when `searchArgs` changes identity, so this
  // must be stable across renders or every keystroke would re-search twice.
  const searchArgs = useMemo(() => ({ kind }), [kind]);

  const kindLabel = TRANSCRIPT_TARGET_LABELS[kind].toLowerCase();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>File this transcript</DialogTitle>
          <DialogDescription>
            A copy goes into the record's Drive folder, under Transcripts. The
            original stays in your own Drive.
          </DialogDescription>
        </DialogHeader>

        <p className="truncate rounded-md border bg-muted/40 px-3 py-2 text-sm">
          {transcript.name}
        </p>

        {needsFolder ? (
          <InlineNotice icon={IconFolderPlus}>
            <div className="flex flex-col gap-1">
              <span>
                <span className="font-medium">{needsFolder.recordName}</span>{" "}
                has no Drive folder yet. Filing this will create one called{" "}
                <span className="font-medium">{needsFolder.folderName}</span> in
                the Lazer Home shared drive.
              </span>
              <span className="text-muted-foreground">
                Renaming the record later will not rename the folder.
              </span>
            </div>
          </InlineNotice>
        ) : (
          <div className="flex flex-col gap-3">
            {kinds.length > 1 ? (
              <SegmentedFilter
                label="File to"
                value={kind}
                options={DRIVE_FOLDER_KINDS.filter((k) => kinds.includes(k))}
                labels={TRANSCRIPT_TARGET_LABELS}
                // No "All" segment: a transcript is filed to one record, so there
                // is no such thing as filing it to every kind at once.
                includeAll={false}
                onChange={(next) => {
                  setKind(next as DriveFolderKind);
                  setSelected(null);
                }}
              />
            ) : null}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">
                {TRANSCRIPT_TARGET_LABELS[kind]}
              </span>
              <EntityCombobox
                value={selected}
                onChange={setSelected}
                searchAction={searchTranscriptTargets}
                searchArgs={searchArgs}
                placeholder={`Search ${kindLabel}s…`}
              />
            </div>
          </div>
        )}

        {assign.result.serverError ? (
          <InlineNotice icon={IconAlertTriangle}>
            {assign.result.serverError}
          </InlineNotice>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!selected || assign.isPending}
            onClick={() => {
              if (!selected) return;
              assign.execute({
                kind,
                recordId: selected.id,
                fileId: transcript.fileId,
                // The second pass carries the confirmation. Sending it only once
                // the notice has been shown is what makes the notice load-bearing
                // rather than decorative.
                confirmCreateFolder: needsFolder !== null,
              });
            }}
          >
            {needsFolder ? "Create folder and file" : "File transcript"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
