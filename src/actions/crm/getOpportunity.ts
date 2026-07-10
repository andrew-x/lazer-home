import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/db";
import {
  companies,
  contacts,
  opportunities,
  opportunityContacts,
  opportunityOwners,
  opportunitySourceContacts,
  opportunitySourceStaff,
  projects,
  staff,
} from "@/lib/db/schema";
import type {
  OpportunitySource,
  OpportunityStatus,
} from "./createOpportunity.schema";

/** A picked entity, shaped for the drawer's comboboxes. */
export type EntityRef = { id: string; name: string };

export type OpportunityDetail = {
  id: string;
  name: string;
  company: EntityRef;
  source: OpportunitySource;
  status: OpportunityStatus;
  nextSteps: string | null;
  contacts: EntityRef[];
  owners: EntityRef[];
  sourceContacts: EntityRef[];
  sourceStaff: EntityRef[];
  projects: EntityRef[];
};

const contactName = sql<string>`${contacts.firstName} || ' ' || ${contacts.lastName}`;

/**
 * The full detail for one opportunity — its core fields, company, the four
 * people junctions as `{ id, name }[]` (shaped for the drawer's comboboxes), and
 * its linked projects. Returns null if the id is unknown. Reads go through the
 * actions layer; the drawer consumes this directly.
 */
export async function getOpportunity(
  id: string,
): Promise<OpportunityDetail | null> {
  const [base] = await db
    .select({
      id: opportunities.id,
      name: opportunities.name,
      companyId: opportunities.companyId,
      companyName: companies.name,
      source: opportunities.source,
      status: opportunities.status,
      nextSteps: opportunities.nextSteps,
    })
    .from(opportunities)
    .innerJoin(companies, eq(opportunities.companyId, companies.id))
    .where(eq(opportunities.id, id))
    .limit(1);

  if (!base) return null;

  const [contactRows, ownerRows, srcContactRows, srcStaffRows, projectRows] =
    await Promise.all([
      db
        .select({ id: contacts.id, name: contactName })
        .from(opportunityContacts)
        .innerJoin(contacts, eq(opportunityContacts.contactId, contacts.id))
        .where(eq(opportunityContacts.opportunityId, id))
        .orderBy(asc(contacts.firstName)),
      db
        .select({ id: staff.id, name: staff.name })
        .from(opportunityOwners)
        .innerJoin(staff, eq(opportunityOwners.staffId, staff.id))
        .where(eq(opportunityOwners.opportunityId, id))
        .orderBy(asc(staff.name)),
      db
        .select({ id: contacts.id, name: contactName })
        .from(opportunitySourceContacts)
        .innerJoin(
          contacts,
          eq(opportunitySourceContacts.contactId, contacts.id),
        )
        .where(eq(opportunitySourceContacts.opportunityId, id))
        .orderBy(asc(contacts.firstName)),
      db
        .select({ id: staff.id, name: staff.name })
        .from(opportunitySourceStaff)
        .innerJoin(staff, eq(opportunitySourceStaff.staffId, staff.id))
        .where(eq(opportunitySourceStaff.opportunityId, id))
        .orderBy(asc(staff.name)),
      db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(eq(projects.opportunityId, id))
        .orderBy(asc(projects.createdAt)),
    ]);

  return {
    id: base.id,
    name: base.name,
    company: { id: base.companyId, name: base.companyName },
    source: base.source,
    status: base.status,
    nextSteps: base.nextSteps,
    contacts: contactRows,
    owners: ownerRows,
    sourceContacts: srcContactRows,
    sourceStaff: srcStaffRows,
    projects: projectRows,
  };
}
