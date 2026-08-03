import { type InferSelectModel, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { companies, contacts } from "./crm-schema";
import { opportunities } from "./opportunities-schema";
import { staff } from "./staff-schema";

// ---------------------------------------------------------------------------
// Tasks — assignable, completable to-dos on CRM entities
//
// A task replaces the old free-text "next step" entry: it carries an owner (the
// assignee), a creator, a completion state, and a description. Each task hangs
// off exactly one CRM parent — a company, a contact, or an opportunity — via
// concrete typed FKs (no polymorphic parent_type/parent_id), with a CHECK
// enforcing exactly-one-parent so referential integrity stays real. Owner and
// creator reference `staff` (not the auth `user`), matching the other people-FKs
// in this domain (`companies.ownerId`, `contactEntries.authorStaffId`).
// See docs/domains/crm.md.
// ---------------------------------------------------------------------------

export const tasks = pgTable(
  "tasks",
  {
    id: text().primaryKey(),
    description: text().notNull(),
    // The assignee. Set-null so a task survives its owner's staff row being
    // removed; defaults to the creator when unspecified (set in the action).
    ownerStaffId: text().references(() => staff.id, { onDelete: "set null" }),
    // Who created it. Set-null on staff removal (attribution, not ownership).
    creatorStaffId: text().references(() => staff.id, { onDelete: "set null" }),
    done: boolean().notNull().default(false),
    // Stamped when `done` flips true, cleared back to null when reopened.
    completedAt: timestamp(),

    // Exactly one parent — concrete FKs (no polymorphic FK), enforced by the
    // CHECK below. Cascade so a task dies with its parent.
    companyId: text().references(() => companies.id, { onDelete: "cascade" }),
    contactId: text().references(() => contacts.id, { onDelete: "cascade" }),
    opportunityId: text().references(() => opportunities.id, {
      onDelete: "cascade",
    }),

    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    check(
      "tasks_one_parent",
      sql`num_nonnulls(${t.companyId}, ${t.contactId}, ${t.opportunityId}) = 1`,
    ),
    // One index per parent, on (parent, done) — the read is "open tasks for this
    // parent, newest first", so `done` earns its place in the index.
    index("tasks_contact_done_idx").on(t.contactId, t.done),
    index("tasks_opportunity_done_idx").on(t.opportunityId, t.done),
    index("tasks_company_done_idx").on(t.companyId, t.done),
    // The home dashboard's personal todo list reads the other way round: one
    // *owner's* open tasks, newest-assigned first. The three parent indexes above
    // can't serve it — none of them leads with the owner. The companion read (that
    // owner's completed history) orders by `completedAt`, which this index can't
    // sort; it's left to sort the matched rows, since one person's closed tasks are
    // a small set and the read caps them anyway.
    index("tasks_owner_done_idx").on(
      t.ownerStaffId,
      t.done,
      t.createdAt.desc(),
    ),
  ],
);

// --- Row types -------------------------------------------------------------

export type Task = InferSelectModel<typeof tasks>;
