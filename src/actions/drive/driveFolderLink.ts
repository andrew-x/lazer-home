import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { revalidateProject } from "@/actions/projects/revalidate";
import type { PermissionCheck } from "@/lib/auth/permissions";
import { db } from "@/lib/db/db";
import { opportunities, projects } from "@/lib/db/schema";
import type { DriveFolderKind } from "@/lib/drive/folder";

/**
 * Where each folder kind lives, as one table — the only place in the feature
 * that knows a `kind` maps to a table, a column pair and a capability.
 *
 * This exists to close a specific hole, and the reasoning is the same one
 * `SLACK_CHANNEL_TARGETS` documents. The two kinds are gated by *different*
 * capabilities (`crm.edit` vs `projects.edit`), which are disjoint in the matrix
 * — a `sales` role has one, a `delivery-manager` the other. If the authorize
 * hook decided which capability to require from one source and an action body
 * decided which table to write from another, the two could disagree, and someone
 * holding only `crm.edit` could write a `projects` column. Both the hook and
 * every action body read the same entry here, so that divergence isn't
 * expressible.
 *
 * Don't "tidy" this into a static `metadata.permission`, and don't add a
 * `drive.manage` capability — see docs/decisions/0069.
 *
 * The entries hold closures rather than raw Drizzle column handles: it keeps each
 * query concretely typed against its own table, and keeps the `isNull` link guard
 * next to the column it guards.
 */

type DriveFolderLinkRow = {
  folderId: string | null;
  folderName: string | null;
  /** The record's own name — what the folder is named after. */
  sourceName: string;
};

type DriveFolderTarget = {
  /** Human label for this slot, used in action error copy. */
  label: string;
  /** The capability required to create, link or unlink this kind. */
  permission: PermissionCheck;
  /**
   * The unique index a concurrent link violates, for `isUniqueViolation`. Named
   * here so the constraint name lives beside the write that can trip it.
   */
  uniqueConstraint: string;
  /** Current link + the source name, or null when the record doesn't exist. */
  read(recordId: string): Promise<DriveFolderLinkRow | null>;
  /**
   * Attach a folder, but only if the slot is still empty. The `isNull` guard
   * makes this the atomic half of the double-click defence — false means someone
   * else won the race or the record is gone.
   */
  link(
    recordId: string,
    folder: { id: string; name: string },
  ): Promise<boolean>;
  /** Clear the slot. Never touches Drive. */
  unlink(recordId: string): Promise<boolean>;
  /** Refresh every route that renders this record's folder. */
  revalidate(recordId: string): void;
};

export const DRIVE_FOLDER_TARGETS: Record<DriveFolderKind, DriveFolderTarget> =
  {
    sales: {
      label: "Sales folder",
      permission: { crm: ["edit"] },
      uniqueConstraint: "opportunities_sales_drive_folder_idx",
      async read(recordId) {
        const rows = await db
          .select({
            folderId: opportunities.salesDriveFolderId,
            folderName: opportunities.salesDriveFolderName,
            sourceName: opportunities.name,
          })
          .from(opportunities)
          .where(eq(opportunities.id, recordId))
          .limit(1);
        return rows.at(0) ?? null;
      },
      async link(recordId, folder) {
        const rows = await db
          .update(opportunities)
          .set({
            salesDriveFolderId: folder.id,
            salesDriveFolderName: folder.name,
          })
          .where(
            and(
              eq(opportunities.id, recordId),
              isNull(opportunities.salesDriveFolderId),
            ),
          )
          .returning({ id: opportunities.id });
        return rows.length > 0;
      },
      async unlink(recordId) {
        const rows = await db
          .update(opportunities)
          .set({ salesDriveFolderId: null, salesDriveFolderName: null })
          .where(eq(opportunities.id, recordId))
          .returning({ id: opportunities.id });
        return rows.length > 0;
      },
      revalidate() {
        // An opportunity has no page of its own — its detail is a drawer over the
        // board, so this is the only route that renders the sales folder.
        revalidatePath("/opportunities");
      },
    },

    project: {
      label: "Project folder",
      permission: { projects: ["edit"] },
      uniqueConstraint: "projects_drive_folder_idx",
      async read(recordId) {
        const rows = await db
          .select({
            folderId: projects.driveFolderId,
            folderName: projects.driveFolderName,
            sourceName: projects.name,
          })
          .from(projects)
          .where(eq(projects.id, recordId))
          .limit(1);
        return rows.at(0) ?? null;
      },
      async link(recordId, folder) {
        const rows = await db
          .update(projects)
          .set({ driveFolderId: folder.id, driveFolderName: folder.name })
          .where(and(eq(projects.id, recordId), isNull(projects.driveFolderId)))
          .returning({ id: projects.id });
        return rows.length > 0;
      },
      async unlink(recordId) {
        const rows = await db
          .update(projects)
          .set({ driveFolderId: null, driveFolderName: null })
          .where(eq(projects.id, recordId))
          .returning({ id: projects.id });
        return rows.length > 0;
      },
      revalidate(recordId) {
        revalidateProject(recordId);
      },
    },
  };

/**
 * Which of these Drive folder ids are already linked to some record?
 *
 * Used to keep a folder from being linked twice, and to keep an already-taken
 * folder out of search results. Deliberately takes the specific ids in question
 * — a candidate shortlist — rather than reading every linked id, so this stays
 * two indexed lookups regardless of how many records exist.
 *
 * Note this spans BOTH kinds: the per-table unique indexes stop a folder being
 * linked to two opportunities, but nothing at the DB level stops the same folder
 * being both an opportunity's sales folder and a project's delivery folder.
 * That's a mistake to prevent in the UI rather than a data-integrity invariant,
 * which is why it's enforced here instead of with a constraint.
 */
export async function folderIdsAlreadyLinked(
  folderIds: string[],
): Promise<Set<string>> {
  if (folderIds.length === 0) return new Set();

  const [salesRows, projectRows] = await Promise.all([
    db
      .select({ folderId: opportunities.salesDriveFolderId })
      .from(opportunities)
      .where(inArray(opportunities.salesDriveFolderId, folderIds)),
    db
      .select({ folderId: projects.driveFolderId })
      .from(projects)
      .where(inArray(projects.driveFolderId, folderIds)),
  ]);

  const taken = new Set<string>();
  for (const row of [...salesRows, ...projectRows]) {
    if (row.folderId) taken.add(row.folderId);
  }
  return taken;
}
