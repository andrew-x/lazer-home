"use client";

import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { checkDriveFolderName } from "@/actions/drive/checkDriveFolderName";
import { createDriveFolder } from "@/actions/drive/createDriveFolder";
import { linkDriveFolder } from "@/actions/drive/linkDriveFolder";
import { searchDriveFolders } from "@/actions/drive/searchDriveFolders";
import { EntityCombobox } from "@/components/form/entity-combobox";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { FormDialog } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  buildDriveFolderName,
  DRIVE_FOLDER_NAME_MAX,
  DRIVE_PARENT_FOLDER_NAME,
  type DriveFolderKind,
} from "@/lib/drive/folder";

/** Per-kind copy. The only thing that differs between the two kinds. */
const COPY: Record<DriveFolderKind, { title: string; description: string }> = {
  sales: {
    title: "Sales folder",
    description:
      "Create this deal's folder in the Lazer Home shared drive, or link one that already exists.",
  },
  project: {
    title: "Project folder",
    description:
      "Create this project's folder in the Lazer Home shared drive, or link one that already exists.",
  },
};

/**
 * Create a folder for a record, or link an existing one — both in one dialog, the
 * same shape `SlackChannelDialog` uses.
 *
 * `forceMountOverlay` is required: the opportunity surface is a Sheet, and without
 * it the backdrop blur behind this dialog doesn't render.
 */
export function DriveFolderDialog({
  kind,
  recordId,
  sourceName,
  open,
  onOpenChange,
  onDone,
}: {
  kind: DriveFolderKind;
  recordId: string;
  sourceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const copy = COPY[kind];
  return (
    <FormDialog
      title={copy.title}
      description={copy.description}
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="sm:max-w-lg"
      forceMountOverlay
    >
      {({ close }) => (
        <DriveFolderForm
          kind={kind}
          recordId={recordId}
          sourceName={sourceName}
          close={close}
          onDone={onDone}
        />
      )}
    </FormDialog>
  );
}

function DriveFolderForm({
  kind,
  recordId,
  sourceName,
  close,
  onDone,
}: {
  kind: DriveFolderKind;
  recordId: string;
  sourceName: string;
  close: () => void;
  onDone?: () => void;
}) {
  const [existing, setExisting] = useState<EntityOption | null>(null);
  // Pre-filled from the record, then the person's to change. Held in local state
  // rather than react-hook-form: one text field whose only rule is "not blank",
  // which the disabled submit expresses and the action's own schema backstops, so
  // a resolver would add a dependency without adding a check.
  const [name, setName] = useState(() => buildDriveFolderName(sourceName));

  // `close()` before `onDone()` deliberately: the refresh may replace this
  // subtree, and closing first keeps the dialog from unmounting mid-animation.
  const finish = () => {
    close();
    onDone?.();
  };

  const create = useAction(createDriveFolder, { onSuccess: finish });
  const link = useAction(linkDriveFolder, { onSuccess: finish });

  const trimmedName = name.trim();

  // Check availability on open and as the name is edited. Debounced so typing
  // doesn't fire a Drive call per keystroke, and re-run on every change because a
  // blocked button the user cannot unblock by fixing the name would be a dead end.
  const check = useAction(checkDriveFolderName);
  const debouncedName = useDebouncedValue(trimmedName, 400);
  useEffect(() => {
    if (!debouncedName) return;
    check.execute({ kind, name: debouncedName });
  }, [debouncedName, kind, check.execute]);

  // Only trust the verdict when it describes the name currently in the box —
  // otherwise an in-flight answer for the previous name would block the new one.
  const checked = check.result.data;
  const verdict =
    check.isPending || debouncedName !== trimmedName ? null : (checked ?? null);
  const taken = verdict?.status === "taken" ? verdict : null;

  const canCreate =
    trimmedName.length > 0 && !create.isPending && taken === null;
  const serverError =
    create.result.serverError ?? link.result.serverError ?? null;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!canCreate) return;
        create.execute({ kind, recordId, name: trimmedName });
      }}
      className="flex flex-col gap-4"
    >
      <FormField label="Folder to create">
        <div className="flex items-center gap-2">
          {/* The path is a fixed addon, not part of the input: which parent a
              folder lands under is decided server-side from the record kind, so
              making it look editable would promise something we would then
              ignore. Only the last segment is the caller's. */}
          <InputGroup className="flex-1">
            <InputGroupAddon>
              <InputGroupText className="whitespace-nowrap">
                Lazer Home / {DRIVE_PARENT_FOLDER_NAME[kind]} /
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={DRIVE_FOLDER_NAME_MAX}
              placeholder="Folder name"
              aria-label="Folder name"
            />
          </InputGroup>
          <Button
            type="submit"
            disabled={!canCreate}
            loading={create.isPending}
          >
            Create
          </Button>
        </div>
        {taken ? (
          // A blocked button needs a way out, and the offered name is one click.
          // Deliberately a suggestion rather than something applied for you: the
          // folder that gets created is always one somebody actually chose.
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-destructive">
            <span>
              {DRIVE_PARENT_FOLDER_NAME[kind]} already has a folder called{" "}
              {trimmedName}
            </span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => setName(taken.suggestion)}
            >
              Use {taken.suggestion}
            </Button>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Renaming the record later will not rename the folder.
          </p>
        )}
      </FormField>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">
          or link an existing folder
        </span>
        <Separator className="flex-1" />
      </div>

      <FormField label="Existing folder">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <EntityCombobox
              value={existing}
              onChange={setExisting}
              searchAction={searchDriveFolders}
              placeholder="Search Lazer Home…"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!existing || link.isPending}
            loading={link.isPending}
            onClick={() => {
              if (!existing) return;
              link.execute({ kind, recordId, folderId: existing.id });
            }}
          >
            Link
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Any folder in the shared drive works — it does not need to follow the
          Sales or Projects naming.
        </p>
      </FormField>

      {/* Not `FormDialogFooter`: it always renders a submit button, and both of
          this dialog's actions now sit beside the field they act on — Create by
          the name, Link by the picker. That leaves the footer with only the way
          out, so all it needs is the error line and Cancel. */}
      {serverError ? (
        <p className="text-sm text-destructive">{serverError}</p>
      ) : null}
      <DialogFooter>
        <DialogClose
          render={
            <Button type="button" variant="outline">
              Cancel
            </Button>
          }
        />
      </DialogFooter>
    </form>
  );
}
