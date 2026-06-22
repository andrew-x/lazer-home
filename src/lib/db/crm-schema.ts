import type { InferSelectModel } from "drizzle-orm";
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// CRM domain
//
// `companies` are the organisations we deal with — both clients and partners
// (`isPartner` distinguishes them). `contacts` are people, optionally attached
// to a company. This is the seed of the CRM domain; opportunities/pipeline and
// links to projects come later. See docs/domains/crm.md.
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

// --- Row types -------------------------------------------------------------

export type Company = InferSelectModel<typeof companies>;
export type Contact = InferSelectModel<typeof contacts>;
