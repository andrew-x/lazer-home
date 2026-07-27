import type { InferInsertModel } from "drizzle-orm";
import { generateId } from "@/lib/db/ids";
import {
  type Company,
  type Contact,
  companyEntries,
  contactEntries,
  type Opportunity,
  opportunityEntries,
  type Staff,
} from "@/lib/db/schema";
import type { SeedDb } from "./client";
import { faker } from "./faker";

type ContactEntryInsert = InferInsertModel<typeof contactEntries>;
type OpportunityEntryInsert = InferInsertModel<typeof opportunityEntries>;
type CompanyEntryInsert = InferInsertModel<typeof companyEntries>;

/** A single synthetic note entry (a paragraph of prose). */
function makeEntry(idPrefix: string, staff: Staff[]) {
  // Pin `updatedAt` to `createdAt` so a freshly-seeded entry reads as un-edited:
  // `updatedAt` defaults to `now()`, which would otherwise beat the backdated
  // `createdAt` and make every entry show the "edited" tag.
  const createdAt = faker.date.recent({ days: 60 });
  return {
    id: generateId(idPrefix),
    body: faker.lorem.paragraph(),
    authorStaffId: faker.helpers.arrayElement(staff).id,
    createdAt,
    updatedAt: createdAt,
  };
}

/**
 * Seed timestamped notes across contacts, opportunities, and companies. Each
 * parent gets a handful of notes, authored by random staff and dated within the
 * last couple of months so the logs read as a real history. (Next steps were
 * replaced by the `tasks` entity — see `seedTasks`.)
 */
export async function seedEntries(
  db: SeedDb,
  contacts: Contact[],
  opportunities: Opportunity[],
  companies: Company[],
  staff: Staff[],
): Promise<{
  contactEntries: number;
  opportunityEntries: number;
  companyEntries: number;
}> {
  const contactRows: ContactEntryInsert[] = [];
  for (const contact of contacts) {
    const count = faker.number.int({ min: 0, max: 4 });
    for (let i = 0; i < count; i++) {
      contactRows.push({
        ...makeEntry("centry", staff),
        contactId: contact.id,
      });
    }
  }

  const opportunityRows: OpportunityEntryInsert[] = [];
  for (const opportunity of opportunities) {
    const count = faker.number.int({ min: 0, max: 4 });
    for (let i = 0; i < count; i++) {
      opportunityRows.push({
        ...makeEntry("oentry", staff),
        opportunityId: opportunity.id,
      });
    }
  }

  const companyRows: CompanyEntryInsert[] = [];
  for (const company of companies) {
    const count = faker.number.int({ min: 0, max: 4 });
    for (let i = 0; i < count; i++) {
      companyRows.push({
        ...makeEntry("coentry", staff),
        companyId: company.id,
      });
    }
  }

  if (contactRows.length > 0)
    await db.insert(contactEntries).values(contactRows);
  if (opportunityRows.length > 0)
    await db.insert(opportunityEntries).values(opportunityRows);
  if (companyRows.length > 0)
    await db.insert(companyEntries).values(companyRows);

  return {
    contactEntries: contactRows.length,
    opportunityEntries: opportunityRows.length,
    companyEntries: companyRows.length,
  };
}
