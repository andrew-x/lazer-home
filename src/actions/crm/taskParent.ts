import "server-only";

import { revalidatePath } from "next/cache";
import { tasks } from "@/lib/db/schema";
import { revalidateCompany, revalidateContact } from "./revalidate";
import type { TaskParentKind } from "./tasks.schema";

/**
 * The parent FK column for each task-parent kind. Tasks carry three concrete,
 * nullable parent FKs (company/contact/opportunity) with a DB CHECK that exactly
 * one is set; this map is the single place kind → column is resolved for reads
 * and writes.
 */
export const TASK_PARENT_COLUMN = {
  company: tasks.companyId,
  contact: tasks.contactId,
  opportunity: tasks.opportunityId,
} as const;

/** The three parent FKs a `.returning()` yields, to revalidate the right pages. */
export type TaskParentRow = {
  companyId: string | null;
  contactId: string | null;
  opportunityId: string | null;
};

/**
 * Revalidate the pages that render a task's parent after a mutation. Contacts and
 * companies have their own detail routes; opportunities render only in the board
 * drawer (no `/opportunities/[id]`), so the board list is all there is to refresh.
 */
export function revalidateTaskParent(row: TaskParentRow): void {
  if (row.companyId) revalidateCompany(row.companyId);
  else if (row.contactId) revalidateContact(row.contactId);
  else revalidatePath("/opportunities");
}

/** Revalidate from a known kind + parent id (used on create, before we hold a row). */
export function revalidateTaskParentByKind(
  kind: TaskParentKind,
  parentId: string,
): void {
  revalidateTaskParent({
    companyId: kind === "company" ? parentId : null,
    contactId: kind === "contact" ? parentId : null,
    opportunityId: kind === "opportunity" ? parentId : null,
  });
}
