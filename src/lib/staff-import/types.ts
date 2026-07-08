import { z } from "zod";
import {
  type billableTypeEnum,
  employmentTypeEnum,
  lineOfBusinessEnum,
  roleEnum,
} from "@/lib/db/staff-schema";

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
    joinDate: z.string().nullable(),
    terminationDate: z.string().nullable(),
    isActive: z.boolean(),
    lineOfBusiness: z.enum(LINE_OF_BUSINESS),
    role: z.enum(ROLE),
    employmentType: z.enum(EMPLOYMENT_TYPE),
    isBillable: z.boolean(),
    utilizationTarget: z.number().int().min(0).max(100),
  })
  .refine((r) => r.terminationDate === null || !r.isActive, {
    message: "isActive must be false when a termination date is set",
    path: ["isActive"],
  })
  .refine((r) => r.isBillable || r.utilizationTarget === 0, {
    message: "utilizationTarget must be 0 when not billable",
    path: ["utilizationTarget"],
  });

export type NormalizedStaff = z.infer<typeof normalizedStaffSchema>;

export type { SkippedRow } from "@/lib/csv-import";

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
] as const satisfies readonly (keyof NormalizedStaff)[];

export type ComparableField =
  | (typeof IDENTITY_FIELDS)[number]
  | (typeof EMPLOYMENT_FIELDS)[number];

/** Snapshot of an existing staff record's comparable fields (for diffing). */
export type ComparableSnapshot = {
  name: string;
  email: string;
  joinDate: string | null;
  terminationDate: string | null;
  isActive: boolean;
  // Employment fields are null when the matched staff has no employment row yet.
  lineOfBusiness: LineOfBusiness | null;
  role: Role | null;
  employmentType: EmploymentType | null;
  isBillable: boolean | null;
  utilizationTarget: number | null;
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
};

export type StaffImportPlan = {
  creates: NormalizedStaff[];
  updates: ImportUpdate[];
  /** Matched rows that are identical to the existing record (no write needed). */
  unchanged: number;
};

export type CommitResult = {
  created: number;
  updated: number;
  employmentRowsAdded: number;
};
