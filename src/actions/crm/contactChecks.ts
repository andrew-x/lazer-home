import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { contacts } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/unique-violation";
import { UserSafeActionError } from "@/lib/errors";

/**
 * Enforce the manager rule shared by create/update contact: a manager must be an
 * existing contact at the *same* company — never a cross-company or dangling
 * link. Pass `selfId` (update only) to also forbid a contact managing itself. The
 * picker enforces this in the UI; re-checked here so a hand-crafted request can't
 * bypass it.
 */
export async function assertValidManager({
  managerId,
  companyId,
  selfId,
}: {
  managerId: string | null;
  companyId: string | null;
  selfId?: string;
}) {
  if (managerId === null) return;

  if (selfId !== undefined && managerId === selfId) {
    throw new UserSafeActionError("A contact can't manage themselves.");
  }
  if (companyId === null) {
    throw new UserSafeActionError("Set a company before choosing a manager.");
  }

  const [manager] = await db
    .select({ companyId: contacts.companyId })
    .from(contacts)
    .where(eq(contacts.id, managerId))
    .limit(1);
  if (!manager || manager.companyId !== companyId) {
    throw new UserSafeActionError(
      "The manager must be a contact at the same company.",
    );
  }
}

/**
 * Map a `contacts_email_unique` violation to a user-safe message; rethrow
 * anything else. Shared by create/update contact. Returns `never` — always
 * throws — so callers can use it as the whole body of a catch block.
 */
export function mapContactEmailConflict(error: unknown): never {
  if (isUniqueViolation(error, "contacts_email_unique")) {
    throw new UserSafeActionError("A contact with that email already exists.");
  }
  throw error;
}
