/**
 * The transcript-triage payload, folded for the client.
 *
 * ## The payload is a disclosure boundary
 *
 * `TranscriptTriagePanel` is a Client Component, so everything this module returns
 * is serialized into the home page's HTML for the person viewing it. Two kinds of
 * value must never cross:
 *
 * - **The transcript folder ids the listing was scoped by.** Those ids *are* the
 *   read boundary for every personal-Drive query in the feature (see
 *   `src/actions/drive/transcriptFolders.ts`); a browser has no use for them and
 *   round-tripping them would invite a client-supplied scope.
 * - **Anything belonging to another user.** Every row read is already filtered by
 *   `userId`, so this is about not widening what a row carries.
 *
 * The rule, from ADR 0063 §5: the projectors below **copy every field one at a time
 * and spread nothing** — kept even where a spread would be safe today, because the
 * rule is worth more as an invariant with no exceptions to reason about than as a
 * judgement re-made per field. `transcripts.test.ts` asserts on the *serialized*
 * output rather than on a field list, so a future spread fails the test rather than
 * quietly passing it.
 *
 * Pure and client-importable: no `db`, no drizzle, no `@/env`.
 */

import type { DriveFolderKind } from "@/lib/drive/folder";
import { googleDocUrl } from "@/lib/drive/transcript";

/** A Drive file as the transport hands it over — the input to the fold. */
export type TranscriptSource = {
  id: string;
  name: string;
  createdTime?: string | null;
  webViewLink?: string | null;
};

/** One stored triage decision — the other input to the fold. */
export type TranscriptDecision = {
  driveFileId: string;
  dismissed: boolean;
  opportunityId: string | null;
  projectId: string | null;
  copiedFileId: string | null;
};

/**
 * Where a transcript has already been filed.
 *
 * `recordName` is resolved from our own tables rather than snapshotted, so a renamed
 * project shows its current name — unlike the *folder* name, which is a deliberate
 * snapshot (ADR 0071 §9). The difference is which system owns the fact: Drive owns
 * the folder's name, we own the record's.
 */
export type TranscriptAssignmentView = {
  kind: DriveFolderKind;
  recordId: string;
  recordName: string;
  /** Link to the copy now sitting in the record's folder. */
  copyUrl: string | null;
};

/**
 * One transcript in the triage list. **This type is a whitelist** — see the module
 * comment. `createdAt` crosses as epoch millis, the `TaskView` convention.
 */
export type TranscriptView = {
  fileId: string;
  name: string;
  createdAt: number | null;
  /** Drive's own link to the source doc. Never constructed by us. */
  webViewLink: string | null;
  assignments: TranscriptAssignmentView[];
};

/**
 * Join Drive's files to this user's triage decisions and project them down.
 *
 * Dismissed transcripts are dropped rather than flagged: a dismissal means "not
 * worth filing", so leaving the row in the list would defeat the point of having
 * one. They remain restorable because the row is still in the table — the archive
 * reads it back.
 *
 * A transcript with assignment rows **stays in the list**, badged with where it
 * went: one call about a deal that became a project legitimately belongs to both,
 * and the badge is the only place that history is visible.
 */
export function buildTranscriptViews(
  files: readonly TranscriptSource[],
  decisions: readonly TranscriptDecision[],
  recordNames: ReadonlyMap<string, string>,
): TranscriptView[] {
  const byFile = new Map<string, TranscriptAssignmentView[]>();
  const dismissed = new Set<string>();

  for (const decision of decisions) {
    if (decision.dismissed) {
      dismissed.add(decision.driveFileId);
      continue;
    }
    const view = toAssignmentView(decision, recordNames);
    if (!view) continue;
    const list = byFile.get(decision.driveFileId) ?? [];
    list.push(view);
    byFile.set(decision.driveFileId, list);
  }

  return files
    .filter((file) => !dismissed.has(file.id))
    .map((file) => toTranscriptView(file, byFile.get(file.id) ?? []));
}

/**
 * One day's transcripts, for the grouped list.
 *
 * `key` is a stable `YYYY-MM-DD` (or the `UNDATED_GROUP_KEY` sentinel) rather than
 * the label, because the label is relative — "Today" names a different day tomorrow,
 * so keying React off it would reuse a mounted row against the wrong group.
 */
export type TranscriptDayGroup = {
  key: string;
  label: string;
  transcripts: TranscriptView[];
};

/**
 * The bucket for transcripts Drive gave no `createdTime` for.
 *
 * They are kept and shown last rather than dropped: an undated transcript is still a
 * transcript someone may want to file, and silently hiding it would be the same
 * failure as a truncated listing rendered as a complete one.
 */
export const UNDATED_GROUP_KEY = "undated";

/**
 * Group transcripts into days, newest day first, undated last.
 *
 * Buckets by **local calendar day**, which is the only grouping that matches what
 * someone means by "the meetings I had on Tuesday" — `createdAt` is an instant, and
 * bucketing it in UTC would put a 5pm Pacific call on the following day. Safe to do
 * on the client here because the panel fetches after mount, so there is no
 * server-rendered markup for a timezone difference to disagree with.
 *
 * Relative labels are resolved against the caller's `nowMs` rather than the clock,
 * so grouping is a pure function of its inputs and a test can pin "Today". The cost
 * is the one the task list already accepts: a tab left open across midnight keeps
 * yesterday's label until something re-renders it.
 *
 * Input order is preserved within each day — Drive returns `createdTime desc`, so
 * the newest meeting stays at the top of its own group.
 */
export function groupTranscriptsByDay(
  transcripts: readonly TranscriptView[],
  nowMs: number,
): TranscriptDayGroup[] {
  const groups = new Map<string, TranscriptView[]>();

  for (const transcript of transcripts) {
    const key =
      transcript.createdAt === null
        ? UNDATED_GROUP_KEY
        : localDayKey(transcript.createdAt);
    const bucket = groups.get(key);
    if (bucket) bucket.push(transcript);
    else groups.set(key, [transcript]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => compareDayKeys(a, b))
    .map(([key, dayTranscripts]) => ({
      key,
      label: dayGroupLabel(key, nowMs),
      transcripts: dayTranscripts,
    }));
}

/** Newest day first; the undated bucket always sorts last. */
function compareDayKeys(a: string, b: string): number {
  if (a === UNDATED_GROUP_KEY) return 1;
  if (b === UNDATED_GROUP_KEY) return -1;
  return b.localeCompare(a);
}

/**
 * `YYYY-MM-DD` in the **local** zone.
 *
 * Built from the local getters rather than `toISOString().slice(0, 10)`, which would
 * silently convert to UTC and mis-bucket every evening meeting.
 */
function localDayKey(epochMs: number): string {
  const date = new Date(epochMs);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** "Today" / "Yesterday" / "Mon, Aug 3" — the header for one day's group. */
function dayGroupLabel(key: string, nowMs: number): string {
  if (key === UNDATED_GROUP_KEY) return "Date unknown";

  const today = localDayKey(nowMs);
  if (key === today) return "Today";
  if (key === localDayKey(nowMs - 24 * 60 * 60 * 1000)) return "Yesterday";

  // Parse back through the local-day parts, so the label names the same day the key
  // does — `new Date("2026-08-03")` would parse as UTC midnight and can render as
  // the 2nd for anyone west of Greenwich.
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    // Only disambiguate across a year boundary; "Mon, Aug 3, 2026" on every row of a
    // list that rarely leaves the current year is noise.
    ...(date.getFullYear() === new Date(nowMs).getFullYear()
      ? {}
      : { year: "numeric" as const }),
  }).format(date);
}

/** Copies field by field — never spread. See {@link TranscriptView}. */
function toTranscriptView(
  file: TranscriptSource,
  assignments: TranscriptAssignmentView[],
): TranscriptView {
  return {
    fileId: file.id,
    name: file.name,
    createdAt: file.createdTime ? Date.parse(file.createdTime) : null,
    webViewLink: file.webViewLink ?? null,
    assignments,
  };
}

/** Copies field by field — never spread. See {@link TranscriptAssignmentView}. */
function toAssignmentView(
  decision: TranscriptDecision,
  recordNames: ReadonlyMap<string, string>,
): TranscriptAssignmentView | null {
  const kind: DriveFolderKind | null = decision.opportunityId
    ? "sales"
    : decision.projectId
      ? "project"
      : null;
  const recordId = decision.opportunityId ?? decision.projectId;
  if (!kind || !recordId) return null;

  // A row whose record has gone shouldn't take the dashboard down. The FKs cascade,
  // so this is defence in depth rather than an expected state — and dropping the row
  // beats rendering a badge with no name on it.
  const recordName = recordNames.get(recordId);
  if (!recordName) return null;

  return {
    kind,
    recordId,
    recordName,
    copyUrl: decision.copiedFileId ? googleDocUrl(decision.copiedFileId) : null,
  };
}
