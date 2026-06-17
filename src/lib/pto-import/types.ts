import { z } from "zod";

/**
 * Shapes for the admin PTO CSV import. Shared between the client (CSV parse +
 * transform, preview tables) and the server (diff + persist), so this module
 * must stay free of server-only imports.
 *
 * The enum tuple below mirrors the Postgres `pto_type` enum in `staff-schema.ts`;
 * the Drizzle insert in the commit action type-checks against the real enum, so
 * drift surfaces at compile time.
 */
export const PTO_TYPE = [
  "VACATION",
  "STATUTORY_HOLIDAY",
  "SICK_LEAVE",
  "UNPAID_LEAVE",
  "PARENTAL_LEAVE",
  "BEREAVEMENT_LEAVE",
  "COMPANY_RETREAT",
  "RELIGIOUS_HOLIDAY",
  "JURY_DUTY",
  "LEAVE_OF_ABSENCE",
  "OTHER_LEAVE",
] as const;

export type PtoType = (typeof PTO_TYPE)[number];

/**
 * A single CSV row after column mapping + derivation. `action` distinguishes
 * records to upsert (APPROVED/Pending) from those to remove (REJECTED/CANCELED).
 * For `delete` rows we only need the leave-request id; `type`/dates are null.
 * The refinement re-asserts that invariant so the server never trusts a crafted
 * payload (an `upsert` row must carry a type and both dates).
 */
export const normalizedPtoSchema = z
  .object({
    /** Rippling "Leave request ID" — the PTO record key. */
    ripplingId: z.string().min(1),
    /** Rippling "Employee - ID" — used to resolve the staff member. */
    staffRipplingId: z.string().min(1),
    /** Employee name, carried for display in the preview only. */
    name: z.string(),
    action: z.enum(["upsert", "delete"]),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    type: z.enum(PTO_TYPE).nullable(),
    isPending: z.boolean(),
  })
  .refine(
    (r) =>
      r.action === "delete" ||
      (r.type !== null && r.startDate !== null && r.endDate !== null),
    {
      message: "upsert rows must have a type, start date, and end date",
      path: ["type"],
    },
  );

export type NormalizedPto = z.infer<typeof normalizedPtoSchema>;

/** A CSV row we couldn't import, surfaced for review (never persisted). */
export type SkippedRow = {
  rowNumber: number;
  name: string;
  ripplingId: string;
  reason: string;
};

/** Fields compared between an incoming PTO row and the existing record. */
export const PTO_FIELDS = [
  "startDate",
  "endDate",
  "type",
  "isPending",
] as const satisfies readonly (keyof NormalizedPto)[];

export type ComparableField = (typeof PTO_FIELDS)[number];

/** Snapshot of an existing PTO record's comparable fields (for diffing). */
export type ComparableSnapshot = {
  startDate: string;
  endDate: string;
  type: PtoType;
  isPending: boolean;
};

export type PtoImportUpdate = {
  ptoId: string;
  incoming: NormalizedPto;
  current: ComparableSnapshot;
  changedFields: ComparableField[];
};

/** An existing record slated for deletion (REJECTED/CANCELED upstream). */
export type PtoDeletion = {
  ripplingId: string;
  staffName: string;
  startDate: string;
  endDate: string;
  type: PtoType;
};

export type PtoImportPlan = {
  creates: NormalizedPto[];
  updates: PtoImportUpdate[];
  deletes: PtoDeletion[];
  /** Matched rows identical to the existing record (no write needed). */
  unchanged: number;
  /** REJECTED/CANCELED rows with no matching record (nothing to delete). */
  ignoredCancellations: number;
};

export type CommitResult = {
  created: number;
  updated: number;
  deleted: number;
};
