import { type InferSelectModel, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { opportunities } from "./opportunities-schema";
import { projects } from "./projects-schema";

// ---------------------------------------------------------------------------
// Google Drive — meeting-transcript triage
//
// Two tables supporting the home dashboard's Triage widget: filing the Google
// Docs that Meet and Tactiq drop into a personal Drive into the opportunity or
// project folder they belong to.
//
// Both key on `user`, NOT `staff`. The Drive grant lives on the Better Auth
// account (`account.userId`) and `getDriveAccessToken` takes a `userId`, so the
// auth user is the identity that owns a Drive. Keying on `staff` would mean a
// person's transcript folders became unreachable the moment their staff row was
// reshaped, and there is no staff-side fact being recorded here.
//
// See docs/decisions/0072 (which amends 0071 §1) and docs/domains/drive.md.
// ---------------------------------------------------------------------------

/**
 * The transcript folders we have found in one person's own Drive.
 *
 * **This table is the read boundary for every personal-Drive query in the
 * feature**, not a convenience cache. `driveListTranscriptDocs` takes its parent
 * ids from here and nowhere else, so the rows in this table are exactly the set of
 * places we can see into. Widening how rows get in here widens the read.
 *
 * ADR 0071 §4 forbids caching Drive reads, and this deliberately is not one: §4's
 * hazard is a *shared* cache entry serving one person's authorized listing to
 * another, which is why every Drive fetch is `no-store`. These are per-user rows
 * scoped by `userId` on every read, so there is no cross-user path. What is stored
 * is also not a listing — it is which folders the user has, which is the input to a
 * listing, and re-deriving it on every widget load would mean a second Drive round
 * trip per view for an answer that changes when someone makes a folder.
 */
export const driveTranscriptFolders = pgTable(
  "drive_transcript_folders",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Google's folder id, in the user's own Drive (never the shared drive). */
    driveFolderId: text().notNull(),
    /**
     * The folder's name when we found it — a display snapshot, per ADR 0071 §9.
     * Nothing writes this back from a read, so a rename in Drive makes the label
     * stale without breaking anything: the link is always by id.
     */
    folderName: text().notNull(),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (t) => [
    // Discovery re-runs whenever a user has no folders stored, and two tabs can
    // race it. `onConflictDoNothing` on this index is what makes that converge
    // instead of duplicating every folder.
    uniqueIndex("drive_transcript_folders_user_folder_idx").on(
      t.userId,
      t.driveFolderId,
    ),
    // The read is always "this user's folders" — never a scan by folder id.
    index("drive_transcript_folders_user_idx").on(t.userId),
  ],
);

/**
 * One triage decision: a transcript filed to a record, or dismissed as not worth
 * filing.
 *
 * **ADR 0071 rejected "per-file records in our DB", and this is not that.** What it
 * rejected was a *mirror* of folder contents — a table shadowing what Drive holds,
 * stale the moment someone uses Drive directly, with Drive still the system of
 * record. This records something Drive cannot tell us: that a particular person
 * decided a particular transcript belongs to a particular deal. Nothing here is
 * derivable from Drive, so nothing here can go stale against it.
 *
 * A row is one of exactly two shapes, enforced by the check below:
 *
 * - an **assignment** — exactly one of `opportunityId`/`projectId`, plus the
 *   `copiedFileId` of the copy that now lives in the shared drive
 * - a **dismissal** — no target, no copy
 *
 * The same transcript may be filed to several records (a call about a deal that
 * became a project belongs to both), so multiple assignment rows per file are
 * expected — but not two for the *same* record, and not two dismissals.
 */
export const transcriptAssignments = pgTable(
  "transcript_assignments",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /**
     * The SOURCE doc, in the user's own Drive. This is what the triage list is
     * keyed on, so a filed transcript can be shown as filed.
     */
    driveFileId: text().notNull(),
    /**
     * The source's name when it was triaged. Snapshotted rather than re-read
     * because the archive must still render a row whose source has since been
     * renamed, moved out of a transcript folder, or deleted — at which point there
     * is nothing left to read it from.
     */
    fileName: text().notNull(),
    /**
     * The transcript's own `createdTime` — when the meeting happened. Nullable
     * because Drive returns the field only when asked and we treat a missing
     * value as unknown rather than substituting "now", which would misdate the row.
     */
    fileCreatedAt: timestamp(),

    /** A dismissal rather than an assignment. See the shape check. */
    dismissed: boolean().notNull().default(false),

    // The target — exactly one, or neither for a dismissal. Concrete typed FKs
    // rather than a polymorphic pair, matching `tasks`: cascade so a triage row
    // dies with the record it points at.
    opportunityId: text().references(() => opportunities.id, {
      onDelete: "cascade",
    }),
    projectId: text().references(() => projects.id, { onDelete: "cascade" }),

    /**
     * The copy inside `<record folder>/Transcripts`. Set for an assignment, null
     * for a dismissal — the check ties it to the target so a row can never claim
     * to have filed something without saying where the copy went.
     */
    copiedFileId: text(),

    createdAt: timestamp().defaultNow().notNull(),
  },
  (t) => [
    check(
      "transcript_assignments_shape",
      sql`(${t.dismissed}
             and num_nonnulls(${t.opportunityId}, ${t.projectId}) = 0
             and ${t.copiedFileId} is null)
          or (not ${t.dismissed}
             and num_nonnulls(${t.opportunityId}, ${t.projectId}) = 1
             and ${t.copiedFileId} is not null)`,
    ),
    // Postgres treats NULLs as distinct, so each of these constrains only its own
    // kind of row: the project index ignores opportunity assignments and
    // dismissals (both have a null `projectId`) and vice versa. That is what lets
    // one file have several assignment rows while still refusing a duplicate
    // against the same record — the atomic half of the double-click defence.
    uniqueIndex("transcript_assignments_project_idx").on(
      t.userId,
      t.driveFileId,
      t.projectId,
    ),
    uniqueIndex("transcript_assignments_opportunity_idx").on(
      t.userId,
      t.driveFileId,
      t.opportunityId,
    ),
    // Partial, so it constrains dismissals only: one per file per user.
    uniqueIndex("transcript_assignments_dismissed_idx")
      .on(t.userId, t.driveFileId)
      .where(sql`${t.dismissed}`),
    // The triage read joins this table by the file ids Drive just returned, for
    // one user.
    index("transcript_assignments_user_file_idx").on(t.userId, t.driveFileId),
  ],
);

// --- Row types -------------------------------------------------------------

export type DriveTranscriptFolder = InferSelectModel<
  typeof driveTranscriptFolders
>;
export type TranscriptAssignment = InferSelectModel<
  typeof transcriptAssignments
>;
