/**
 * Meeting-transcript triage — the pure half, including every Drive `q` this
 * feature builds against a **personal** Drive.
 *
 * A pure, client-importable module: no `db`, no drizzle, no `@/env`. Sibling of
 * `folder.ts` under ADR 0036 for the same reason — the feature spans CRM and
 * Projects, so neither owns it.
 *
 * ## Why the query builders live here rather than beside the transport
 *
 * ADR 0071 §1 guarantees that nothing we run enumerates a personal Drive, enforced
 * structurally: `driveList` hardcodes the shared drive, so "scope is not a
 * parameter". This feature cannot exist under that guarantee and ADR 0072 amends
 * it — but only as far as it has to. The replacement guarantee is that **the query
 * shape is not a parameter either**: every personal read is one of the two
 * templates below, built from a fixed name list or from folder ids we have already
 * stored for that user. There is no way to ask a personal Drive an arbitrary
 * question.
 *
 * Putting them here rather than inline in `driveApi.ts` is what makes that
 * testable. The bounds are the security property; an untested security property is
 * a claim, not a bound.
 */

import {
  DRIVE_FOLDER_MIME,
  type DriveFolderKind,
  driveQuoteValue,
} from "./folder";

/**
 * The folders Google Meet and Tactiq drop transcripts into. Exactly these names,
 * matched exactly (Drive's `name =` is case-sensitive, so a folder called "meet
 * recordings" is invisible to us — see the note on `transcriptFolderQuery`).
 *
 * This list is the entire surface of what we can learn about someone's Drive:
 * whether they own a folder with one of these names. Adding a name widens that
 * surface, which is a decision for ADR 0072 and not a config tweak — in
 * particular **never make this a parameter**, or the discovery query becomes a
 * general-purpose folder search over a personal Drive.
 */
export const TRANSCRIPT_FOLDER_NAMES = [
  "Google Meet",
  "Meet Recordings",
  "Legacy Meet Recordings",
  "Tactiq Transcription",
  "Tactiq Transcriptions",
] as const;

/**
 * The subfolder a filed transcript lands in, inside the record's own folder:
 * `Lazer Home/Projects/<project>/Transcripts`. Find-or-created on first file, so
 * no record needs setting up in advance.
 */
export const TRANSCRIPTS_SUBFOLDER_NAME = "Transcripts";

/**
 * Drive's marker for a Google Doc. Meet and Tactiq both write transcripts as
 * Docs, so this doubles as the filter that keeps recordings (video) and any
 * stray file out of the triage list.
 */
export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

/**
 * The "show more" ladder, in days back from today. The widget opens on the first
 * step and walks down; each step re-queries Drive rather than filtering what was
 * already fetched, because the earlier window never held the older rows.
 */
export const TRIAGE_WINDOW_DAYS = [7, 30, 90] as const;

/** The window the widget opens on. */
export const TRIAGE_DEFAULT_DAYS = TRIAGE_WINDOW_DAYS[0];

/** The longest window "show more" can reach. */
export const TRIAGE_MAX_DAYS =
  TRIAGE_WINDOW_DAYS[TRIAGE_WINDOW_DAYS.length - 1];

/**
 * The `q` matching this user's transcript folders by name.
 *
 * **Takes no parameters, deliberately.** A `names` argument here would turn the
 * one discovery call into "find any folder in this person's Drive", which is the
 * enumeration ADR 0071 §1 exists to prevent and ADR 0072 does *not* license.
 *
 * Note the deliberate incompleteness, which the UI states rather than works
 * around: `name =` is case- and whitespace-exact in Drive, so a folder someone
 * renamed to "Meet recordings" won't be found. `name contains` would be laxer but
 * would also match "Old Google Meet notes from Acme", pulling unrelated documents
 * into a shared folder — the wrong failure of the two.
 */
export function transcriptFolderQuery(): string {
  const names = TRANSCRIPT_FOLDER_NAMES.map(
    (name) => `name = ${driveQuoteValue(name)}`,
  ).join(" or ");
  return `mimeType = ${driveQuoteValue(DRIVE_FOLDER_MIME)} and (${names})`;
}

/**
 * The `q` for Google Docs inside `folderIds`, optionally narrowed by creation date
 * or by a name substring.
 *
 * **Returns `null` for an empty `folderIds`, and every caller must respect that.**
 * This is the single most dangerous edge in the feature: a `parents` clause built
 * from an empty list either collapses to `()` (which Drive rejects) or, if written
 * slightly differently, disappears from the query entirely — leaving
 * `mimeType = document`, which lists **every Google Doc the person owns**. Failing
 * closed with a sentinel the type system forces callers to handle is the only
 * version of this that can't regress into that quietly.
 *
 * `sinceIso` filters on `createdTime`, not `modifiedTime`: a transcript's date is
 * when the meeting happened, so an edit two weeks later must not refloat it to the
 * top of the triage list.
 */
export function transcriptDocsQuery(
  folderIds: readonly string[],
  opts: { sinceIso?: string; nameContains?: string } = {},
): string | null {
  if (folderIds.length === 0) return null;

  const parents = folderIds
    .map((id) => `${driveQuoteValue(id)} in parents`)
    .join(" or ");

  const clauses = [
    `mimeType = ${driveQuoteValue(GOOGLE_DOC_MIME)}`,
    `(${parents})`,
  ];

  if (opts.sinceIso) {
    clauses.push(`createdTime >= ${driveQuoteValue(opts.sinceIso)}`);
  }
  if (opts.nameContains) {
    clauses.push(`name contains ${driveQuoteValue(opts.nameContains)}`);
  }

  return clauses.join(" and ");
}

/**
 * The human-facing link to a filed transcript.
 *
 * ADR 0071 §10 warns against constructing a *file* URL and takes Drive's own
 * `webViewLink` instead, because a folder listing holds arbitrary mime types and
 * each has its own URL shape. That caution doesn't bite here, and the reason is
 * structural rather than a judgement call: every file this feature ever creates is
 * a copy of a Google Doc — `transcriptDocsQuery` filters the source set to
 * `GOOGLE_DOC_MIME`, and `files.copy` preserves the type — so the set of shapes is
 * exactly one.
 *
 * The alternative was storing the copy's `webViewLink` in a column, which is a
 * second snapshot to keep and a wider row for a URL derivable from the id we
 * already have.
 */
export function googleDocUrl(fileId: string): string {
  return `https://docs.google.com/document/d/${fileId}/edit`;
}

/**
 * The RFC3339 instant `days` before `nowMs`, for `transcriptDocsQuery`'s
 * `sinceIso`. Takes `nowMs` rather than reading the clock so the window is
 * decided by the caller and the function stays pure (and testable).
 */
export function transcriptWindowStart(nowMs: number, days: number): string {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * What each target kind is called on screen, when the thing being named is the
 * *record* rather than its folder ("Opportunity", not "Sales folder").
 *
 * Keyed on `DriveFolderKind` rather than on a transcript-specific enum, and that
 * is load-bearing: `assignTranscript` is gated by `authorizeDriveFolder`, which
 * resolves the capability by parsing `driveFolderKindSchema` off the raw input and
 * looking the kind up in `DRIVE_FOLDER_TARGETS`. A parallel list here that drifted
 * by one entry would mean a kind the UI can offer but the gate can't resolve — or
 * worse, resolve to the wrong table. One enum, no drift.
 */
export const TRANSCRIPT_TARGET_LABELS: Record<DriveFolderKind, string> = {
  sales: "Opportunity",
  project: "Project",
};
