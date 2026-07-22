import "server-only";
import { inArray, sql } from "drizzle-orm";
import { firstPerKey } from "@/lib/core/collections";
import { db } from "@/lib/db/db";
import { staff, staffEmployment } from "@/lib/db/schema";
import { latestEmploymentFirst } from "@/lib/staff/staff-employment";
import {
  buildManagerEmailIndex,
  type ManagerResolutionReason,
  normalizeEmail,
  resolveManager,
} from "./managers";
import {
  type ComparableField,
  type ComparableSnapshot,
  EMPLOYMENT_FIELDS,
  IDENTITY_FIELDS,
  type ImportCreate,
  type ImportUpdate,
  type ManagerWarning,
  type NormalizedStaff,
  type StaffImportPlan,
} from "./types";

/**
 * Human-readable message for each manager-resolution failure. States only the
 * problem — what happens to the link (kept for an existing person, unset for a
 * new one) is explained in the import UI, since it differs by case.
 */
function managerWarningMessage(
  reason: ManagerResolutionReason,
  managerEmail: string,
): string {
  switch (reason) {
    case "not_found":
      return `Manager email "${managerEmail}" matched no staff.`;
    case "ambiguous":
      return `Manager email "${managerEmail}" matched multiple staff.`;
    case "self":
      return `Manager email "${managerEmail}" refers to this person.`;
  }
}

/**
 * Diff the incoming (already-transformed) rows against the database, splitting
 * them into creates and updates. Matching is by `ripplingId`. For updates we
 * compute which comparable fields changed (for table marking) and whether any
 * employment fact changed (which drives a new effective-dated employment row on
 * commit — see ADR 0007).
 *
 * The manager is matched by email and carried as a stable manager `ripplingId`:
 * the email index spans the incoming batch (so a manager who is a create in the
 * same file resolves) and the DB (so a manager only in the DB resolves too). A
 * blank cell clears the manager; a filled-but-unresolvable cell (typo, ambiguous
 * email, or self) is flagged via `managerWarnings` and leaves the existing link
 * intact rather than wiping it.
 */
export async function computeImportPlan(
  rows: NormalizedStaff[],
): Promise<StaffImportPlan> {
  const ripplingIds = rows.map((r) => r.ripplingId);
  // Normalized emails a manager cell points at — reused for the DB candidate
  // lookup and (via the index) resolution, so the two never key emails differently.
  const referencedManagerEmails = [
    ...new Set(
      rows
        .map((r) => r.managerEmail)
        .filter((e): e is string => !!e)
        .map(normalizeEmail),
    ),
  ];

  // Round 1 — independent of each other: the matched records, and any DB staff a
  // manager email points at (covers partial imports where the manager isn't in
  // this file; the batch alone covers a full-org import and first imports).
  const [existing, dbManagerCandidates] = await Promise.all([
    ripplingIds.length
      ? db
          .select({
            id: staff.id,
            ripplingId: staff.ripplingId,
            name: staff.name,
            email: staff.email,
            managerId: staff.managerId,
            joinDate: staff.joinDate,
            terminationDate: staff.terminationDate,
            isActive: staff.isActive,
          })
          .from(staff)
          .where(inArray(staff.ripplingId, ripplingIds))
      : [],
    referencedManagerEmails.length
      ? db
          .select({
            name: staff.name,
            email: staff.email,
            ripplingId: staff.ripplingId,
          })
          .from(staff)
          .where(inArray(sql`lower(${staff.email})`, referencedManagerEmails))
      : [],
  ]);

  const existingByRippling = new Map(existing.map((s) => [s.ripplingId, s]));
  const emailIndex = buildManagerEmailIndex([
    ...rows.map((r) => ({ email: r.email, ripplingId: r.ripplingId })),
    ...dbManagerCandidates,
  ]);

  // Round 2 — both depend only on the matched records: each one's current
  // manager (resolved `staff.managerId` → ripplingId, so a manager change is
  // detectable) and their latest employment row.
  const currentManagerIds = [
    ...new Set(
      existing.map((s) => s.managerId).filter((id): id is string => !!id),
    ),
  ];
  const staffIds = existing.map((s) => s.id);
  const [managerRows, employments] = await Promise.all([
    currentManagerIds.length
      ? db
          .select({
            id: staff.id,
            ripplingId: staff.ripplingId,
            name: staff.name,
          })
          .from(staff)
          .where(inArray(staff.id, currentManagerIds))
      : [],
    // Latest employment row per matched staff (highest effectiveFromDate wins;
    // createdAt breaks ties for same-day changes).
    staffIds.length
      ? db
          .select({
            staffId: staffEmployment.staffId,
            lineOfBusiness: staffEmployment.lineOfBusiness,
            role: staffEmployment.role,
            employmentType: staffEmployment.employmentType,
            isBillable: staffEmployment.isBillable,
            utilizationTarget: staffEmployment.utilizationTarget,
            base: staffEmployment.base,
            hourlyRate: staffEmployment.hourlyRate,
            guaranteedBonus: staffEmployment.guaranteedBonus,
            discretionaryBonus: staffEmployment.discretionaryBonus,
            currency: staffEmployment.currency,
            isManagement: staffEmployment.isManagement,
            billableType: staffEmployment.billableType,
          })
          .from(staffEmployment)
          .where(inArray(staffEmployment.staffId, staffIds))
          .orderBy(...latestEmploymentFirst)
      : [],
  ]);

  const managerRipplingById = new Map(
    managerRows.map((m) => [m.id, m.ripplingId]),
  );
  const latestEmploymentByStaff = firstPerKey(employments, (e) => e.staffId);

  // ripplingId → display name, for the preview's Manager column. DB names first,
  // then the batch (an incoming name change wins over the stored one).
  const nameByRippling = new Map<string, string>();
  for (const m of dbManagerCandidates) nameByRippling.set(m.ripplingId, m.name);
  for (const m of managerRows) nameByRippling.set(m.ripplingId, m.name);
  for (const r of rows) nameByRippling.set(r.ripplingId, r.name);
  const nameFor = (ripplingId: string | null) =>
    ripplingId ? (nameByRippling.get(ripplingId) ?? null) : null;

  const creates: ImportCreate[] = [];
  const updates: ImportUpdate[] = [];
  const managerWarnings: ManagerWarning[] = [];
  let unchanged = 0;

  for (const incoming of rows) {
    // `undefined` means the file had no manager column at all — carry no manager
    // info (preserve existing links), so we don't even attempt resolution.
    const columnProvided = incoming.managerEmail !== undefined;
    const { managerRipplingId: resolvedManager, reason } = columnProvided
      ? resolveManager(
          {
            email: incoming.email,
            ripplingId: incoming.ripplingId,
            managerEmail: incoming.managerEmail ?? null,
          },
          emailIndex,
        )
      : { managerRipplingId: null, reason: null };
    if (reason && incoming.managerEmail) {
      managerWarnings.push({
        name: incoming.name,
        ripplingId: incoming.ripplingId,
        managerEmail: incoming.managerEmail,
        reason: managerWarningMessage(reason, incoming.managerEmail),
      });
    }

    const match = existingByRippling.get(incoming.ripplingId);
    if (!match) {
      // New person: nothing to preserve — take the resolved manager (null when
      // the cell is blank or couldn't be resolved).
      creates.push({
        incoming,
        managerRipplingId: resolvedManager,
        managerName: nameFor(resolvedManager),
      });
      continue;
    }

    const employment = latestEmploymentByStaff.get(match.id) ?? null;
    const currentManagerRipplingId = match.managerId
      ? (managerRipplingById.get(match.managerId) ?? null)
      : null;

    // Manager target for an existing person:
    //  - column absent (!columnProvided) → preserve existing
    //  - blank cell (null)               → clear
    //  - filled but unresolvable (reason)→ preserve existing (warned above), so
    //    a typo/ambiguous/self never wipes a correct link
    //  - resolved                        → the resolved manager
    const managerRipplingId = !columnProvided
      ? currentManagerRipplingId
      : incoming.managerEmail === null
        ? null
        : reason
          ? currentManagerRipplingId
          : resolvedManager;

    const current: ComparableSnapshot = {
      name: match.name,
      email: match.email,
      managerRipplingId: currentManagerRipplingId,
      managerName: nameFor(currentManagerRipplingId),
      joinDate: match.joinDate,
      terminationDate: match.terminationDate,
      isActive: match.isActive,
      lineOfBusiness: employment?.lineOfBusiness ?? null,
      role: employment?.role ?? null,
      employmentType: employment?.employmentType ?? null,
      isBillable: employment?.isBillable ?? null,
      utilizationTarget: employment?.utilizationTarget ?? null,
      base: employment?.base ?? null,
      hourlyRate: employment?.hourlyRate ?? null,
      guaranteedBonus: employment?.guaranteedBonus ?? null,
      discretionaryBonus: employment?.discretionaryBonus ?? null,
      currency: employment?.currency ?? null,
      isManagement: employment?.isManagement ?? null,
      billableType: employment?.billableType ?? null,
    };

    // LEADERSHIP is assigned manually (promotions), never via import — so for
    // someone already in LEADERSHIP we preserve their role and its billability
    // rather than overwriting it from the CSV-derived role. (`isManagement` is
    // likewise import-preserved, but for everyone — carried forward at commit.)
    // Compensation is required on every import row, so it flows straight from
    // `incoming` — no carry-forward needed here.
    const effective: NormalizedStaff =
      current.role === "LEADERSHIP"
        ? {
            ...incoming,
            role: "LEADERSHIP",
            isBillable: current.isBillable ?? false,
            utilizationTarget: current.utilizationTarget ?? 0,
          }
        : incoming;

    const changedFields: ComparableField[] = [];
    for (const field of [...IDENTITY_FIELDS, ...EMPLOYMENT_FIELDS]) {
      if (effective[field] !== current[field]) changedFields.push(field);
    }

    // Manager lives on `staff` (an identity fact) but isn't in the field tuples
    // — it's resolved separately, so track its change on its own.
    const managerChanged = managerRipplingId !== current.managerRipplingId;

    // Identical to the existing record — nothing to write.
    if (changedFields.length === 0 && !managerChanged) {
      unchanged += 1;
      continue;
    }

    const employmentChanged = EMPLOYMENT_FIELDS.some(
      (field) => effective[field] !== current[field],
    );

    updates.push({
      staffId: match.id,
      incoming: effective,
      current,
      changedFields,
      employmentChanged,
      managerRipplingId,
      managerName: nameFor(managerRipplingId),
      managerChanged,
    });
  }

  return { creates, updates, unchanged, managerWarnings };
}
