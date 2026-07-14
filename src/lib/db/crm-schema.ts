import type { InferSelectModel } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { staff } from "./staff-schema";

// ---------------------------------------------------------------------------
// CRM domain — companies & contacts
//
// `companies` are the organisations we deal with — both clients and partners
// (`isPartner` distinguishes them). `contacts` are people, optionally attached
// to a company. The sales pipeline (`opportunities` and its junction tables)
// lives in `opportunities-schema.ts`. See docs/domains/crm.md.
// ---------------------------------------------------------------------------

export const companies = pgTable("companies", {
  id: text().primaryKey(),
  name: text().notNull(),
  websiteUrl: text(),
  isPartner: boolean().notNull().default(false),
  // Optional owner — the staff member accountable for the relationship. Null
  // when unassigned or once the staff row is removed (set-null, mirroring the
  // optional-FK convention on `contacts.companyId`). Owner = staff, matching
  // `opportunityOwners.staffId`.
  ownerId: text().references(() => staff.id, { onDelete: "set null" }),

  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const contacts = pgTable("contacts", {
  id: text().primaryKey(),
  firstName: text().notNull(),
  lastName: text().notNull(),
  email: text().notNull().unique(),
  phone: text(),
  // Optional employer. Null when unknown or once the company is removed.
  companyId: text().references(() => companies.id, { onDelete: "set null" }),
  // Optional free-text job title, e.g. "CTO".
  role: text(),
  // Optional LinkedIn profile URL.
  linkedinUrl: text(),
  // Optional "managed by" link to another contact. Self-referential; set-null on
  // delete so removing a manager just clears their reports' pointer (mirrors the
  // optional-FK convention on `companyId`). By our rules a manager is always a
  // contact at the same company (enforced in `createContact`).
  managerId: text().references((): AnyPgColumn => contacts.id, {
    onDelete: "set null",
  }),
  // Optional owner — the staff member accountable for this contact. Null when
  // unassigned or once the staff row is removed (set-null, like the other
  // optional FKs). Owner = staff, matching `companies.ownerId`.
  ownerId: text().references(() => staff.id, { onDelete: "set null" }),

  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// --- Row types -------------------------------------------------------------

export type Company = InferSelectModel<typeof companies>;
export type Contact = InferSelectModel<typeof contacts>;
