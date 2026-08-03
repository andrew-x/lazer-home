/**
 * How a task's CRM parent is *labelled and linked* in the UI. A pure,
 * client-importable module (no `db`/drizzle) — the server-only kind → FK column
 * map lives in `src/actions/crm/taskParent.ts`, which this file deliberately
 * does not touch (hence the `-link` suffix: the two are easy to confuse).
 */

import type { TaskParentKind } from "@/actions/crm/tasks.schema";

/** Human label for a task's parent kind, for the meta line and filter segments. */
export const TASK_PARENT_LABELS: Record<TaskParentKind, string> = {
  company: "Company",
  contact: "Contact",
  opportunity: "Opportunity",
};

/**
 * Where to send someone who clicks a task's parent.
 *
 * Companies and contacts have real detail routes. **Opportunities do not** —
 * there is no `/opportunities/[id]`; they render only in the board drawer (see
 * `revalidateTaskParent`), so the board itself is the closest destination. Don't
 * "fix" this by inventing a detail href: it would 404.
 */
export function taskParentHref(kind: TaskParentKind, parentId: string): string {
  switch (kind) {
    case "company":
      return `/companies/${parentId}`;
    case "contact":
      return `/contacts/${parentId}`;
    case "opportunity":
      return "/opportunities";
  }
}
