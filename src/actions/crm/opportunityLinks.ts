import type { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import {
  opportunityContacts,
  opportunityOwners,
  opportunitySourceContacts,
  opportunitySourceStaff,
} from "@/lib/db/schema";

/** The Drizzle transaction handle passed to a `db.transaction` callback. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type OpportunityLinkIds = {
  contactIds: string[];
  ownerIds: string[];
  sourceContactIds: string[];
  sourceStaffIds: string[];
};

/**
 * Insert an opportunity's four people-junction rows in one transaction, deduping
 * each id list first so a duplicate can't trip a junction unique index. Shared by
 * `createOpportunity` (fresh insert) and `updateOpportunity` (after it deletes the
 * existing rows), so the two always write the identical junction shape.
 */
export async function writeOpportunityLinks(
  tx: Tx,
  opportunityId: string,
  {
    contactIds,
    ownerIds,
    sourceContactIds,
    sourceStaffIds,
  }: OpportunityLinkIds,
) {
  const contacts = [...new Set(contactIds)];
  const owners = [...new Set(ownerIds)];
  const sourceContacts = [...new Set(sourceContactIds)];
  const sourceStaff = [...new Set(sourceStaffIds)];

  if (contacts.length > 0) {
    await tx.insert(opportunityContacts).values(
      contacts.map((contactId) => ({
        id: generateId("opp-contact"),
        opportunityId,
        contactId,
      })),
    );
  }

  if (owners.length > 0) {
    await tx.insert(opportunityOwners).values(
      owners.map((staffId) => ({
        id: generateId("opp-owner"),
        opportunityId,
        staffId,
      })),
    );
  }

  if (sourceContacts.length > 0) {
    await tx.insert(opportunitySourceContacts).values(
      sourceContacts.map((contactId) => ({
        id: generateId("opp-src-contact"),
        opportunityId,
        contactId,
      })),
    );
  }

  if (sourceStaff.length > 0) {
    await tx.insert(opportunitySourceStaff).values(
      sourceStaff.map((staffId) => ({
        id: generateId("opp-src-staff"),
        opportunityId,
        staffId,
      })),
    );
  }
}
