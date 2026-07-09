import type { InferSelectModel } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import {
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STATUSES,
} from "@/actions/crm/createOpportunity.schema";
import { staff } from "./staff-schema";

// ---------------------------------------------------------------------------
// CRM domain
//
// `companies` are the organisations we deal with — both clients and partners
// (`isPartner` distinguishes them). `contacts` are people, optionally attached
// to a company. `opportunities` are pipeline deals for a company, moving through
// stages; their people (contacts, owners, referral sources) are modelled with
// junction tables. See docs/domains/crm.md.
// ---------------------------------------------------------------------------

export const companies = pgTable("companies", {
  id: text().primaryKey(),
  name: text().notNull(),
  websiteUrl: text(),
  isPartner: boolean().notNull().default(false),

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

  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// --- Opportunities ---------------------------------------------------------

export const opportunitySourceEnum = pgEnum("opportunity_source", [
  ...OPPORTUNITY_SOURCES,
]);
export const opportunityStatusEnum = pgEnum("opportunity_status", [
  ...OPPORTUNITY_STATUSES,
]);

export const opportunities = pgTable(
  "opportunities",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    // A deal always belongs to a company. `restrict`: a company with live
    // opportunities can't be deleted (unlike contacts, whose company is optional
    // and set-null). See docs/domains/crm.md.
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    source: opportunitySourceEnum().notNull(),
    status: opportunityStatusEnum().notNull(),
    // Free-text "what happens next" note.
    nextSteps: text(),
    // Manual kanban ordering: a global fractional index. Cards in a column
    // (a status or a collapsed group) sort by `position` asc; a drag writes the
    // midpoint between its new neighbors, so a move updates just this one row.
    position: doublePrecision().notNull().default(0),

    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("opportunities_status_position_idx").on(t.status, t.position)],
);

// Junction tables link an opportunity to its people. Surrogate `text` PK (repo
// convention — no composite PKs), a unique on the FK pair for set-semantics, and
// an index on the non-opportunity FK for reverse lookups. Both FKs cascade: a
// link is meaningless without both endpoints.

export const opportunityContacts = pgTable(
  "opportunity_contacts",
  {
    id: text().primaryKey(),
    opportunityId: text()
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    contactId: text()
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (t) => [
    unique("opportunity_contacts_unique").on(t.opportunityId, t.contactId),
    index("opportunity_contacts_contact_idx").on(t.contactId),
  ],
);

export const opportunityOwners = pgTable(
  "opportunity_owners",
  {
    id: text().primaryKey(),
    opportunityId: text()
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    staffId: text()
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (t) => [
    unique("opportunity_owners_unique").on(t.opportunityId, t.staffId),
    index("opportunity_owners_staff_idx").on(t.staffId),
  ],
);

export const opportunitySourceContacts = pgTable(
  "opportunity_source_contacts",
  {
    id: text().primaryKey(),
    opportunityId: text()
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    contactId: text()
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (t) => [
    unique("opportunity_source_contacts_unique").on(
      t.opportunityId,
      t.contactId,
    ),
    index("opportunity_source_contacts_contact_idx").on(t.contactId),
  ],
);

export const opportunitySourceStaff = pgTable(
  "opportunity_source_staff",
  {
    id: text().primaryKey(),
    opportunityId: text()
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    staffId: text()
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (t) => [
    unique("opportunity_source_staff_unique").on(t.opportunityId, t.staffId),
    index("opportunity_source_staff_staff_idx").on(t.staffId),
  ],
);

// --- Row types -------------------------------------------------------------

export type Company = InferSelectModel<typeof companies>;
export type Contact = InferSelectModel<typeof contacts>;
export type Opportunity = InferSelectModel<typeof opportunities>;
export type OpportunityContact = InferSelectModel<typeof opportunityContacts>;
export type OpportunityOwner = InferSelectModel<typeof opportunityOwners>;
export type OpportunitySourceContact = InferSelectModel<
  typeof opportunitySourceContacts
>;
export type OpportunitySourceStaff = InferSelectModel<
  typeof opportunitySourceStaff
>;
