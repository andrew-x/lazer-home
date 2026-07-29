import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { UserSafeActionError } from "@/lib/core/errors";
import type { ContactRelationshipKind } from "@/lib/crm/contact-relationship";
import type { db } from "@/lib/db/db";
import { isForeignKeyViolation } from "@/lib/db/foreign-key-violation";
import { contactRelationships, contacts } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/unique-violation";

/** `db` or a transaction handle — mirrors `confirmRolesOnWon`'s alias. */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Depth cap for the chain walks. A reporting line or succession chain is never
 * this deep, and the cap is load-bearing: pre-existing cyclic data (the old
 * `managerId` never had a cycle check — ADR 0022) would otherwise spin forever.
 */
const MAX_CHAIN_DEPTH = 32;

/** The companies of both endpoints, for revalidating the right company pages. */
export type RelationshipEndpointCompanies = {
  contactCompanyId: string | null;
  relatedCompanyId: string | null;
};

/**
 * Enforce the cross-row rules for a new contact ↔ contact relationship — the ones
 * a DB constraint can't express, because they reference *another* row.
 *
 * Cardinality ("one manager", "one predecessor", "one successor", "one `related`
 * link per pair") is deliberately NOT checked here: the partial unique indexes own
 * it, so it holds under concurrency. These checks are reads, so two simultaneous
 * requests can both pass them — run them inside the insert's transaction so they
 * at least share one snapshot, and let `mapContactRelationshipConflict` word
 * whatever the DB rejects.
 *
 * Returns both endpoints' companies so the caller can revalidate them.
 */
export async function assertValidContactRelationship(
  exec: Executor,
  {
    kind,
    contactId,
    relatedContactId,
  }: {
    kind: ContactRelationshipKind;
    contactId: string;
    relatedContactId: string;
  },
): Promise<RelationshipEndpointCompanies> {
  const rows = await exec
    .select({ id: contacts.id, companyId: contacts.companyId })
    .from(contacts)
    .where(inArray(contacts.id, [contactId, relatedContactId]));

  const contact = rows.find((row) => row.id === contactId);
  const related = rows.find((row) => row.id === relatedContactId);
  // Either endpoint could have been deleted between the picker and submit. The FK
  // is the race backstop; this is the readable message.
  if (!contact || !related) {
    throw new UserSafeActionError("That contact no longer exists.");
  }

  if (kind === "reports_to") {
    // The pre-existing manager rule, preserved verbatim from `assertValidManager`
    // (deleted with `contacts.managerId`): a manager is always a colleague, so
    // both sides need a company and it must be the same one.
    if (contact.companyId === null) {
      throw new UserSafeActionError("Set a company before choosing a manager.");
    }
    if (related.companyId !== contact.companyId) {
      throw new UserSafeActionError(
        "The manager must be a contact at the same company.",
      );
    }
  }

  if (kind === "succeeds") {
    // A succession exists *because* the person changed employers. Two records at
    // the same company aren't a succession, they're a duplicate contact — edit the
    // one record instead. A NULL company is permissive, not blocking: "employer
    // unknown" is not evidence of sameness (and this is the NULL trap
    // `searchContacts` documents — never compare nullable columns bare).
    if (
      contact.companyId !== null &&
      related.companyId !== null &&
      contact.companyId === related.companyId
    ) {
      throw new UserSafeActionError(
        "Both records show the same company — edit the existing contact instead of adding a successor.",
      );
    }
  }

  if (kind === "reports_to" || kind === "succeeds") {
    // Both directional kinds are single-outgoing-edge graphs (one manager, one
    // predecessor — enforced by their partial uniques), so one walk serves both.
    if (await chainReaches(exec, kind, relatedContactId, contactId)) {
      throw new UserSafeActionError(
        kind === "reports_to"
          ? "That would make the reporting line loop back on itself."
          : "That would make the succession chain loop back on itself.",
      );
    }
  }

  return {
    contactCompanyId: contact.companyId,
    relatedCompanyId: related.companyId,
  };
}

/**
 * Walk `kind`'s outgoing edges from `startId` looking for `targetId`. Each hop is
 * a single index lookup on that kind's partial unique, and real chains are 1–3
 * deep, so a bounded loop beats a `WITH RECURSIVE` (which this repo has no
 * precedent for).
 *
 * Exhausting the depth cap counts as "reachable": the only way to have that many
 * hops is data that already loops, and we refuse to add to it.
 */
async function chainReaches(
  exec: Executor,
  kind: ContactRelationshipKind,
  startId: string,
  targetId: string,
): Promise<boolean> {
  let cursor: string | null = startId;
  for (let hop = 0; hop < MAX_CHAIN_DEPTH; hop++) {
    if (cursor === null) return false;
    if (cursor === targetId) return true;

    const [next]: { id: string }[] = await exec
      .select({ id: contactRelationships.relatedContactId })
      .from(contactRelationships)
      .where(
        and(
          eq(contactRelationships.contactId, cursor),
          eq(contactRelationships.kind, kind),
        ),
      )
      .limit(1);
    cursor = next?.id ?? null;
  }
  return true;
}

/**
 * Map a `contact_relationships` constraint violation to a user-safe message;
 * rethrow anything else. Returns `never` — always throws — so callers can use it
 * as the whole body of a catch block (mirrors `mapContactEmailConflict`).
 *
 * The four unique names are the *partial indexes* from `crm-schema.ts`: Postgres
 * reports the index name in a 23505's constraint field, so each cardinality rule
 * gets its own precise wording.
 */
export function mapContactRelationshipConflict(error: unknown): never {
  if (isUniqueViolation(error, "contact_relationships_one_manager_uq")) {
    throw new UserSafeActionError(
      "This contact already has a manager — remove the current one first.",
    );
  }
  if (isUniqueViolation(error, "contact_relationships_one_predecessor_uq")) {
    throw new UserSafeActionError(
      "This contact is already linked to a previous record.",
    );
  }
  if (isUniqueViolation(error, "contact_relationships_one_successor_uq")) {
    throw new UserSafeActionError(
      "That contact is already succeeded by someone else.",
    );
  }
  if (isUniqueViolation(error, "contact_relationships_related_uq")) {
    throw new UserSafeActionError(
      "These contacts are already linked — edit the existing link instead.",
    );
  }
  if (isForeignKeyViolation(error)) {
    throw new UserSafeActionError("That contact no longer exists.");
  }
  throw error;
}
