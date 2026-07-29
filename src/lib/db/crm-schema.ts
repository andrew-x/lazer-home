import { type InferSelectModel, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { CONTACT_RELATIONSHIP_KINDS } from "@/lib/crm/contact-relationship";
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
  // Whether this is still someone we deal with. Mirrors `staff.isActive`. A
  // deactivated contact stays in the CRM for its history — old opportunities, notes,
  // and the `succeeds` chain pointing at it — but drops out of the default
  // contacts list and the pickers. Flipped automatically when a successor record
  // is linked (`createContactRelationship`), or by hand via the Status field in the
  // contact's edit dialog (`updateContact`). "Inactive" rather than "former"
  // because it also covers a record that's simply no longer relevant or valid —
  // see `@/lib/crm/contact-status`.
  isActive: boolean().notNull().default(true),

  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// ---------------------------------------------------------------------------
// Contact ↔ contact relationships
//
// ONE junction for every person-to-person link, typed by `kind` — replacing the
// old single-purpose `contacts.managerId` self-FK (ADR 0022, superseded):
//
//   reports_to — directional: `contactId` reports to `relatedContactId`, both at
//                the SAME company (the pre-existing manager rule). At most one
//                per contact; the reverse lookup is that contact's direct
//                reports, a capability `managerId` never had.
//   succeeds   — directional: `contactId` (the NEW record, at the new employer)
//                succeeds `relatedContactId` (the OLD record at the previous
//                one). The same human as two rows, so it's 1:1 in both
//                directions, and creating a link marks the predecessor inactive.
//   related    — SYMMETRIC, with a required free-text `description` ("Worked
//                together at Acme"). Stored once, read from either side.
//
// A data-carrying junction (it holds `description`), so it follows the FK and
// index halves of the junction convention (ADR 0016) like
// `companyContactRelationships`. The cardinality rules are PARTIAL unique
// indexes, which a table-level `unique()` cannot express — see below.
// See docs/domains/crm.md.
// ---------------------------------------------------------------------------

// A closed set the code branches on — different cardinality, different
// validation, a different read bucket and a side effect per kind — so a pgEnum,
// unlike the open-ended `description`/`role`/`location` text columns. Values come
// from the pure module so the enum, the zod union and the labels can't drift.
export const contactRelationshipKindEnum = pgEnum("contact_relationship_kind", [
  ...CONTACT_RELATIONSHIP_KINDS,
]);

export const contactRelationships = pgTable(
  "contact_relationships",
  {
    id: text().primaryKey(),
    kind: contactRelationshipKindEnum().notNull(),
    // Both endpoints cascade: a link is meaningless without them. Deliberately
    // unlike the old `managerId`'s set-null — that was an optional *attribute* of
    // a contact, this is a row whose whole identity is the pair.
    contactId: text()
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    relatedContactId: text()
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    // Required for `related`, NULL for the two directional kinds — the zod
    // discriminated union owns the message, the CHECK below owns the invariant.
    description: text(),

    createdAt: timestamp().defaultNow().notNull(),
    // Editable (a `related` description can be reworded), like
    // `companyContactRelationships` and unlike the pure junctions.
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    // --- invariants that hold for every kind --------------------------------
    check(
      "contact_relationships_no_self",
      sql`${t.contactId} <> ${t.relatedContactId}`,
    ),
    // `description` belongs to `related` and only to `related`, both directions
    // in one expression (`kind` is notNull, so this is never NULL/unknown).
    check(
      "contact_relationships_description_kind",
      sql`(${t.kind} = 'related') = (${t.description} is not null)`,
    ),

    // --- cardinality --------------------------------------------------------
    // Partial uniques, because a Postgres table constraint can't carry a WHERE.
    // Named explicitly so `isUniqueViolation(error, …)` can turn each into its
    // own precise message: Postgres reports the INDEX name in a 23505's
    // constraint field, exactly as it does for a table-level `unique()`.
    //
    // These are what actually make "at most one" true — the app-level checks in
    // `contactRelationshipChecks.ts` are reads, so two concurrent writes can both
    // pass them. Enum literals are inlined rather than interpolated: drizzle-kit
    // serialises an index's `where` through `sqlToQuery`, so a bound value would
    // become a `$1` placeholder and emit broken DDL.
    uniqueIndex("contact_relationships_one_manager_uq")
      .on(t.contactId)
      .where(sql`${t.kind} = 'reports_to'`),
    uniqueIndex("contact_relationships_one_predecessor_uq")
      .on(t.contactId)
      .where(sql`${t.kind} = 'succeeds'`),
    uniqueIndex("contact_relationships_one_successor_uq")
      .on(t.relatedContactId)
      .where(sql`${t.kind} = 'succeeds'`),
    // `related` is symmetric, so (A,B) and (B,A) are the SAME link. Canonicalise
    // in the index rather than in the writer, so the invariant can't be
    // forgotten and can't race. `least`/`greatest` over text reduce to the type's
    // btree comparator, so they're immutable and index-legal.
    uniqueIndex("contact_relationships_related_uq")
      .on(
        sql`least(${t.contactId}, ${t.relatedContactId})`,
        sql`greatest(${t.contactId}, ${t.relatedContactId})`,
      )
      .where(sql`${t.kind} = 'related'`),

    // --- read paths ---------------------------------------------------------
    // The detail read is one query with `contact_id = $1 OR related_contact_id =
    // $1`, which the planner serves as a BitmapOr of these two. Both are needed:
    // the partial uniques above cover only subsets of the table, so neither
    // doubles as a general-purpose index on either column.
    index("contact_relationships_contact_idx").on(t.contactId),
    index("contact_relationships_related_contact_idx").on(t.relatedContactId),

    // Deliberately NO `unique(contactId, relatedContactId, kind)`: the four
    // partial uniques already reject every duplicate (an exact `reports_to`
    // repeat trips the manager index, a reversed `related` trips the symmetric
    // one), and adding it would only muddy which name a violation reports.
  ],
);

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
export type ContactRelationship = InferSelectModel<typeof contactRelationships>;
export type CompanyContactRelationship = InferSelectModel<
  typeof companyContactRelationships
>;
