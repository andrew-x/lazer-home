/**
 * The rule for who may tick a task off, as a pure predicate. A
 * client-importable module (no `db`/drizzle) so the decision itself is unit
 * tested while the two lookups that feed it stay in `canCompleteTask`.
 *
 * This does **not** re-implement any role check — it takes the already-evaluated
 * `crm.edit` answer as a boolean. `userHasPermission` in
 * `@/lib/auth/permissions` remains the only place a role is interpreted.
 */

/**
 * May the caller complete this task?
 *
 * - `crm.edit` completes anything (sales/manager/admin).
 * - Otherwise the caller must be the task's **assignee**.
 *
 * A null `ownerStaffId` (unassigned, or the owner's staff row was removed — the FK
 * is set-null) or a null `callerStaffId` (no linked staff record) never matches,
 * so an unowned task is completable only by a `crm.edit` holder. Comparing two
 * nulls as "equal" would hand every unassigned task to every unlinked account.
 */
export function taskCompletionAllowed({
  hasCrmEdit,
  ownerStaffId,
  callerStaffId,
}: {
  hasCrmEdit: boolean;
  ownerStaffId: string | null;
  callerStaffId: string | null;
}): boolean {
  if (hasCrmEdit) return true;
  if (!ownerStaffId || !callerStaffId) return false;
  return ownerStaffId === callerStaffId;
}
