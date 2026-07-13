/**
 * Pure manager-resolution for the staff import. A row names its manager by
 * email (`Manager - Work email`), but people are keyed by `ripplingId` — the
 * stable identifier that survives from the client transform through the
 * server diff to commit (email is non-unique, and create-ids don't exist until
 * commit). These helpers turn a manager email into a manager `ripplingId`, or a
 * reason it couldn't be resolved. DB-free so it stays unit-testable; the plan
 * feeds it the batch + DB rows. See docs/domains/staff-profiles.md.
 */

/** The CSV column naming a person's manager. */
export const MANAGER_EMAIL_HEADER = "Manager - Work email";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * Why a manager email couldn't be linked. The row still imports — only the
 * manager pointer is left unset.
 */
export type ManagerResolutionReason = "not_found" | "ambiguous" | "self";

export type ManagerResolution = {
  managerRipplingId: string | null;
  reason: ManagerResolutionReason | null;
};

/**
 * Index normalized email → the set of ripplingIds that use it. Built from the
 * incoming batch and the DB combined, so a manager who is a create in the same
 * file resolves alongside one who already exists. The same person from both
 * sources collapses to one ripplingId; two *distinct* people sharing an email
 * make it ambiguous.
 */
export function buildManagerEmailIndex(
  entries: readonly { email: string; ripplingId: string }[],
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const { email, ripplingId } of entries) {
    const key = normalizeEmail(email);
    const ids = index.get(key);
    if (ids) ids.add(ripplingId);
    else index.set(key, new Set([ripplingId]));
  }
  return index;
}

/** Resolve one row's manager email against the index. */
export function resolveManager(
  row: { email: string; ripplingId: string; managerEmail: string | null },
  index: Map<string, Set<string>>,
): ManagerResolution {
  if (!row.managerEmail) return { managerRipplingId: null, reason: null };

  const key = normalizeEmail(row.managerEmail);
  if (key === normalizeEmail(row.email)) {
    return { managerRipplingId: null, reason: "self" };
  }

  const ids = index.get(key);
  if (!ids || ids.size === 0) {
    return { managerRipplingId: null, reason: "not_found" };
  }
  if (ids.size > 1) return { managerRipplingId: null, reason: "ambiguous" };

  const [only] = ids;
  if (only === row.ripplingId) {
    return { managerRipplingId: null, reason: "self" };
  }
  return { managerRipplingId: only, reason: null };
}
