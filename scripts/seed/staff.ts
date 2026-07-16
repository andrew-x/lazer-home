import type { InferInsertModel } from "drizzle-orm";
import { CURRENCY } from "@/lib/currency";
import { generateId } from "@/lib/db/ids";
import {
  type Staff,
  staff,
  staffEmployment,
  staffPto,
  user,
} from "@/lib/db/schema";
import { LINE_OF_BUSINESS } from "@/lib/line-of-business";
import { ALL_SKILLS, PROFICIENCY_LEVELS, type StaffSkill } from "@/lib/skills";
import type { SeedDb } from "./client";
import { chance, faker, isoDate, money, pastDate } from "./faker";

// The employment `role` enum (declared inline in staff-schema.ts). Non-leadership
// staff draw from the delivery-ish roles; leaders/managers get LEADERSHIP.
const IC_ROLES = [
  "ENGINEER",
  "DESIGNER",
  "SOLUTIONS",
  "ARCHITECT",
  "DELIVERY",
  "QA",
] as const;
const PTO_TYPES = [
  "VACATION",
  "SICK_LEAVE",
  "PARENTAL_LEAVE",
  "COMPANY_RETREAT",
  "STATUTORY_HOLIDAY",
] as const;

/** The account you sign in with — a fully-permissioned admin, linked to staff. */
const ADMIN_EMAIL = "andrew@lazertechnologies.com";
const ADMIN_NAME = "Andrew Xia";

const IC_COUNT = 30;
const MANAGER_COUNT = 8;

type StaffInsert = InferInsertModel<typeof staff>;
type EmploymentInsert = InferInsertModel<typeof staffEmployment>;
type PtoInsert = InferInsertModel<typeof staffPto>;
type UserInsert = InferInsertModel<typeof user>;

function pickSkills(): StaffSkill[] {
  const names = faker.helpers.arrayElements(
    ALL_SKILLS,
    faker.number.int({ min: 2, max: 6 }),
  );
  return names.map((name) => ({
    name,
    level: faker.helpers.arrayElement(PROFICIENCY_LEVELS),
  }));
}

function makeEmployment(
  staffId: string,
  effectiveFromDate: string,
  role: EmploymentInsert["role"],
  isManagement: boolean,
): EmploymentInsert {
  const isBillable = !isManagement && role !== "SOLUTIONS";
  return {
    id: generateId("emp"),
    staffId,
    effectiveFromDate,
    lineOfBusiness: faker.helpers.arrayElement(LINE_OF_BUSINESS),
    role,
    employmentType: "FULL_TIME",
    isBillable,
    utilizationTarget: isBillable
      ? faker.helpers.arrayElement([80, 90, 100])
      : 0,
    billableType: faker.helpers.arrayElement(["HUB", "GLOBAL"]),
    isManagement,
    base: money(90_000, 210_000),
    hourlyRate: money(60, 180),
    guaranteedBonus: money(0, 20_000),
    discretionaryBonus: 0,
    currency: faker.helpers.arrayElement(CURRENCY),
  };
}

/**
 * Seed users + staff (with a 3-tier manager hierarchy: leaders → managers → ICs),
 * one current employment row each, and PTO for a subset. Returns the inserted
 * staff rows for downstream domains to reference.
 */
export async function seedStaff(db: SeedDb): Promise<Staff[]> {
  const staffRows: StaffInsert[] = [];
  const employmentRows: EmploymentInsert[] = [];
  const users: UserInsert[] = [];

  // --- Andrew: admin user + linked leader staff --------------------------
  const adminUserId = generateId("user");
  const adminStaffId = generateId("staff");
  const adminJoin = pastDate(5);
  users.push({
    id: adminUserId,
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    emailVerified: true,
    role: "admin",
  });
  staffRows.push({
    id: adminStaffId,
    ripplingId: "rip-admin",
    userId: adminUserId,
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    managerId: null,
    linkedinUrl: faker.internet.url(),
    clientIntro: faker.lorem.paragraph(),
    clientIntroUpdatedAt: faker.date.recent({ days: 60 }),
    resume: faker.lorem.paragraphs(3),
    resumeUpdatedAt: faker.date.recent({ days: 60 }),
    skills: pickSkills(),
    joinDate: adminJoin,
    isActive: true,
  });
  employmentRows.push(
    makeEmployment(adminStaffId, adminJoin, "LEADERSHIP", true),
  );

  // --- Leaders (top of org, no manager) ----------------------------------
  const leaderIds: string[] = [adminStaffId];
  for (let i = 0; i < 3; i++) {
    const id = generateId("staff");
    leaderIds.push(id);
    const join = pastDate(5);
    staffRows.push(buildStaff(id, i, null, join, "leader"));
    employmentRows.push(makeEmployment(id, join, "LEADERSHIP", true));
  }

  // --- Managers (report to a leader) -------------------------------------
  const managerIds: string[] = [];
  for (let i = 0; i < MANAGER_COUNT; i++) {
    const id = generateId("staff");
    managerIds.push(id);
    const join = pastDate(4);
    staffRows.push(
      buildStaff(
        id,
        100 + i,
        faker.helpers.arrayElement(leaderIds),
        join,
        "manager",
      ),
    );
    employmentRows.push(
      makeEmployment(id, join, faker.helpers.arrayElement(IC_ROLES), true),
    );
  }

  // --- ICs (report to a manager) -----------------------------------------
  for (let i = 0; i < IC_COUNT; i++) {
    const id = generateId("staff");
    const join = pastDate(3);
    staffRows.push(
      buildStaff(
        id,
        200 + i,
        faker.helpers.arrayElement(managerIds),
        join,
        "ic",
      ),
    );
    employmentRows.push(
      makeEmployment(id, join, faker.helpers.arrayElement(IC_ROLES), false),
    );
  }

  await db.insert(user).values(users);
  // Self-referential `managerId` resolves within this single multi-row INSERT:
  // Postgres checks the FK at statement end, by which point every referenced row
  // is present. Leaders (null manager) and Andrew are included in the same batch.
  await db.insert(staff).values(staffRows);
  await db.insert(staffEmployment).values(employmentRows);

  // --- PTO for a subset ---------------------------------------------------
  const ptoRows: PtoInsert[] = [];
  let ptoSeq = 0;
  for (const row of staffRows) {
    if (!chance(0.4)) continue;
    const spans = faker.number.int({ min: 1, max: 3 });
    for (let i = 0; i < spans; i++) {
      const start = faker.date.recent({ days: 300 });
      const end = new Date(start);
      end.setDate(end.getDate() + faker.number.int({ min: 0, max: 9 }));
      ptoRows.push({
        id: generateId("pto"),
        ripplingId: `rip-pto-${ptoSeq++}`,
        staffId: row.id,
        startDate: isoDate(start),
        endDate: isoDate(end),
        type: faker.helpers.arrayElement(PTO_TYPES),
        isPending: chance(0.2),
      });
    }
  }
  if (ptoRows.length > 0) await db.insert(staffPto).values(ptoRows);

  // Re-read so downstream domains get the canonical persisted rows.
  return db.query.staff.findMany();
}

type Tier = "leader" | "manager" | "ic";

function buildStaff(
  id: string,
  seq: number,
  managerId: string | null,
  joinDate: string,
  tier: Tier,
): StaffInsert {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  // A few departed ICs so the "active" filters have something to exclude — decided
  // once so termination date and the active flag stay consistent.
  const departed = tier === "ic" && chance(0.1);
  const hasIntro = chance(0.6);
  const hasResume = chance(0.7);
  return {
    id,
    ripplingId: `rip-${seq}`,
    userId: null,
    name: `${firstName} ${lastName}`,
    // Deterministic, unique, and clearly synthetic.
    email: `${firstName}.${lastName}.${seq}@example.com`.toLowerCase(),
    managerId,
    linkedinUrl: chance(0.7) ? faker.internet.url() : null,
    githubUrl: tier === "ic" && chance(0.6) ? faker.internet.url() : null,
    portfolioUrl: chance(0.3) ? faker.internet.url() : null,
    clientIntro: hasIntro ? faker.lorem.paragraph() : null,
    clientIntroUpdatedAt: hasIntro ? faker.date.recent({ days: 120 }) : null,
    resume: hasResume ? faker.lorem.paragraphs(2) : null,
    resumeUpdatedAt: hasResume ? faker.date.recent({ days: 120 }) : null,
    skills: pickSkills(),
    joinDate,
    terminationDate: departed ? pastDate(1) : null,
    isActive: !departed,
  };
}
