import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { type StaffEmployment, staff, staffEmployment } from "@/lib/db/schema";

/**
 * A staff member's profile plus their latest employment facts. `employment` is
 * null only when a staff row has no employment history (a setup error).
 */
export type StaffProfile = {
  name: string;
  email: string;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  clientIntro: string | null;
  joinDate: string | null;
  employment: Pick<
    StaffEmployment,
    "lineOfBusiness" | "role" | "employmentType" | "isBillable"
  > | null;
};

/**
 * Read any staff member's profile by id, for SSR. NOT ownership-scoped — the
 * directory and per-person profile pages deliberately show other people; auth is
 * provided by the `(app)` layout. Returns null when the id doesn't resolve.
 */
export async function getStaffProfile(
  staffId: string,
): Promise<StaffProfile | null> {
  const [profile] = await db
    .select({
      name: staff.name,
      email: staff.email,
      linkedinUrl: staff.linkedinUrl,
      githubUrl: staff.githubUrl,
      portfolioUrl: staff.portfolioUrl,
      clientIntro: staff.clientIntro,
      joinDate: staff.joinDate,
    })
    .from(staff)
    .where(eq(staff.id, staffId))
    .limit(1);

  if (!profile) return null;

  // Latest employment row wins: effective date, then createdAt for same-day ties
  // (ADR 0007 — staff employment effective-dating).
  const [employment] = await db
    .select({
      lineOfBusiness: staffEmployment.lineOfBusiness,
      role: staffEmployment.role,
      employmentType: staffEmployment.employmentType,
      isBillable: staffEmployment.isBillable,
    })
    .from(staffEmployment)
    .where(eq(staffEmployment.staffId, staffId))
    .orderBy(
      desc(staffEmployment.effectiveFromDate),
      desc(staffEmployment.createdAt),
    )
    .limit(1);

  return { ...profile, employment: employment ?? null };
}
