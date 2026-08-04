"use client";

import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { createDriveFolder } from "@/actions/drive/createDriveFolder";
import { linkDriveFolder } from "@/actions/drive/linkDriveFolder";
import { searchDriveFolders } from "@/actions/drive/searchDriveFolders";
import { EntityCombobox } from "@/components/form/entity-combobox";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  buildDriveFolderName,
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

  // `close()` before `onDone()` deliberately: the refresh may replace this
  // subtree, and closing first keeps the dialog from unmounting mid-animation.
  const finish = () => {
    close();
    onDone?.();
  };

  const create = useAction(createDriveFolder, { onSuccess: finish });
  const link = useAction(linkDriveFolder, { onSuccess: finish });

  const folderName = buildDriveFolderName(sourceName);
  const path = `Lazer Home / ${DRIVE_PARENT_FOLDER_NAME[kind]} / ${folderName}`;

  // No react-hook-form: there are no registered inputs to validate. The name is
  // derived from the record and shown read-only, and the picker owns its own
  // state — so a resolver would have nothing to resolve.
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        create.execute({ kind, recordId });
      }}
      className="flex flex-col gap-4"
    >
      <FormField label="Folder to create">
        <Input
          readOnly
          aria-readonly
          value={path}
          className="bg-muted/40"
          tabIndex={-1}
        />
        <p className="text-xs text-muted-foreground">
          Named after this record. Renaming the record later will not rename the
          folder.
        </p>
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

      <FormDialogFooter
        serverError={create.result.serverError ?? link.result.serverError}
        submitLabel="Create folder"
        loading={create.isPending}
      />
    </form>
  );
}
