import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/db";
import { staff, tasks } from "@/lib/db/schema";
import { TASK_PARENT_COLUMN } from "./taskParent";
import type { TaskParentKind } from "./tasks.schema";

/**
 * A task shaped for the client: owner/creator names resolved, timestamps as epoch
 * millis (serializable across the RSC boundary, matching the entry-view
 * convention). `completedAt` is null while the task is open.
 */
export type TaskView = {
  id: string;
  description: string;
  done: boolean;
  completedAt: number | null;
  createdAt: number;
  ownerId: string | null;
  ownerName: string | null;
  creatorName: string | null;
};

/** A minimal open-task summary for list cells / board cards. */
export type OpenTaskSummary = { id: string; description: string };

/**
 * All tasks for one parent, open first then newest — the detail-page Tasks card.
 * Owner and creator are resolved via two `staff` aliases (both nullable — the
 * FKs set-null on staff removal).
 */
export async function getTasksForParent(
  kind: TaskParentKind,
  parentId: string,
): Promise<TaskView[]> {
  const owner = alias(staff, "task_owner");
  const creator = alias(staff, "task_creator");
  const parentColumn = TASK_PARENT_COLUMN[kind];

  const rows = await db
    .select({
      id: tasks.id,
      description: tasks.description,
      done: tasks.done,
      completedAt: tasks.completedAt,
      createdAt: tasks.createdAt,
      ownerId: tasks.ownerStaffId,
      ownerName: owner.name,
      creatorName: creator.name,
    })
    .from(tasks)
    .leftJoin(owner, eq(tasks.ownerStaffId, owner.id))
    .leftJoin(creator, eq(tasks.creatorStaffId, creator.id))
    .where(eq(parentColumn, parentId))
    // Open tasks (done = false) sort first; newest within each group.
    .orderBy(asc(tasks.done), desc(tasks.createdAt));

  return rows.map((row) => ({
    ...row,
    completedAt: row.completedAt ? row.completedAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
  }));
}

/**
 * Open (not-done) tasks for a set of parents of one kind, grouped by parent id —
 * the "all incomplete tasks" summary the contacts list, company detail, and
 * opportunity board render. One query for the whole page; grouped in JS so no
 * parent with zero open tasks needs a row. Oldest first (the longest-outstanding
 * task reads first).
 */
export async function openTasksByParent(
  kind: TaskParentKind,
  parentIds: string[],
): Promise<Map<string, OpenTaskSummary[]>> {
  const grouped = new Map<string, OpenTaskSummary[]>();
  if (parentIds.length === 0) return grouped;

  const parentColumn = TASK_PARENT_COLUMN[kind];
  const rows = await db
    .select({
      parentId: parentColumn,
      id: tasks.id,
      description: tasks.description,
    })
    .from(tasks)
    .where(and(inArray(parentColumn, parentIds), eq(tasks.done, false)))
    .orderBy(asc(tasks.createdAt));

  for (const row of rows) {
    // `parentColumn` is nullable in the schema, but the `inArray` filter above
    // guarantees a non-null value on every returned row.
    const key = row.parentId as string;
    const list = grouped.get(key) ?? [];
    list.push({ id: row.id, description: row.description });
    grouped.set(key, list);
  }
  return grouped;
}
