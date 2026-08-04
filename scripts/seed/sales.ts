import type { InferInsertModel } from "drizzle-orm";
import { LINE_OF_BUSINESS } from "@/lib/crm/line-of-business";
import {
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STATUSES,
  type OpportunityStatus,
} from "@/lib/crm/opportunity";
import { isClosedStatus } from "@/lib/crm/opportunity-close";
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
import { parseIsoDate } from "@/lib/format/format";
import {
  currentMonthStart,
  currentWeekStart,
} from "@/lib/timesheets/timesheet-week";
import type { SeedDb } from "./client";
import { faker } from "./faker";

type OpportunityInsert = InferInsertModel<typeof opportunities>;
type OwnerInsert = InferInsertModel<typeof opportunityOwners>;
type ContactLinkInsert = InferInsertModel<typeof opportunityContacts>;
type SourceContactInsert = InferInsertModel<typeof opportunitySourceContacts>;
type SourceStaffInsert = InferInsertModel<typeof opportunitySourceStaff>;

/** How many of each closed status land inside this week, and inside this month. */
const CLOSED_THIS_WEEK = 4;
const CLOSED_THIS_MONTH = 6;

/**
 * A closed deal's `closedAt`, spread so the home dashboard's "closed this
 * week/month" figures are both non-empty but not saturated: the first few land
 * inside the current week, the next few earlier in the current month, the rest
 * anywhere in the row's own history. Open statuses get null — which is not
 * cosmetic, `opportunities_closed_at_shape` rejects anything else.
 *
 * Index `0` of each closed status is **forced** onto the Monday the week starts,
 * because a Monday-start week can begin in the *previous* month: that deal is then
 * inside "this week" and outside "this month", which is the one case where the two
 * figures are not nested and the labels have to say so. A random spread would
 * usually miss it.
 *
 * Never before `createdAt` — a deal can't be decided before it existed.
 */
function closedAtForSeed(
  status: OpportunityStatus,
  index: number,
  createdAt: Date,
): Date | null {
  if (!isClosedStatus(status)) return null;

  const weekStart = parseIsoDate(currentWeekStart());
  const monthStart = parseIsoDate(currentMonthStart());
  const now = new Date();

  const at =
    index === 0
      ? weekStart
      : index <= CLOSED_THIS_WEEK
        ? faker.date.between({ from: weekStart, to: now })
        : index <= CLOSED_THIS_WEEK + CLOSED_THIS_MONTH
          ? faker.date.between({
              from: monthStart,
              // `monthStart` can post-date `weekStart`; clamp so `from <= to`.
              to: monthStart < weekStart ? weekStart : now,
            })
          : faker.date.between({ from: createdAt, to: now });

  return at < createdAt ? createdAt : at;
}

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
      const closedAt = closedAtForSeed(status, i, createdAt);
      // `updatedAt` sits after the close, so the row reads as "decided, then
      // last touched" rather than the impossible reverse.
      const updatedAt = faker.date.between({
        from: closedAt ?? createdAt,
        to: new Date(),
      });
      rows.push({
        id: generateId("opp"),
        name: `${company.name} — ${faker.commerce.productName()}`,
        companyId: company.id,
        source: faker.helpers.arrayElement(OPPORTUNITY_SOURCES),
        status,
        lineOfBusiness: faker.helpers.arrayElement(LINE_OF_BUSINESS),
        position: position++,
        createdAt,
        closedAt,
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
