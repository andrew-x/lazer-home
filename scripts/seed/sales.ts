import type { InferInsertModel } from "drizzle-orm";
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
import { LINE_OF_BUSINESS } from "@/lib/line-of-business";
import { OPPORTUNITY_SOURCES, OPPORTUNITY_STATUSES } from "@/lib/opportunity";
import type { SeedDb } from "./client";
import { chance, faker } from "./faker";

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

  // At least two per status → ≥28 opportunities, every column populated.
  let position = 1;
  for (const status of OPPORTUNITY_STATUSES) {
    for (let i = 0; i < 2; i++) {
      const company = faker.helpers.arrayElement(companies);
      rows.push({
        id: generateId("opp"),
        name: `${company.name} — ${faker.commerce.productName()}`,
        companyId: company.id,
        source: faker.helpers.arrayElement(OPPORTUNITY_SOURCES),
        status,
        lineOfBusiness: faker.helpers.arrayElement(LINE_OF_BUSINESS),
        nextSteps: chance(0.7) ? faker.lorem.sentence() : null,
        position: position++,
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
