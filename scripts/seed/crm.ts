import type { InferInsertModel } from "drizzle-orm";
import { cityLabelsForCountries } from "@/lib/cities/cities";
import { generateId } from "@/lib/db/ids";
import {
  type Company,
  type Contact,
  companies,
  contacts,
  type Staff,
} from "@/lib/db/schema";
import type { SeedDb } from "./client";
import { chance, faker } from "./faker";

const COMPANY_COUNT = 20;
const CONTACT_COUNT = 40;

// Seeded locations focus on US & Canada, drawn from the static world-cities list
// so every seeded value is one the location picker would actually offer.
const US_CA_CITIES = cityLabelsForCountries(["US", "CA"]);

type CompanyInsert = InferInsertModel<typeof companies>;
type ContactInsert = InferInsertModel<typeof contacts>;

export type CrmResult = { companies: Company[]; contacts: Contact[] };

/** Seed companies (some partners, some owned by staff) and their contacts. */
export async function seedCrm(db: SeedDb, staff: Staff[]): Promise<CrmResult> {
  const companyRows: CompanyInsert[] = Array.from(
    { length: COMPANY_COUNT },
    () => ({
      id: generateId("company"),
      name: faker.company.name(),
      websiteUrl: chance(0.8) ? faker.internet.url() : null,
      location: chance(0.8) ? faker.helpers.arrayElement(US_CA_CITIES) : null,
      isPartner: chance(0.25),
      ownerId: chance(0.7) ? faker.helpers.arrayElement(staff).id : null,
    }),
  );
  await db.insert(companies).values(companyRows);

  // Build contacts, then a second pass points some at a "lead" contact within
  // the SAME company (the app's rule: a manager is always a contact at the same
  // company). Self-ref resolves inside the single INSERT.
  const contactRows: ContactInsert[] = [];
  const byCompany = new Map<string, string[]>();

  for (let i = 0; i < CONTACT_COUNT; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const id = generateId("contact");
    const company = faker.helpers.arrayElement(companyRows);
    contactRows.push({
      id,
      firstName,
      lastName,
      email: `${firstName}.${lastName}.${i}@example.net`.toLowerCase(),
      phone: chance(0.6) ? faker.phone.number() : null,
      companyId: company.id,
      role: chance(0.8) ? faker.person.jobTitle() : null,
      linkedinUrl: chance(0.5) ? faker.internet.url() : null,
      location: chance(0.7) ? faker.helpers.arrayElement(US_CA_CITIES) : null,
      managerId: null,
      ownerId: chance(0.7) ? faker.helpers.arrayElement(staff).id : null,
      relationshipStrength: chance(0.85)
        ? faker.helpers.arrayElement([1, 2, 3, 4, 5])
        : null,
    });
    const peers = byCompany.get(company.id) ?? [];
    peers.push(id);
    byCompany.set(company.id, peers);
  }

  // For each contact, maybe report to an earlier peer at the same company.
  for (const contact of contactRows) {
    const peers = byCompany.get(contact.companyId as string) ?? [];
    const candidates = peers.filter((peerId) => peerId !== contact.id);
    if (candidates.length > 0 && chance(0.4)) {
      contact.managerId = faker.helpers.arrayElement(candidates);
    }
  }
  await db.insert(contacts).values(contactRows);

  return {
    companies: await db.query.companies.findMany(),
    contacts: await db.query.contacts.findMany(),
  };
}
