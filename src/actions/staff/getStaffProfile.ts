import "server-only";

import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { cache } from "react";
import { db } from "@/lib/db/db";
import { type StaffEmployment, staff, staffEmployment } from "@/lib/db/schema";
import type { StaffSkill } from "@/lib/staff/skills";
import { latestEmploymentFirst } from "@/lib/staff/staff-employment";

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
  resume: string | null;
  resumeUpdatedAt: Date | null;
  skills: StaffSkill[];
  joinDate: string | null;
  // The person's manager (set via import; null when none). `managerName` is null
  // whenever `managerId` is.
  managerId: string | null;
  managerName: string | null;
  employment: Pick<
    StaffEmployment,
    | "lineOfBusiness"
    | "role"
    | "employmentType"
    | "isBillable"
    | "base"
    | "hourlyRate"
    | "guaranteedBonus"
    | "discretionaryBonus"
    | "currency"
  > | null;
};

/**
 * Read any staff member's profile by id, for SSR. NOT ownership-scoped — the
 * directory and per-person profile pages deliberately show other people; auth is
 * provided by the `(app)` layout. Returns null when the id doesn't resolve.
 *
 * Wrapped in `React.cache` so `/staff/[id]`'s `generateMetadata` and the page
 * body share one query per request.
 */
export const getStaffProfile = cache(
  async (staffId: string): Promise<StaffProfile | null> => {
    const manager = alias(staff, "manager");
    const [profile] = await db
      .select({
        name: staff.name,
        email: staff.email,
        linkedinUrl: staff.linkedinUrl,
        githubUrl: staff.githubUrl,
        portfolioUrl: staff.portfolioUrl,
        clientIntro: staff.clientIntro,
        resume: staff.resume,
        resumeUpdatedAt: staff.resumeUpdatedAt,
        skills: staff.skills,
        joinDate: staff.joinDate,
        managerId: staff.managerId,
        managerName: manager.name,
      })
      .from(staff)
      .leftJoin(manager, eq(manager.id, staff.managerId))
      .where(eq(staff.id, staffId))
      .limit(1);

    if (!profile) return null;

    // Latest employment row wins (ADR 0007 — staff employment effective-dating).
    const [employment] = await db
      .select({
        lineOfBusiness: staffEmployment.lineOfBusiness,
        role: staffEmployment.role,
        employmentType: staffEmployment.employmentType,
        isBillable: staffEmployment.isBillable,
        base: staffEmployment.base,
        hourlyRate: staffEmployment.hourlyRate,
        guaranteedBonus: staffEmployment.guaranteedBonus,
        discretionaryBonus: staffEmployment.discretionaryBonus,
        currency: staffEmployment.currency,
      })
      .from(staffEmployment)
      .where(eq(staffEmployment.staffId, staffId))
      .orderBy(...latestEmploymentFirst)
      .limit(1);

    return { ...profile, employment: employment ?? null };
  },
);
