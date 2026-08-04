"use client";

import {
  IconAlertTriangle,
  IconBrandGoogleDrive,
  IconChevronRight,
  IconFile,
  IconFolder,
  IconUpload,
} from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { copyDriveFile } from "@/actions/drive/copyDriveFile";
import type {
  DriveEntry,
  DriveFolderContents,
} from "@/actions/drive/loadDriveFolderContents";
import { loadDriveFolderContents } from "@/actions/drive/loadDriveFolderContents";
import { DetailTable } from "@/components/crm/detail-parts";
import { EmptyState } from "@/components/empty-state";
import { ExternalLink } from "@/components/external-link";
import { InlineNotice } from "@/components/inline-notice";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import type { DriveFolderRef } from "@/lib/drive/folder";
import { driveFolderUrl } from "@/lib/drive/folder";
import { formatShortDate } from "@/lib/format/format";
import { DriveReconnectButton } from "./drive-reconnect-button";
import { useGooglePicker } from "./use-google-picker";

/** One level in the trail, so the panel can walk back up without an API call. */
type Crumb = { id: string; name: string };

/**
 * The Files tab body: browse a record's Drive folder and add files to it. Used
 * unchanged by both surfaces (the project page and the opportunity drawer).
 *
 * Loads its own contents on mount rather than being handed them as props, which
 * is why neither surface pays for a Drive round-trip until someone opens the tab
 * — the same reasoning as `OpportunityProjectPlan`'s lazy plan load. It also means
 * one component serves both, instead of one SSR path and one client path.
 *
 * Navigation keeps its own breadcrumb: descending pushes, a crumb click truncates.
 * Deriving the trail server-side would mean walking `parents` upward, one API call
 * per level, on every single load — for information the click already told us.
 */
export function DriveFilesPanel({
  folder,
  canManage,
  enabled,
}: {
  /** The linked folder, or null when this record has none yet. */
  folder: DriveFolderRef | null;
  /** Whether this viewer could link a folder (drives the empty-state copy only). */
  canManage: boolean;
  /** False when the Drive integration isn't configured. */
  enabled: boolean;
}) {
  const [trail, setTrail] = useState<Crumb[]>([]);
  const load = useAction(loadDriveFolderContents);

  // The folder currently being shown: the deepest crumb, or the linked root.
  const current =
    trail.at(-1) ?? (folder ? { id: folder.id, name: folder.name } : null);
  const currentId = current?.id ?? null;

  const refresh = useCallback(() => {
    if (!currentId) return;
    load.execute({ folderId: currentId });
  }, [currentId, load.execute]);

  useEffect(() => {
    if (!currentId) return;
    load.execute({ folderId: currentId });
    // `load.execute` is stable; re-running on folder change is the whole point.
  }, [currentId, load.execute]);

  // `executeAsync`, awaited one file at a time, rather than firing `execute` in a
  // loop. `useAction` keeps a SINGLE slot of result state, so N synchronous
  // `execute` calls supersede one another — the hook reports only the last, and
  // each completion would fire its own toast and its own refresh. Awaiting in
  // sequence gives one outcome to report and one reload at the end, and keeps a
  // 20-file selection from opening 20 parallel Drive copies.
  const copy = useAction(copyDriveFile);
  const [copying, setCopying] = useState(false);

  const copyPickedFiles = async (fileIds: string[]) => {
    if (!currentId) return;
    setCopying(true);
    let copied = 0;
    let firstError: string | null = null;
    try {
      for (const fileId of fileIds) {
        const result = await copy.executeAsync({
          folderId: currentId,
          fileId,
        });
        if (result?.data) copied += 1;
        else firstError ??= result?.serverError ?? "Couldn't add that file.";
      }
    } finally {
      setCopying(false);
    }

    // Report the partial outcome honestly: with a multi-file selection some can
    // succeed and some fail (a file whose owner disabled copying, say), and
    // "couldn't add that file" alone would hide the ones that worked.
    if (copied > 0) {
      toast.success(
        copied === 1 ? "File added to the folder." : `${copied} files added.`,
      );
      refresh();
    }
    if (firstError) toast.error(firstError);
  };

  const picker = useGooglePicker({
    folderId: currentId ?? "",
    onUploaded: () => {
      // Google wrote the file directly, so nothing here knows about it until we
      // ask again. Without this the upload appears to have done nothing.
      toast.success("Upload complete.");
      refresh();
    },
    onPicked: copyPickedFiles,
    onError: (message) => toast.error(message),
  });

  if (!folder) {
    return (
      <EmptyState bordered>
        {enabled
          ? canManage
            ? "No folder linked yet. Use Create or link in the sidebar to set one up."
            : "No folder linked yet."
          : "Google Drive isn't connected."}
      </EmptyState>
    );
  }

  const result = load.result.data;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Breadcrumb
          root={{ id: folder.id, name: folder.name }}
          trail={trail}
          onNavigate={setTrail}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={picker.isOpening || copying || !currentId}
            onClick={() => picker.open("upload")}
          >
            <IconUpload />
            Upload
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={picker.isOpening || copying || !currentId}
            onClick={() => picker.open("pick")}
          >
            <IconBrandGoogleDrive />
            From my Drive
          </Button>
        </div>
      </div>

      {currentId ? (
        <p className="text-xs text-muted-foreground">
          <ExternalLink href={driveFolderUrl(currentId)}>
            Open this folder in Drive
          </ExternalLink>
        </p>
      ) : null}

      <PanelBody
        result={result}
        pending={load.isPending}
        onEnterFolder={(entry) =>
          setTrail((previous) => [
            ...previous,
            { id: entry.id, name: entry.name },
          ])
        }
      />
    </div>
  );
}

function PanelBody({
  result,
  pending,
  onEnterFolder,
}: {
  result: DriveFolderContents | undefined;
  pending: boolean;
  onEnterFolder: (entry: DriveEntry) => void;
}) {
  // Only the very first load has nothing to show; later loads keep the previous
  // listing on screen so navigating doesn't flash an empty table.
  if (pending && !result) {
    return <EmptyState bordered>Loading files…</EmptyState>;
  }

  if (!result) {
    return <EmptyState bordered>Couldn't load this folder.</EmptyState>;
  }

  // Each failure state gets its own words, because each has a different person
  // who can fix it — see the envelope's doc comment.
  if (result.status === "reconnect") {
    return (
      <InlineNotice icon={IconAlertTriangle}>
        <div className="flex flex-col items-start gap-2">
          <span>
            Your Google account needs to grant Drive access before files show up
            here.
          </span>
          <DriveReconnectButton />
        </div>
      </InlineNotice>
    );
  }

  if (result.status === "no-access") {
    return (
      <InlineNotice icon={IconAlertTriangle}>
        You do not have access to this folder in Google Drive. Ask to be added
        to the Lazer Home shared drive, or check whether the folder was deleted.
      </InlineNotice>
    );
  }

  if (result.status === "not-configured") {
    return <EmptyState bordered>Google Drive isn't connected.</EmptyState>;
  }

  if (result.status === "unavailable") {
    return (
      <InlineNotice icon={IconAlertTriangle}>
        Google Drive did not respond. Try again in a moment.
      </InlineNotice>
    );
  }

  if (result.entries.length === 0) {
    return <EmptyState bordered>This folder is empty.</EmptyState>;
  }

  return (
    <>
      {result.truncated ? (
        <InlineNotice icon={IconAlertTriangle} className="mb-3">
          This folder holds more files than we can list here. Open it in Drive
          to see all of them.
        </InlineNotice>
      ) : null}
      <DetailTable headers={["Name", "Modified", "Modified by"]}>
        {result.entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell>
              {entry.isFolder ? (
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-left text-primary underline-offset-4 hover:underline"
                  onClick={() => onEnterFolder(entry)}
                >
                  <IconFolder className="size-4 shrink-0" />
                  <span className="truncate">{entry.name}</span>
                </button>
              ) : entry.webViewLink ? (
                <ExternalLink
                  href={entry.webViewLink}
                  className="flex items-center gap-1.5"
                >
                  <IconFile className="size-4 shrink-0" />
                  <span className="truncate">{entry.name}</span>
                </ExternalLink>
              ) : (
                <span className="flex items-center gap-1.5">
                  <IconFile className="size-4 shrink-0" />
                  <span className="truncate">{entry.name}</span>
                </span>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {entry.modifiedTime
                ? formatShortDate(new Date(entry.modifiedTime))
                : "—"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {entry.modifiedBy ?? "—"}
            </TableCell>
          </TableRow>
        ))}
      </DetailTable>
    </>
  );
}

function Breadcrumb({
  root,
  trail,
  onNavigate,
}: {
  root: Crumb;
  trail: Crumb[];
  onNavigate: (trail: Crumb[]) => void;
}) {
  return (
    <nav
      aria-label="Folder path"
      className="flex min-w-0 flex-wrap items-center gap-1 text-sm"
    >
      <Crumbtrail
        name={root.name}
        isLast={trail.length === 0}
        onClick={() => onNavigate([])}
      />
      {trail.map((crumb, index) => (
        <span key={crumb.id} className="flex items-center gap-1">
          <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          <Crumbtrail
            name={crumb.name}
            isLast={index === trail.length - 1}
            onClick={() => onNavigate(trail.slice(0, index + 1))}
          />
        </span>
      ))}
    </nav>
  );
}

function Crumbtrail({
  name,
  isLast,
  onClick,
}: {
  name: string;
  isLast: boolean;
  onClick: () => void;
}) {
  if (isLast) {
    return <span className="truncate font-medium">{name}</span>;
  }
  return (
    <button
      type="button"
      className="truncate text-muted-foreground underline-offset-4 hover:underline"
      onClick={onClick}
    >
      {name}
    </button>
  );
}
