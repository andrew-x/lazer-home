import type { InferInsertModel } from "drizzle-orm";
import { cityLabelsForCountries } from "@/lib/cities/cities";
import { RELATIONSHIP_DESCRIPTION_SUGGESTIONS } from "@/lib/crm/company-contact-relationship";
import { CONTACT_RELATION_SUGGESTIONS } from "@/lib/crm/contact-relationship";
import { generateId } from "@/lib/db/ids";
import {
  type Company,
  type Contact,
  companies,
  companyContactRelationships,
  contactRelationships,
  contacts,
  type Staff,
} from "@/lib/db/schema";
import type { SeedDb } from "./client";
import { chance, faker } from "./faker";

const COMPANY_COUNT = 20;
const CONTACT_COUNT = 40;
/** Attempts, not rows — self-employer and duplicate pairs are skipped. */
const RELATIONSHIP_ATTEMPTS = 35;
/** Probability a contact reports to a colleague. */
const REPORTS_TO_CHANCE = 0.4;
/** Job-movers: pairs of records for the same person at two companies. */
const SUCCESSION_COUNT = 5;
/** Attempts, not rows — self and duplicate unordered pairs are skipped. */
const RELATED_ATTEMPTS = 14;

// Seeded locations focus on US & Canada, drawn from the static world-cities list
// so every seeded value is one the location picker would actually offer.
const US_CA_CITIES = cityLabelsForCountries(["US", "CA"]);

type CompanyInsert = InferInsertModel<typeof companies>;
type ContactInsert = InferInsertModel<typeof contacts>;
type RelationshipInsert = InferInsertModel<typeof companyContactRelationships>;
type ContactRelationshipInsert = InferInsertModel<typeof contactRelationships>;

export type CrmResult = {
  companies: Company[];
  contacts: Contact[];
  relationships: number;
  contactRelationships: number;
};

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

  const contactRows: ContactInsert[] = [];
  // Company id → the ids of its contacts, in creation order. The order matters:
  // the manager pass below only ever points at an *earlier* colleague, which makes
  // a reporting cycle structurally impossible.
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
      ownerId: chance(0.7) ? faker.helpers.arrayElement(staff).id : null,
      relationshipStrength: chance(0.85)
        ? faker.helpers.arrayElement([1, 2, 3, 4, 5])
        : null,
      isActive: true,
    });
    const peers = byCompany.get(company.id) ?? [];
    peers.push(id);
    byCompany.set(company.id, peers);
  }

  // --- contact ↔ contact relationships -------------------------------------
  // Every person-to-person link is a typed row now, so the generator has to honour
  // the same invariants the DB does: the four partial unique indexes will abort the
  // seed rather than silently dedupe.
  const contactRelationshipRows: ContactRelationshipInsert[] = [];

  // `reports_to` — a manager is always a colleague at the same company. Pointing
  // only at a *strictly earlier* peer keeps this a forest, so the cycle check in
  // `assertValidContactRelationship` can never be tripped by seeded data. (The old
  // `managerId` pass claimed to do this but filtered on self only, so A↔B pairs
  // were reachable — and one existed in the DB before this migration.)
  for (const contact of contactRows) {
    const peers = byCompany.get(contact.companyId as string) ?? [];
    const earlier = peers.slice(0, peers.indexOf(contact.id));
    if (earlier.length === 0 || !chance(REPORTS_TO_CHANCE)) continue;
    contactRelationshipRows.push({
      id: generateId("crel"),
      kind: "reports_to",
      contactId: contact.id,
      relatedContactId: faker.helpers.arrayElement(earlier),
      description: null,
    });
  }

  // `succeeds` — the job-mover case this feature exists for: the SAME person as two
  // records at two companies. The later record takes over the earlier one's name (a
  // new work email keeps it unique), the earlier one is marked former, and the pair
  // always spans two different companies. Indexing forward-only again rules out
  // cycles, and one predecessor/successor per record satisfies both uniques.
  const successors = new Set<string>();
  const predecessors = new Set<string>();
  for (let attempt = 0; attempt < SUCCESSION_COUNT * 4; attempt++) {
    if (predecessors.size >= SUCCESSION_COUNT) break;

    const newerIndex = faker.number.int({
      min: 1,
      max: contactRows.length - 1,
    });
    const olderIndex = faker.number.int({ min: 0, max: newerIndex - 1 });
    const newer = contactRows[newerIndex];
    const older = contactRows[olderIndex];
    if (newer.companyId === older.companyId) continue;
    // One predecessor per record, one successor per record — and keep the two roles
    // disjoint here so the seed stays a set of simple pairs rather than chains.
    if (successors.has(newer.id) || predecessors.has(newer.id)) continue;
    if (successors.has(older.id) || predecessors.has(older.id)) continue;
    successors.add(newer.id);
    predecessors.add(older.id);

    newer.firstName = older.firstName;
    newer.lastName = older.lastName;
    newer.email =
      `${older.firstName}.${older.lastName}.${newerIndex}@example.net`.toLowerCase();
    // Linking a successor is exactly what `createContactRelationship` does to the
    // predecessor, so the seed has to match or the two disagree.
    older.isActive = false;

    contactRelationshipRows.push({
      id: generateId("crel"),
      kind: "succeeds",
      contactId: newer.id,
      relatedContactId: older.id,
      description: null,
    });
  }

  // `related` — symmetric, free text. Deduped on the *unordered* pair, because
  // that's what `contact_relationships_related_uq` keys on.
  const seenRelatedPairs = new Set<string>();
  for (let attempt = 0; attempt < RELATED_ATTEMPTS; attempt++) {
    const a = faker.helpers.arrayElement(contactRows);
    const b = faker.helpers.arrayElement(contactRows);
    if (a.id === b.id) continue;
    const pair = [a.id, b.id].sort().join(":");
    if (seenRelatedPairs.has(pair)) continue;
    seenRelatedPairs.add(pair);

    contactRelationshipRows.push({
      id: generateId("crel"),
      kind: "related",
      contactId: a.id,
      relatedContactId: b.id,
      description: faker.helpers.arrayElement([
        ...CONTACT_RELATION_SUGGESTIONS,
      ]),
    });
  }

  await db.insert(contacts).values(contactRows);
  if (contactRelationshipRows.length > 0) {
    await db.insert(contactRelationships).values(contactRelationshipRows);
  }

  // Non-employee links: a partner's CSM on one of our accounts, an FDE, a former
  // employee. Biased toward partner companies on the contact side so the seed
  // reads like the case this models. Skips a contact's own employer (the app
  // rejects it) and repeat pairs (the unique index).
  const partnerCompanies = companyRows.filter((row) => row.isPartner);
  const relationshipRows: RelationshipInsert[] = [];
  const seenPairs = new Set<string>();

  for (let i = 0; i < RELATIONSHIP_ATTEMPTS; i++) {
    const company = faker.helpers.arrayElement(companyRows);
    // Prefer someone from a partner company as the related person.
    const pool =
      partnerCompanies.length > 0 && chance(0.7)
        ? contactRows.filter((row) =>
            partnerCompanies.some((partner) => partner.id === row.companyId),
          )
        : contactRows;
    if (pool.length === 0) continue;

    const contact = faker.helpers.arrayElement(pool);
    const pair = `${company.id}:${contact.id}`;
    if (contact.companyId === company.id || seenPairs.has(pair)) continue;
    seenPairs.add(pair);

    relationshipRows.push({
      id: generateId("ccrel"),
      companyId: company.id,
      contactId: contact.id,
      description: faker.helpers.arrayElement([
        ...RELATIONSHIP_DESCRIPTION_SUGGESTIONS,
      ]),
    });
  }
  if (relationshipRows.length > 0) {
    await db.insert(companyContactRelationships).values(relationshipRows);
  }

  return {
    companies: await db.query.companies.findMany(),
    contacts: await db.query.contacts.findMany(),
    relationships: relationshipRows.length,
    contactRelationships: contactRelationshipRows.length,
  };
}
