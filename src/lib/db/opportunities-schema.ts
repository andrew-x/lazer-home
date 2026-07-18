import type { InferSelectModel } from "drizzle-orm";
import {
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { OPPORTUNITY_SOURCES, OPPORTUNITY_STATUSES } from "@/lib/opportunity";
import { companies, contacts, crmEntryKind } from "./crm-schema";
import { lineOfBusinessEnum, staff } from "./staff-schema";

// ---------------------------------------------------------------------------
// Opportunities (CRM pipeline)
//
// `opportunities` are pipeline deals for a company, moving through stages and
// carrying a line of business. Their people (contacts, owners, referral
// sources) are modelled with junction tables. Split out of `crm-schema.ts` so
// companies/contacts and the pipeline live in focused files. See
// docs/domains/crm.md.
// ---------------------------------------------------------------------------

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
    // The line of business this deal belongs to. A project created from this
    // opportunity defaults to the same line of business. Shared/global enum
    // (see `lineOfBusinessEnum`).
    lineOfBusiness: lineOfBusinessEnum().notNull(),
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

// Timestamped notes & next steps for an opportunity — the pipeline counterpart
// to `contactEntries` (see crm-schema.ts). Shares the `crm_entry_kind` enum;
// cascade FK so entries die with the deal. Author = staff, set-null on removal.
export const opportunityEntries = pgTable(
  "opportunity_entries",
  {
    id: text().primaryKey(),
    opportunityId: text()
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    kind: crmEntryKind().notNull(),
    body: text().notNull(),
    authorStaffId: text().references(() => staff.id, { onDelete: "set null" }),

    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("opportunity_entries_opp_kind_created_idx").on(
      t.opportunityId,
      t.kind,
      t.createdAt,
    ),
  ],
);

// --- Row types -------------------------------------------------------------

export type Opportunity = InferSelectModel<typeof opportunities>;
export type OpportunityEntry = InferSelectModel<typeof opportunityEntries>;
