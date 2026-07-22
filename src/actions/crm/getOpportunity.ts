import "server-only";

import { asc, eq } from "drizzle-orm";
import { contactNameSql } from "@/actions/shared/contactName";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import type {
  OpportunitySource,
  OpportunityStatus,
} from "@/lib/crm/opportunity";
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
import type { EntryView } from "./entryViews";
import { getOpportunityEntries } from "./entryViews";

/** A picked entity, shaped for the drawer's comboboxes. */
export type EntityRef = { id: string; name: string };

export type OpportunityDetail = {
  id: string;
  name: string;
  company: EntityRef;
  lineOfBusiness: LineOfBusiness;
  source: OpportunitySource;
  status: OpportunityStatus;
  contacts: EntityRef[];
  owners: EntityRef[];
  sourceContacts: EntityRef[];
  sourceStaff: EntityRef[];
  /** The single project that delivers this opportunity, or null if none yet. */
  project: EntityRef | null;
  /** Timestamped notes, newest first. */
  notes: EntryView[];
  /** Timestamped next steps, newest first. */
  nextSteps: EntryView[];
};

const contactName = contactNameSql(contacts);

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
      lineOfBusiness: opportunities.lineOfBusiness,
      source: opportunities.source,
      status: opportunities.status,
      // The delivery link now lives on the opportunity (many-to-one). Left-join
      // the project so an unlinked opportunity still returns its base row.
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(opportunities)
    .innerJoin(companies, eq(opportunities.companyId, companies.id))
    .leftJoin(projects, eq(opportunities.projectId, projects.id))
    .where(eq(opportunities.id, id))
    .limit(1);

  if (!base) return null;

  const [contactRows, ownerRows, srcContactRows, srcStaffRows, entries] =
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
      getOpportunityEntries(id),
    ]);

  return {
    id: base.id,
    name: base.name,
    company: { id: base.companyId, name: base.companyName },
    lineOfBusiness: base.lineOfBusiness,
    source: base.source,
    status: base.status,
    contacts: contactRows,
    owners: ownerRows,
    sourceContacts: srcContactRows,
    sourceStaff: srcStaffRows,
    project:
      base.projectId && base.projectName
        ? { id: base.projectId, name: base.projectName }
        : null,
    notes: entries.notes,
    nextSteps: entries.nextSteps,
  };
}
