"use client";

import { IconAlertTriangle, IconBrandGoogleDrive } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getTranscriptTriage } from "@/actions/drive/getTranscriptTriage";
import { rescanTranscriptFolders } from "@/actions/drive/rescanTranscriptFolders";
import { searchTranscripts } from "@/actions/drive/searchTranscripts";
import type { TranscriptTriage } from "@/actions/drive/transcriptTriage";
import { DriveReconnectButton } from "@/components/drive/drive-reconnect-button";
import { EmptyState } from "@/components/empty-state";
import { SearchFilter } from "@/components/form/search-filter";
import { InlineNotice } from "@/components/inline-notice";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { DriveFolderKind } from "@/lib/drive/folder";
import {
  TRANSCRIPT_FOLDER_NAMES,
  TRIAGE_WINDOW_DAYS,
} from "@/lib/drive/transcript";
import { groupTranscriptsByDay } from "@/lib/home/transcripts";
import { ScrollList } from "./scroll-list";
import { TranscriptArchiveDialog } from "./transcript-archive-dialog";
import { TranscriptRow } from "./transcript-row";

/**
 * The Triage widget: meeting transcripts sitting in your own Google Drive, and one
 * click to file each into the opportunity or project it belongs to.
 *
 * ## Three things about this component that are decisions, not defaults
 *
 * **It loads its own data on mount** rather than being handed props from the page.
 * ADR 0071 §11 kept both existing Drive surfaces off the render path, and `/` is the
 * worst place in the app to spend a Drive round-trip: every signed-in person loads
 * it, and Drive reads can never be cached (§4). So the dashboard renders without
 * waiting for Google and this panel fills in — the `DriveFilesPanel` idiom.
 *
 * **Search goes to the server, unlike the task list beside it**, which filters an
 * in-memory array. The difference is where the data is: transcripts live in Drive
 * and this panel only ever holds one window of them, so filtering that window would
 * make a search for a two-month-old meeting return nothing — indistinguishable from
 * "it doesn't exist". Search therefore covers **all time**, and the caption says so.
 *
 * **The window is a ladder, not a number.** "Show more" walks
 * `TRIAGE_WINDOW_DAYS` and re-queries, because the previous window never held the
 * older rows. Each rung names its own span, per ADR 0063's rule that every figure on
 * this page states its window — this block is point-in-time inside a year-to-date
 * band, the same shape ADR 0065 established for the task list.
 */
export function TranscriptTriagePanel({
  assignableKinds,
  nowMs,
}: {
  /**
   * Kinds this viewer may file to, resolved on the server from `crm.edit` /
   * `projects.edit`. Empty for an ordinary `user`, who can still see and dismiss
   * their transcripts — see ADR 0072.
   */
  assignableKinds: readonly DriveFolderKind[];
  /**
   * Server-supplied "now", which resolves the "Today" / "Yesterday" day headers.
   * Passed in rather than read from the clock so grouping stays a pure function of
   * its inputs; the accepted cost is that a tab left open across midnight keeps
   * yesterday's headers until something re-renders it.
   */
  nowMs: number;
}) {
  const [windowIndex, setWindowIndex] = useState(0);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const searching = debouncedSearch.trim() !== "";

  const days = TRIAGE_WINDOW_DAYS[windowIndex];
  const list = useAction(getTranscriptTriage);
  const find = useAction(searchTranscripts);

  // Destructured so the deps below name the stable `execute` functions rather than
  // the hook objects, whose identity changes with their own results — depending on
  // those would re-fire the load on every response it produced.
  const { execute: executeList } = list;
  const { execute: executeFind } = find;

  const reload = useCallback(() => {
    if (searching) {
      executeFind({ query: debouncedSearch.trim() });
    } else {
      executeList({ days });
    }
  }, [searching, debouncedSearch, days, executeFind, executeList]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Automatic discovery only fires when nothing is stored, so a folder created after
  // someone's first visit is otherwise invisible forever. Rescanning is additive and
  // reloads the listing rather than returning one.
  const rescan = useAction(rescanTranscriptFolders, {
    onSuccess: ({ data }) => {
      reload();
      if (data?.status === "no-folders") {
        toast.info("Still no transcript folders in your Drive.");
      } else if (data?.status === "ok") {
        toast.success(
          `Reading from ${data.folderNames.length} ${
            data.folderNames.length === 1 ? "folder" : "folders"
          }.`,
        );
      }
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't check your Drive."),
  });

  const result = searching ? find.result.data : list.result.data;
  const pending = searching ? find.isPending : list.isPending;
  const canShowMore = !searching && windowIndex < TRIAGE_WINDOW_DAYS.length - 1;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="font-heading text-base font-semibold tracking-tight">
          Triage
        </h3>
        <p className="text-sm text-muted-foreground">
          {searching
            ? "Transcripts in your Drive matching your search — across all time."
            : `Meeting transcripts in your Drive from the last ${days} days. File one against a deal or a project to copy it into that record's Drive folder.`}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <SearchFilter
          value={search}
          onChange={setSearch}
          placeholder="Search transcript names…"
        />
        {canShowMore ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setWindowIndex((current) => current + 1)}
          >
            Show last {TRIAGE_WINDOW_DAYS[windowIndex + 1]} days
          </Button>
        ) : null}
        <TranscriptArchiveDialog onRestored={reload} />
      </div>

      <PanelBody
        result={result}
        pending={pending}
        searching={searching}
        assignableKinds={assignableKinds}
        nowMs={nowMs}
        onChanged={reload}
        onRescan={() => rescan.execute({})}
        rescanning={rescan.isPending}
      />

      {/* Names the folders we read from, and that is not decoration. Discovery is
          silent by decision (ADR 0072) — nobody is asked before we look — so saying
          which folders were searched is the only thing on screen that discloses it,
          and it doubles as the answer to "why isn't my transcript here?". */}
      {result?.status === "ok" && result.folderNames.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Reading from your {result.folderNames.join(", ")}{" "}
          {result.folderNames.length === 1 ? "folder" : "folders"} in Google
          Drive. Originals are never moved or changed.{" "}
          <button
            type="button"
            className="underline underline-offset-4 disabled:opacity-60"
            disabled={rescan.isPending}
            onClick={() => rescan.execute({})}
          >
            Check for new folders
          </button>
        </p>
      ) : null}
    </section>
  );
}

function PanelBody({
  result,
  pending,
  searching,
  assignableKinds,
  nowMs,
  onChanged,
  onRescan,
  rescanning,
}: {
  result: TranscriptTriage | undefined;
  pending: boolean;
  searching: boolean;
  assignableKinds: readonly DriveFolderKind[];
  nowMs: number;
  onChanged: () => void;
  onRescan: () => void;
  rescanning: boolean;
}) {
  // Only the first load has nothing to show; later loads keep the previous list on
  // screen so widening the window doesn't flash an empty panel.
  if (pending && !result) {
    return <EmptyState bordered>Looking for transcripts…</EmptyState>;
  }

  if (!result) {
    return <EmptyState bordered>Couldn't load your transcripts.</EmptyState>;
  }

  // Each failure state gets its own words, because each has a different person who
  // can fix it — see the envelope's doc comment.
  if (result.status === "reconnect") {
    return (
      <InlineNotice icon={IconAlertTriangle}>
        <div className="flex flex-col items-start gap-2">
          <span>
            Your Google account needs to grant Drive access before your
            transcripts show up here.
          </span>
          <DriveReconnectButton />
        </div>
      </InlineNotice>
    );
  }

  if (result.status === "no-folders") {
    // Told which folders we looked in, deliberately: the alternative is someone
    // whose transcripts sit in a differently-named folder concluding the feature
    // is broken, with nothing on screen to suggest otherwise.
    return (
      <InlineNotice icon={IconBrandGoogleDrive}>
        <div className="flex flex-col gap-1">
          <span>We didn't find a transcript folder in your Google Drive.</span>
          <span className="text-muted-foreground">
            We look for folders named {TRANSCRIPT_FOLDER_NAMES.join(", ")}. Meet
            and Tactiq create one the first time you record a meeting.
          </span>
          {/* The whole point of this state for most people: they had no folder
              when the page first loaded, then recorded a meeting. Without this
              they would have to guess that reloading eventually helps. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={rescanning}
            onClick={onRescan}
          >
            Check again
          </Button>
        </div>
      </InlineNotice>
    );
  }

  if (result.status === "no-access") {
    return (
      <InlineNotice icon={IconAlertTriangle}>
        Google Drive refused the request. Check that your account still has
        access to your transcript folders.
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

  if (result.transcripts.length === 0) {
    return (
      <EmptyState bordered>
        {searching
          ? "No transcripts match that search."
          : "No new transcripts in this window."}
      </EmptyState>
    );
  }

  const groups = groupTranscriptsByDay(result.transcripts, nowMs);

  return (
    <div className="flex flex-col gap-2">
      {/* Height-capped rather than truncated, for the reason `ScrollList` documents:
          a 90-day window over a busy calendar is hundreds of meetings, and cutting
          the tail would make the oldest — the ones most likely still unfiled —
          unreachable. `max-h-96` is taller than the default cap because each entry
          here is two lines plus its day header. */}
      <ScrollList className="max-h-96 gap-0 rounded-md border px-3">
        {groups.map((group) => (
          <section key={group.key}>
            {/* Sticky so the day stays legible while scrolling through it —
                otherwise a long day scrolls its own header away and the rows below
                belong to no visible date. `bg-background` is required: without an
                opaque backdrop the rows scroll *through* the text. */}
            <h4 className="sticky top-0 z-10 bg-background py-1.5 text-xs font-medium text-muted-foreground">
              {group.label}
            </h4>
            <ul className="flex flex-col">
              {group.transcripts.map((transcript) => (
                <TranscriptRow
                  key={transcript.fileId}
                  transcript={transcript}
                  assignableKinds={assignableKinds}
                  onChanged={onChanged}
                />
              ))}
            </ul>
          </section>
        ))}
      </ScrollList>
      {result.truncated ? (
        <p className="text-xs text-muted-foreground">
          You have more transcripts in this window than we can list here —
          narrow it with a search, or open the folder in Drive.
        </p>
      ) : null}
    </div>
  );
}
