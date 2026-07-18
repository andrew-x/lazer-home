import { eq } from "drizzle-orm";
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

// --- Per-junction inserts --------------------------------------------------
// Each dedupes its id list first (so a duplicate can't trip the junction's
// unique index) and skips the insert when empty. The single insert
// implementation per junction is shared by the full write (`writeOpportunityLinks`)
// and the per-junction replace helpers below, so they can't drift.

async function insertOpportunityContacts(
  tx: Tx,
  opportunityId: string,
  contactIds: string[],
) {
  const ids = [...new Set(contactIds)];
  if (ids.length === 0) return;
  await tx.insert(opportunityContacts).values(
    ids.map((contactId) => ({
      id: generateId("opp-contact"),
      opportunityId,
      contactId,
    })),
  );
}

async function insertOpportunityOwners(
  tx: Tx,
  opportunityId: string,
  ownerIds: string[],
) {
  const ids = [...new Set(ownerIds)];
  if (ids.length === 0) return;
  await tx.insert(opportunityOwners).values(
    ids.map((staffId) => ({
      id: generateId("opp-owner"),
      opportunityId,
      staffId,
    })),
  );
}

async function insertOpportunitySourceContacts(
  tx: Tx,
  opportunityId: string,
  sourceContactIds: string[],
) {
  const ids = [...new Set(sourceContactIds)];
  if (ids.length === 0) return;
  await tx.insert(opportunitySourceContacts).values(
    ids.map((contactId) => ({
      id: generateId("opp-src-contact"),
      opportunityId,
      contactId,
    })),
  );
}

async function insertOpportunitySourceStaff(
  tx: Tx,
  opportunityId: string,
  sourceStaffIds: string[],
) {
  const ids = [...new Set(sourceStaffIds)];
  if (ids.length === 0) return;
  await tx.insert(opportunitySourceStaff).values(
    ids.map((staffId) => ({
      id: generateId("opp-src-staff"),
      opportunityId,
      staffId,
    })),
  );
}

/**
 * Insert an opportunity's four people-junction rows in one transaction. Shared by
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
  await insertOpportunityContacts(tx, opportunityId, contactIds);
  await insertOpportunityOwners(tx, opportunityId, ownerIds);
  await insertOpportunitySourceContacts(tx, opportunityId, sourceContactIds);
  await insertOpportunitySourceStaff(tx, opportunityId, sourceStaffIds);
}

// --- Per-junction replace --------------------------------------------------
// Clear one opportunity's rows in a single junction, then re-insert the given id
// set. The field-scoped `updateOpportunityField` uses these to rewrite only the
// junction a drawer edit touched, leaving the other three untouched (unlike the
// full `updateOpportunity`, which replaces all four).

export async function replaceOpportunityContacts(
  tx: Tx,
  opportunityId: string,
  contactIds: string[],
) {
  await tx
    .delete(opportunityContacts)
    .where(eq(opportunityContacts.opportunityId, opportunityId));
  await insertOpportunityContacts(tx, opportunityId, contactIds);
}

export async function replaceOpportunityOwners(
  tx: Tx,
  opportunityId: string,
  ownerIds: string[],
) {
  await tx
    .delete(opportunityOwners)
    .where(eq(opportunityOwners.opportunityId, opportunityId));
  await insertOpportunityOwners(tx, opportunityId, ownerIds);
}

export async function replaceOpportunitySourceContacts(
  tx: Tx,
  opportunityId: string,
  sourceContactIds: string[],
) {
  await tx
    .delete(opportunitySourceContacts)
    .where(eq(opportunitySourceContacts.opportunityId, opportunityId));
  await insertOpportunitySourceContacts(tx, opportunityId, sourceContactIds);
}

export async function replaceOpportunitySourceStaff(
  tx: Tx,
  opportunityId: string,
  sourceStaffIds: string[],
) {
  await tx
    .delete(opportunitySourceStaff)
    .where(eq(opportunitySourceStaff.opportunityId, opportunityId));
  await insertOpportunitySourceStaff(tx, opportunityId, sourceStaffIds);
}
