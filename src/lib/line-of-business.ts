/**
 * The shared "line of business" values. Declared here as a pure, client-importable
 * module (no `db`/drizzle) so the `lineOfBusinessEnum` pgEnum in `staff-schema.ts`,
 * zod schemas, and client forms all share exactly one source of truth. See
 * docs/data-model.md — this is a shared/global enum reused across staff, CRM, and
 * projects/allocations.
 */
export const LINE_OF_BUSINESS = [
  "CORPORATE",
  "CORE",
  "FINTECH",
  "COMMERCE",
  "DESIGN",
] as const;

export type LineOfBusiness = (typeof LINE_OF_BUSINESS)[number];

/** Human-readable labels for each line of business. */
export const LINE_OF_BUSINESS_LABELS: Record<LineOfBusiness, string> = {
  CORPORATE: "Corporate",
  CORE: "Core",
  FINTECH: "Fintech",
  COMMERCE: "Commerce",
  DESIGN: "Design",
};
