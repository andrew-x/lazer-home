import { z } from "zod";
import { searchQuerySchema } from "@/lib/core/search";
import { DRIVE_FOLDER_KINDS, DRIVE_FOLDER_NAME_MAX } from "@/lib/drive/folder";
import { id } from "@/lib/schemas/id-schema";
import { requiredText } from "@/lib/schemas/text-schema";

/**
 * Input schemas for the Google Drive folder actions.
 *
 * A pure, client-importable module (no `db`, no drizzle): the dialog, the folder
 * field and the files panel all import these, so a Drizzle table here would drag
 * the whole ORM into the client bundle (ADR 0035).
 */

/**
 * Which folder slot an action is operating on. Parsed by the authorize hook off
 * the raw `clientInput` *before* the body runs, because it selects the capability
 * required — see `authorizeDriveFolder`.
 */
export const driveFolderKindSchema = z.enum(DRIVE_FOLDER_KINDS);

/**
 * A Google Drive file or folder id.
 *
 * Not our `id` primitive — these are Google's, not CUID2s. Constrained to the
 * characters Drive actually uses so a hostile value can't reach a `q` string or
 * a URL path segment: Drive ids are URL-safe base64-ish (letters, digits, `-`,
 * `_`), historically with a `0B`/`1` prefix and no fixed length.
 */
export const driveResourceId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/, "Not a valid Google Drive id");

/**
 * The record whose folder slot we're touching. `recordId` is always the id of the
 * table that holds the column: an opportunity for `sales`, a project for
 * `project`. One kind never reaches the other's table.
 */
export const driveFolderTargetSchema = z.object({
  kind: driveFolderKindSchema,
  recordId: id,
});

/**
 * Create the folder for a record and link it.
 *
 * `name` is editable — the dialog pre-fills it from the record but the person can
 * change it before creating. The **path cannot be changed**: which parent the
 * folder lands under is resolved server-side from `kind` alone
 * (`DRIVE_PARENT_FOLDER_NAME`), never sent by the client, so no input here can put
 * a sales folder somewhere other than `Lazer Home/Sales`.
 *
 * A colliding name is **refused**, not silently suffixed: the dialog checks
 * availability as you type and blocks the button, and this action re-checks against
 * a fresh listing because that answer goes stale immediately.
 */
export const createDriveFolderSchema = driveFolderTargetSchema.extend({
  name: requiredText(DRIVE_FOLDER_NAME_MAX, "Give the folder a name"),
});

/**
 * Ask whether a proposed folder name is free, for the dialog's live warning.
 *
 * No `recordId`: the answer depends only on which parent the folder would land in,
 * which `kind` alone decides. `kind` is still required because the authorize hook
 * resolves the capability from it.
 */
export const checkDriveFolderNameSchema = z.object({
  kind: driveFolderKindSchema,
  name: requiredText(DRIVE_FOLDER_NAME_MAX, "Give the folder a name"),
});

/**
 * Link an existing folder. Takes the folder **id** only: the stored name is
 * resolved server-side from Drive, so a client can't write a name that doesn't
 * match the folder it points at.
 */
export const linkDriveFolderSchema = driveFolderTargetSchema.extend({
  folderId: driveResourceId,
});

/** Clear a slot. App-side only — the Drive folder itself is left alone. */
export const unlinkDriveFolderSchema = driveFolderTargetSchema;

/**
 * Type-ahead over folders in the Lazer Home shared drive.
 *
 * Takes no `kind`: unlike the Slack equivalent, the candidate set is identical
 * for both kinds (every folder in the shared drive), and the only exclusion — a
 * folder already linked — is global. There is nothing for a kind to select, so
 * asking for one would be a parameter the body ignores.
 */
export const searchDriveFoldersSchema = searchQuerySchema;

/**
 * List a folder's contents.
 *
 * `folderId` is any folder inside the shared drive, not just a linked one, so
 * the panel can navigate into subfolders. That is safe to accept unvalidated
 * against the link: `driveList` confines every query to the shared drive, and the
 * call runs on the viewer's own token, so this can only ever surface what that
 * person could already see in Drive's UI.
 */
export const listDriveFolderSchema = z.object({
  folderId: driveResourceId,
});

/**
 * Copy a file the user picked in the Google Picker into a folder.
 *
 * This is the ONLY action that reads a file outside the shared drive, and the
 * `fileId` always comes from a Picker selection — the user's own click in
 * Google's UI. It copies rather than moves, so the original stays where it was.
 * See docs/decisions/0069.
 */
export const copyDriveFileSchema = z.object({
  folderId: driveResourceId,
  fileId: driveResourceId,
});

export type DriveFolderTargetInput = z.infer<typeof driveFolderTargetSchema>;
export type CreateDriveFolderInput = z.infer<typeof createDriveFolderSchema>;
export type CheckDriveFolderNameInput = z.infer<
  typeof checkDriveFolderNameSchema
>;
export type LinkDriveFolderInput = z.infer<typeof linkDriveFolderSchema>;
export type UnlinkDriveFolderInput = z.infer<typeof unlinkDriveFolderSchema>;
export type SearchDriveFoldersInput = z.infer<typeof searchDriveFoldersSchema>;
export type ListDriveFolderInput = z.infer<typeof listDriveFolderSchema>;
export type CopyDriveFileInput = z.infer<typeof copyDriveFileSchema>;
