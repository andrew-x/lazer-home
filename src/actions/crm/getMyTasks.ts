import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { contactName } from "@/lib/crm/contact-name";
import { db } from "@/lib/db/db";
import { companies, contacts, opportunities, tasks } from "@/lib/db/schema";
import { ARCHIVE_LIMIT } from "@/lib/home/my-tasks";
import type { TaskParentKind } from "./tasks.schema";

/**
 * One task assigned to the signed-in person, as the home dashboard's todo list
 * renders it: the description, when it was assigned, whether it's done, and the
 * CRM record it hangs off.
 *
 * **This type is a whitelist.** It is the prop of a Client Component on the home
 * route, so everything here is serialized into the page HTML — the same boundary
 * `@/lib/home/org-status` documents at length. Fields are copied one at a time in
 * {@link toMyTaskView}, never spread: `creatorStaffId`, `ownerStaffId` and
 * `updatedAt` are all deliberately absent, and a spread would silently ship
 * whatever column is added to `tasks` next.
 */
export type MyTaskView = {
  id: string;
  description: string;
  done: boolean;
  /** Epoch millis — the `TaskView` convention, serializable across the boundary. */
  createdAt: number;
  completedAt: number | null;
  parentKind: TaskParentKind;
  parentId: string;
  parentName: string;
};

export type MyTasksView = {
  // No `staffId` here on purpose. The caller already has its own (from
  // `getMyAllocations`), and this object is a Client Component's prop — carrying it
  // would ship a dead field into the page HTML, the same reason `org-status.ts`
  // drops `freeFrom`. An account with no staff record is represented by the empty
  // lists, not by a null id.
  /** Every open task assigned to them, newest first. */
  open: MyTaskView[];
  /** Their most recently completed tasks, newest first, capped at `ARCHIVE_LIMIT`. */
  completed: MyTaskView[];
  /** True when the cap was hit, so the archive can say so instead of implying it showed everything. */
  completedTruncated: boolean;
};

/** The shape the two queries below both project. */
type TaskRow = {
  id: string;
  description: string;
  done: boolean;
  createdAt: Date;
  completedAt: Date | null;
  companyId: string | null;
  contactId: string | null;
  opportunityId: string | null;
  companyName: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  opportunityName: string | null;
};

/**
 * Resolve which of the three parent FKs is set and project the row field-by-field
 * (see the disclosure note on {@link MyTaskView}).
 *
 * Returns null when no parent resolves. The `tasks_one_parent` CHECK makes that
 * unreachable, so this is defense in depth rather than an expected state — but a
 * throw here would take down the whole home dashboard, and a dropped row won't.
 */
function toMyTaskView(row: TaskRow): MyTaskView | null {
  const parent: { kind: TaskParentKind; id: string; name: string } | null =
    row.companyId
      ? { kind: "company", id: row.companyId, name: row.companyName ?? "" }
      : row.contactId
        ? {
            kind: "contact",
            id: row.contactId,
            name: contactName({
              firstName: row.contactFirstName ?? "",
              lastName: row.contactLastName ?? "",
            }),
          }
        : row.opportunityId
          ? {
              kind: "opportunity",
              id: row.opportunityId,
              name: row.opportunityName ?? "",
            }
          : null;
  if (!parent) return null;

  return {
    id: row.id,
    description: row.description,
    done: row.done,
    createdAt: row.createdAt.getTime(),
    completedAt: row.completedAt ? row.completedAt.getTime() : null,
    parentKind: parent.kind,
    parentId: parent.id,
    parentName: parent.name,
  };
}

/** The columns both queries select — the parent joins resolve each kind's name. */
const TASK_COLUMNS = {
  id: tasks.id,
  description: tasks.description,
  done: tasks.done,
  createdAt: tasks.createdAt,
  completedAt: tasks.completedAt,
  companyId: tasks.companyId,
  contactId: tasks.contactId,
  opportunityId: tasks.opportunityId,
  companyName: companies.name,
  // Projected as two columns and composed with `contactName` rather than
  // `contactNameSql`: a raw SQL expression can't be attributed to a left-joined
  // table, so Drizzle would widen it to nullable anyway (see that helper's note).
  contactFirstName: contacts.firstName,
  contactLastName: contacts.lastName,
  opportunityName: opportunities.name,
};

/**
 * Every task assigned to the signed-in person, split into what's outstanding and
 * what they've finished — the home dashboard's personal todo list.
 *
 * **Takes no `staffId`.** Like `getMyAllocations`, it is own-data-only by
 * construction: there is no cross-user id to authorize and therefore no gate to
 * get wrong. An account with no linked staff record gets empty lists rather than
 * an error.
 *
 * Open tasks are unbounded and sort newest-assigned first (the list is a backlog,
 * and the stale-task highlight is what surfaces the old end of it). Completed
 * tasks sort by completion and are capped — see `ARCHIVE_LIMIT`.
 */
export async function getMyTasks(): Promise<MyTasksView> {
  const staffId = await getCurrentStaffId();
  if (!staffId) {
    return { open: [], completed: [], completedTruncated: false };
  }

  const [openRows, completedRows] = await Promise.all([
    db
      .select(TASK_COLUMNS)
      .from(tasks)
      .leftJoin(companies, eq(tasks.companyId, companies.id))
      .leftJoin(contacts, eq(tasks.contactId, contacts.id))
      .leftJoin(opportunities, eq(tasks.opportunityId, opportunities.id))
      .where(and(eq(tasks.ownerStaffId, staffId), eq(tasks.done, false)))
      .orderBy(desc(tasks.createdAt)),

    db
      .select(TASK_COLUMNS)
      .from(tasks)
      .leftJoin(companies, eq(tasks.companyId, companies.id))
      .leftJoin(contacts, eq(tasks.contactId, contacts.id))
      .leftJoin(opportunities, eq(tasks.opportunityId, opportunities.id))
      .where(and(eq(tasks.ownerStaffId, staffId), eq(tasks.done, true)))
      // By completion, not creation: the archive answers "what did I finish, and
      // when", so an old task closed yesterday belongs at the top — and the
      // `ARCHIVE_LIMIT` window keeps the most recent *completions* rather than an
      // arbitrary slice. `sortMyTasksByRecency` renders it in this same order.
      .orderBy(desc(tasks.completedAt), desc(tasks.createdAt))
      .limit(ARCHIVE_LIMIT),
  ]);

  return {
    open: openRows.map(toMyTaskView).filter((task) => task !== null),
    completed: completedRows.map(toMyTaskView).filter((task) => task !== null),
    completedTruncated: completedRows.length === ARCHIVE_LIMIT,
  };
}
