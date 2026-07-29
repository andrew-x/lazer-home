import type { InferSelectModel } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
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
  // Optional home base as a free-text "City, CC" label (e.g. "Toronto, CA"),
  // picked from the static world-cities list (`@/lib/cities`). Free text, not a
  // FK/enum — see docs/data-model.md. Null when unknown.
  location: text(),
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
  // Optional home base as a free-text "City, CC" label (e.g. "Toronto, CA"),
  // picked from the static world-cities list (`@/lib/cities`). Free text, not a
  // FK/enum — see docs/data-model.md. Null when unknown.
  location: text(),
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
  // How strong our relationship with this contact is, on a 1–5 scale (1 New /
  // Unestablished … 5 Champion / Trusted Partner — see
  // `@/lib/crm/relationship-strength`). Null when not yet rated. Edited inline
  // (stars) on the contact
  // page via `updateContactField`.
  relationshipStrength: integer(),

  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// ---------------------------------------------------------------------------
// Non-employee company ↔ contact relationships
//
// `contacts.companyId` is the single *employer* FK. This table models the other
// way a person can attach to a company: a partner company's CSM working on one of
// our accounts, an embedded FDE, a former employee, an investor on the board.
//
// A **data-carrying** junction (it holds `description`), so it follows the FK and
// index halves of the junction convention (ADR 0016) like `projectRoles`, while
// keeping the `unique()` pair — one relationship per company/contact, so editing
// the description is unambiguous. See docs/domains/crm.md.
// ---------------------------------------------------------------------------

export const companyContactRelationships = pgTable(
  "company_contact_relationships",
  {
    id: text().primaryKey(),
    // Both endpoints cascade: a link is meaningless without them. Deliberately
    // unlike `contacts.companyId`'s set-null — that's an optional attribute of a
    // contact, this is a row whose whole identity is the pair.
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    contactId: text()
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    // How this person relates to this company, e.g. "CSM". Free text, with UI
    // suggestions from `@/lib/crm/company-contact-relationship` — not a pgEnum,
    // because the label set is open-ended (same reasoning as `location`).
    description: text().notNull(),

    createdAt: timestamp().defaultNow().notNull(),
    // Unlike the pure junctions (createdAt only), this row is editable.
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    // Named explicitly so `isUniqueViolation(error, …)` can key off it and turn a
    // duplicate into "edit the existing one instead".
    unique("company_contact_relationships_unique").on(t.companyId, t.contactId),
    index("company_contact_relationships_contact_idx").on(t.contactId),
  ],
);

// ---------------------------------------------------------------------------
// Timestamped entries — notes
//
// Contacts, opportunities, and companies each carry a running, authored log of
// free-text notes ("what happened"). One table per parent entity (concrete FKs
// — no polymorphic FK). Notes are point-in-time and shown newest-first,
// mirroring the `feedback` table. (The old "next step" kind on these tables was
// replaced by the `tasks` entity — see tasks-schema.ts.) See docs/domains/crm.md.
// ---------------------------------------------------------------------------

export const contactEntries = pgTable(
  "contact_entries",
  {
    id: text().primaryKey(),
    contactId: text()
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    body: text().notNull(),
    // Who wrote it. Set-null so an entry survives the author's staff row being
    // removed (author attribution, not ownership). Author = staff, matching the
    // other people-FKs in this domain.
    authorStaffId: text().references(() => staff.id, { onDelete: "set null" }),

    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("contact_entries_contact_created_idx").on(t.contactId, t.createdAt),
  ],
);

export const companyEntries = pgTable(
  "company_entries",
  {
    id: text().primaryKey(),
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    body: text().notNull(),
    // Who wrote it. Set-null so an entry survives the author's staff row being
    // removed (author attribution, not ownership). Author = staff, matching the
    // other people-FKs in this domain.
    authorStaffId: text().references(() => staff.id, { onDelete: "set null" }),

    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("company_entries_company_created_idx").on(t.companyId, t.createdAt),
  ],
);

// --- Row types -------------------------------------------------------------

export type Company = InferSelectModel<typeof companies>;
export type Contact = InferSelectModel<typeof contacts>;
export type CompanyContactRelationship = InferSelectModel<
  typeof companyContactRelationships
>;
