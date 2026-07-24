import type { InferInsertModel } from "drizzle-orm";
import { LINE_OF_BUSINESS } from "@/lib/crm/line-of-business";
import {
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STATUSES,
  type OpportunityStatus,
} from "@/lib/crm/opportunity";
import {
  BOARD_COLUMN_CAP,
  CAPPED_BOARD_STATUSES,
} from "@/lib/crm/opportunity-pipeline";
import { generateId } from "@/lib/db/ids";
import {
  type Company,
  type Contact,
  type Opportunity,
  opportunities,
  opportunityContacts,
  opportunityOwners,
  opportunitySourceContacts,
  opportunitySourceStaff,
  type Staff,
} from "@/lib/db/schema";
import type { SeedDb } from "./client";
import { faker } from "./faker";

type OpportunityInsert = InferInsertModel<typeof opportunities>;
type OwnerInsert = InferInsertModel<typeof opportunityOwners>;
type ContactLinkInsert = InferInsertModel<typeof opportunityContacts>;
type SourceContactInsert = InferInsertModel<typeof opportunitySourceContacts>;
type SourceStaffInsert = InferInsertModel<typeof opportunitySourceStaff>;

/**
 * Seed opportunities spread across EVERY pipeline stage (so the kanban has a card
 * in each column), plus owner / contact / referral-source junction rows.
 */
export async function seedOpportunities(
  db: SeedDb,
  companies: Company[],
  contacts: Contact[],
  staff: Staff[],
): Promise<Opportunity[]> {
  const rows: OpportunityInsert[] = [];
  const contactsByCompany = new Map<string, Contact[]>();
  for (const contact of contacts) {
    if (!contact.companyId) continue;
    const list = contactsByCompany.get(contact.companyId) ?? [];
    list.push(contact);
    contactsByCompany.set(contact.companyId, list);
  }

  // Every column gets a couple of cards; the capped columns
  // (`CAPPED_BOARD_STATUSES`) get more than `BOARD_COLUMN_CAP` so the board
  // truncates them, surfaces a "Show more" link, and the list view has multiple
  // pages to browse. Derived from the cap so this stays correct if it changes.
  const capped = new Set<OpportunityStatus>(CAPPED_BOARD_STATUSES);
  const countFor = (status: OpportunityStatus) =>
    capped.has(status) ? BOARD_COLUMN_CAP + 5 : 2;

  let position = 1;
  for (const status of OPPORTUNITY_STATUSES) {
    for (let i = 0; i < countFor(status); i++) {
      const company = faker.helpers.arrayElement(companies);
      // Spread timestamps over the past few months so the capped columns'
      // "most recent" (updatedAt desc) selection is meaningful and the list's
      // "Last updated" column varies. `updatedAt` is never before `createdAt`.
      const createdAt = faker.date.recent({ days: 180 });
      const updatedAt = faker.date.between({ from: createdAt, to: new Date() });
      rows.push({
        id: generateId("opp"),
        name: `${company.name} — ${faker.commerce.productName()}`,
        companyId: company.id,
        source: faker.helpers.arrayElement(OPPORTUNITY_SOURCES),
        status,
        lineOfBusiness: faker.helpers.arrayElement(LINE_OF_BUSINESS),
        position: position++,
        createdAt,
        updatedAt,
      });
    }
  }
  await db.insert(opportunities).values(rows);

  const owners: OwnerInsert[] = [];
  const linkedContacts: ContactLinkInsert[] = [];
  const sourceContacts: SourceContactInsert[] = [];
  const sourceStaff: SourceStaffInsert[] = [];

  for (const opp of rows) {
    // 1–2 distinct owners (arrayElements returns distinct picks → no dup pairs).
    for (const s of faker.helpers.arrayElements(
      staff,
      faker.number.int({ min: 1, max: 2 }),
    )) {
      owners.push({
        id: generateId("oppown"),
        opportunityId: opp.id,
        staffId: s.id,
      });
    }
    // 1–2 contacts, preferring people at the deal's company.
    const pool = contactsByCompany.get(opp.companyId) ?? contacts;
    for (const c of faker.helpers.arrayElements(
      pool,
      faker.number.int({ min: 1, max: 2 }),
    )) {
      linkedContacts.push({
        id: generateId("oppcon"),
        opportunityId: opp.id,
        contactId: c.id,
      });
    }
    // Referral source, matching the source type where it makes sense.
    if (opp.source === "contact_referral") {
      sourceContacts.push({
        id: generateId("oppsrc"),
        opportunityId: opp.id,
        contactId: faker.helpers.arrayElement(contacts).id,
      });
    } else if (opp.source === "staff_referral") {
      sourceStaff.push({
        id: generateId("oppsrc"),
        opportunityId: opp.id,
        staffId: faker.helpers.arrayElement(staff).id,
      });
    }
  }

  await db.insert(opportunityOwners).values(owners);
  if (linkedContacts.length > 0)
    await db.insert(opportunityContacts).values(linkedContacts);
  if (sourceContacts.length > 0)
    await db.insert(opportunitySourceContacts).values(sourceContacts);
  if (sourceStaff.length > 0)
    await db.insert(opportunitySourceStaff).values(sourceStaff);

  return db.query.opportunities.findMany();
}
