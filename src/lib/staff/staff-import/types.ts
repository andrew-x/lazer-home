import { z } from "zod";
import {
  type billableTypeEnum,
  employmentTypeEnum,
  lineOfBusinessEnum,
  roleEnum,
} from "@/lib/db/staff-schema";
import { CURRENCY, type Currency } from "@/lib/format/currency";
import { isEmploymentInvariantSatisfied } from "@/lib/staff/employment";

/**
 * Shapes for the admin staff CSV import. These are shared between the client
 * (CSV parse + transform, preview tables) and the server (diff + persist), so
 * this module must stay free of server-only imports. (`staff-schema.ts` only
 * declares pgTable/pgEnum shapes — no DB connection — so it is client-safe.)
 *
 * The enum tuples are derived directly from the Postgres enums in
 * `staff-schema.ts` (the single source of truth), so they can never drift.
 */
export const LINE_OF_BUSINESS = lineOfBusinessEnum.enumValues;
export const ROLE = roleEnum.enumValues;
export const EMPLOYMENT_TYPE = employmentTypeEnum.enumValues;

export type LineOfBusiness = (typeof LINE_OF_BUSINESS)[number];
export type Role = (typeof ROLE)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPE)[number];
export type BillableType = (typeof billableTypeEnum.enumValues)[number];

/**
 * A single CSV row after column mapping + derivation. The refinements re-assert
 * the invariants the client transform produces, so the server never trusts a
 * crafted payload that violates them (terminated ⇒ inactive; non-billable ⇒ 0%).
 */
export const normalizedStaffSchema = z
  .object({
    ripplingId: z.string().min(1),
    name: z.string().min(1),
    email: z.string().min(1),
    // The manager's work email, from the `Manager - Work email` column. Three
    // states: a string (resolve + link), `null` (column present but cell blank →
    // clear the manager), or `undefined` (column absent → import carries no
    // manager info, so existing links are preserved). Resolved to a manager
    // staff id at commit — see managers.ts / plan.ts.
    managerEmail: z.string().min(1).nullish(),
    joinDate: z.string().nullable(),
    terminationDate: z.string().nullable(),
    isActive: z.boolean(),
    lineOfBusiness: z.enum(LINE_OF_BUSINESS),
    role: z.enum(ROLE),
    employmentType: z.enum(EMPLOYMENT_TYPE),
    isBillable: z.boolean(),
    utilizationTarget: z.number().int().min(0).max(100),
    // Compensation. Required for staff going forward — the transform skips any row
    // missing a comp value. `discretionaryBonus` isn't imported yet (defaults to 0).
    base: z.number().nonnegative(),
    hourlyRate: z.number().nonnegative(),
    guaranteedBonus: z.number().nonnegative(),
    discretionaryBonus: z.number().nonnegative(),
    currency: z.enum(CURRENCY),
  })
  .refine((r) => r.terminationDate === null || !r.isActive, {
    message: "isActive must be false when a termination date is set",
    path: ["isActive"],
  })
  .refine(isEmploymentInvariantSatisfied, {
    message: "utilizationTarget must be 0 when not billable",
    path: ["utilizationTarget"],
  });

export type NormalizedStaff = z.infer<typeof normalizedStaffSchema>;

export type { SkippedRow } from "@/lib/import/csv-import";

/** Fields compared between an incoming row and the existing record. */
export const IDENTITY_FIELDS = [
  "name",
  "email",
  "joinDate",
  "terminationDate",
  "isActive",
] as const satisfies readonly (keyof NormalizedStaff)[];

export const EMPLOYMENT_FIELDS = [
  "lineOfBusiness",
  "role",
  "employmentType",
  "isBillable",
  "utilizationTarget",
  "base",
  "hourlyRate",
  "guaranteedBonus",
  "discretionaryBonus",
  "currency",
] as const satisfies readonly (keyof NormalizedStaff)[];

export type ComparableField =
  | (typeof IDENTITY_FIELDS)[number]
  | (typeof EMPLOYMENT_FIELDS)[number];

/** Snapshot of an existing staff record's comparable fields (for diffing). */
export type ComparableSnapshot = {
  name: string;
  email: string;
  // The current manager as a stable ripplingId (resolved from `staff.managerId`),
  // so it can be compared against the incoming resolved manager. Not part of the
  // field tuples above — the manager diff is tracked separately (see plan.ts).
  managerRipplingId: string | null;
  /** The current manager's name, for the preview's old→new display. */
  managerName: string | null;
  joinDate: string | null;
  terminationDate: string | null;
  isActive: boolean;
  // Employment fields are null when the matched staff has no employment row yet.
  lineOfBusiness: LineOfBusiness | null;
  role: Role | null;
  employmentType: EmploymentType | null;
  isBillable: boolean | null;
  utilizationTarget: number | null;
  // Compensation on the current record (null when the matched staff has no
  // employment row yet). Comp is required on every import row and compared /
  // replaced straight from `incoming` — there is NO carry-forward on the import
  // path (ADR 0020; only bulk-edit carries comp forward).
  base: number | null;
  hourlyRate: number | null;
  guaranteedBonus: number | null;
  discretionaryBonus: number | null;
  currency: Currency | null;
  // Set in-app, never from the CSV; carried forward when import spawns a new
  // employment row so a re-sync never resets them.
  isManagement: boolean | null;
  billableType: BillableType | null;
};

export type ImportUpdate = {
  staffId: string;
  incoming: NormalizedStaff;
  current: ComparableSnapshot;
  changedFields: ComparableField[];
  /** True when any employment fact changed → a new employment row is inserted. */
  employmentChanged: boolean;
  /** The incoming manager resolved to a ripplingId (null when none/unresolved). */
  managerRipplingId: string | null;
  /** The resolved manager's name, for the preview column (null when none). */
  managerName: string | null;
  /** True when the resolved manager differs from the current one. */
  managerChanged: boolean;
};

/** A new staff row plus its resolved manager (a stable ripplingId reference). */
export type ImportCreate = {
  incoming: NormalizedStaff;
  managerRipplingId: string | null;
  /** The resolved manager's name, for the preview column (null when none). */
  managerName: string | null;
};

/**
 * A manager email that couldn't be linked, surfaced for review. Unlike a
 * `SkippedRow` the person still imports — only the manager pointer is left unset.
 */
export type ManagerWarning = {
  name: string;
  ripplingId: string;
  managerEmail: string;
  reason: string;
};

export type StaffImportPlan = {
  creates: ImportCreate[];
  updates: ImportUpdate[];
  /** Matched rows that are identical to the existing record (no write needed). */
  unchanged: number;
  /** Manager emails that couldn't be resolved (non-blocking). */
  managerWarnings: ManagerWarning[];
};

export type CommitResult = {
  created: number;
  updated: number;
  employmentRowsAdded: number;
  /** How many manager relationships were linked (creates + updates). */
  managersLinked: number;
};
