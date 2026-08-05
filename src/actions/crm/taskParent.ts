import "server-only";

import { revalidatePath } from "next/cache";
import { tasks } from "@/lib/db/schema";
import {
  revalidateCompany,
  revalidateContact,
  revalidateOpportunity,
} from "./revalidate";
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
 *
 * `/` is refreshed for **every** parent kind, not just opportunities: the home
 * dashboard's personal task list reads tasks across all three (`getMyTasks`), so
 * ticking a company task off on `/companies/[id]` moves a figure there too. The
 * opportunity branch additionally goes through `revalidateOpportunity`, which is
 * what refreshes the per-deal "next steps" in the personal pipeline block.
 */
export function revalidateTaskParent(row: TaskParentRow): void {
  if (row.companyId) {
    revalidateCompany(row.companyId);
    revalidatePath("/");
  } else if (row.contactId) {
    revalidateContact(row.contactId);
    revalidatePath("/");
  } else {
    revalidateOpportunity();
  }
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
