"use client";

import {
  IconBrandGoogleDrive,
  IconFolderPlus,
  IconUnlink,
} from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { unlinkDriveFolder } from "@/actions/drive/unlinkDriveFolder";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ExternalLink } from "@/components/external-link";
import { FormField } from "@/components/form/form-field";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import type { DriveFolderKind, DriveFolderRef } from "@/lib/drive/folder";
import { DriveFolderDialog } from "./drive-folder-dialog";

/**
 * One record's Drive folder slot — the single unit both surfaces use (the
 * opportunity drawer's sales folder, the project page's delivery folder).
 *
 * Sized for a detail page's meta rail: the linked state is a folder name and an
 * unlink button. Everything bulky lives in the dialog, and the folder's *contents*
 * live in the Files tab — this field is only about which folder is linked.
 *
 * Mirrors `SlackChannelField`, including its judgement call about the feature
 * flag: the setup button shows even when Drive isn't configured, because a
 * control you can reach plus a reason it won't work teaches more than an absent
 * control does. See docs/decisions/0067 and 0069.
 */
export function DriveFolderField({
  kind,
  recordId,
  sourceName,
  folder,
  label,
  canManage,
  enabled,
  onChanged,
}: {
  kind: DriveFolderKind;
  /**
   * The id of the record that OWNS the column — an opportunity for `sales`, a
   * project for `project`. Never the other one.
   */
  recordId: string;
  /** The record's name; the folder is named after it. */
  sourceName: string;
  folder: DriveFolderRef | null;
  label: string;
  canManage: boolean;
  /** False when the Drive integration isn't configured. */
  enabled: boolean;
  /**
   * Called after a successful write. Surfaces that refetch their own payload pass
   * their refresh here; ones that rely on `revalidatePath` can omit it.
   */
  onChanged?: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const changed = () => onChanged?.();

  const unlink = useAction(unlinkDriveFolder, {
    onSuccess: () => {
      setConfirmUnlink(false);
      // In-place action (not a dialog), so it confirms with a toast.
      toast.success("Drive folder unlinked.");
      changed();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't unlink the folder."),
  });

  // The only case with nothing to say: no folder, no ability to add one, and no
  // configuration that could produce one. Anyone who COULD set it up sees the
  // control regardless, so the person whose job it is to connect Drive is not the
  // one person certain never to learn the slot exists.
  //
  // An existing link always renders, configured or not: the folder URL is just a
  // URL, so dropping it because an env var went missing would lose information
  // for nothing. Unlinking still works too — it is app-side only.
  if (!enabled && !folder && !canManage) return null;

  return (
    <>
      <FormField
        label={label}
        labelAction={
          folder && canManage ? (
            <IconButton
              label={`Unlink ${label.toLowerCase()}`}
              onClick={() => setConfirmUnlink(true)}
            >
              <IconUnlink />
            </IconButton>
          ) : null
        }
      >
        <div data-slot="field-value" className="min-h-8 py-1 text-sm">
          {folder ? (
            <ExternalLink
              href={folder.url}
              className="flex items-center gap-1.5"
            >
              <IconBrandGoogleDrive className="size-4 shrink-0" />
              <span className="truncate">{folder.name}</span>
            </ExternalLink>
          ) : canManage ? (
            <div className="flex flex-col items-start gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDialogOpen(true)}
              >
                <IconFolderPlus />
                Create or link
              </Button>
              {!enabled ? (
                // The button stays live, so this is the only thing telling you
                // why it will fail. Not a tooltip on a disabled button: the fix
                // is an env var an admin sets, not anything actionable here.
                <span className="text-xs text-muted-foreground">
                  Google Drive isn't connected
                </span>
              ) : null}
            </div>
          ) : (
            // No folder and no ability to add one. Only reachable while the
            // integration is configured — the early return covers the other case.
            <span className="text-muted-foreground">Not linked</span>
          )}
        </div>
      </FormField>

      {canManage ? (
        <DriveFolderDialog
          kind={kind}
          recordId={recordId}
          sourceName={sourceName}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onDone={changed}
        />
      ) : null}

      {folder ? (
        <ConfirmDialog
          open={confirmUnlink}
          onOpenChange={setConfirmUnlink}
          title={`Unlink ${folder.name}?`}
          description="The folder stays in Drive with all its files — this only clears the link here."
          confirmLabel="Unlink"
          destructive
          loading={unlink.isPending}
          onConfirm={() => unlink.execute({ kind, recordId })}
        />
      ) : null}
    </>
  );
}
