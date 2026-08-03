import type { InferInsertModel } from "drizzle-orm";
import { cityLabelsForCountries } from "@/lib/cities/cities";
import { LINE_OF_BUSINESS } from "@/lib/crm/line-of-business";
import { generateId } from "@/lib/db/ids";
import {
  type Staff,
  staff,
  staffBonusPayment,
  staffEmployment,
  staffPto,
  user,
} from "@/lib/db/schema";
import { CURRENCY } from "@/lib/format/currency";
import {
  ALL_SKILLS,
  PROFICIENCY_LEVELS,
  type StaffSkill,
} from "@/lib/staff/skills";
import { BONUS_TYPES } from "@/lib/staff/staff-bonus";
import type { SeedDb } from "./client";
import {
  chance,
  faker,
  isoDate,
  maxDate,
  money,
  pastDate,
  shiftDays,
} from "./faker";

// Seeded staff locations focus on US & Canada, drawn from the static world-cities
// list so every seeded value is one the location picker would actually offer.
const US_CA_CITIES = cityLabelsForCountries(["US", "CA"]);

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
type BonusInsert = InferInsertModel<typeof staffBonusPayment>;
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
  employmentType: EmploymentInsert["employmentType"] = "FULL_TIME",
): EmploymentInsert {
  const isBillable = !isManagement && role !== "SOLUTIONS";
  return {
    id: generateId("emp"),
    staffId,
    effectiveFromDate,
    lineOfBusiness: faker.helpers.arrayElement(LINE_OF_BUSINESS),
    role,
    employmentType,
    isBillable,
    utilizationTarget: isBillable
      ? faker.helpers.arrayElement([80, 90, 100])
      : 0,
    billableType: faker.helpers.arrayElement(["HUB", "GLOBAL"]),
    isManagement,
    base: money(90_000, 210_000),
    hourlyRate: money(60, 180),
    guaranteedBonus: money(0, 20_000),
    currency: faker.helpers.arrayElement(CURRENCY),
  };
}

/**
 * Seed users + staff (with a 3-tier manager hierarchy: leaders → managers → ICs),
 * one current employment row each, PTO for a subset, and bonus payments spread
 * over the last three calendar years. Returns the inserted staff rows for
 * downstream domains to reference.
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
    allocationNotes: faker.lorem.sentence(),
    skills: pickSkills(),
    skillsUpdatedAt: faker.date.recent({ days: 60 }),
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
    // A slice of the delivery bench is hourly — the schema's stand-in for
    // part-time; management stays salaried. Without any, two surfaces go
    // undemonstrable in dev: the utilization report's part-time figures, "n/a"
    // capacity cells and type filter all read as empty, and on the home
    // dashboard the Hourly availability filter is always empty while the
    // *normalized* staffing rate — whose denominator is full-time headcount —
    // prints the same number as the plain rate, so the distinction looks broken.
    employmentRows.push(
      makeEmployment(
        id,
        join,
        faker.helpers.arrayElement(IC_ROLES),
        false,
        chance(0.15) ? "HOURLY" : "FULL_TIME",
      ),
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

  // --- Bonus payments ------------------------------------------------------
  // Spread over the last few calendar years so the dashboard's year selector has
  // something to compare. `ripplingId` stays null — these are the hand-entered
  // shape, not imported ones.
  const bonusRows: BonusInsert[] = [];
  for (const row of staffRows) {
    // Not everyone gets a bonus; some get several across different years. Departed
    // staff ALWAYS get one: the dashboard deliberately counts payments to people
    // who have since left, and with only a handful of leavers a coin-flip leaves
    // that path unexercised (it seeded zero of them before this was forced).
    if (!row.terminationDate && !chance(0.55)) continue;
    const joinDate = row.joinDate as string;
    for (let i = 0; i < faker.number.int({ min: 1, max: 4 }); i++) {
      const type = faker.helpers.arrayElement(BONUS_TYPES);
      bonusRows.push({
        id: generateId("sbp"),
        staffId: row.id,
        // A SIGNING bonus is dated the day BEFORE the join date, so it precedes
        // the person's first employment row — the attribution-fallback case
        // `employmentAsOf` handles, and the only case that should hit it.
        //
        // Every other type is clamped to on-or-after the join date: a spot bonus
        // paid before someone was hired is not data we'd ever see, and seeding it
        // makes the fallback path look far commoner than it is.
        paymentDate:
          type === "SIGNING"
            ? isoDate(shiftDays(new Date(joinDate), -1))
            : maxDate(isoDate(faker.date.recent({ days: 3 * 365 })), joinDate),
        type,
        // A gift is a modest equivalent value; cash bonuses are larger.
        amount: type === "GIFT" ? money(100, 1_500) : money(1_000, 25_000),
        // Usually the currency they're paid in, occasionally another — the
        // dashboard converts, so a mixed set exercises that path.
        currency: chance(0.85)
          ? (employmentRows.find((e) => e.staffId === row.id)?.currency ??
            "CAD")
          : faker.helpers.arrayElement(CURRENCY),
        notes: chance(0.5) ? faker.lorem.sentence() : null,
      });
    }
  }
  if (bonusRows.length > 0)
    await db.insert(staffBonusPayment).values(bonusRows);

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
  // Not everyone has picked skills — the profile-completeness table is only
  // legible when some rows are genuinely empty.
  const hasSkills = chance(0.75);
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
    location: chance(0.9) ? faker.helpers.arrayElement(US_CA_CITIES) : null,
    clientIntro: hasIntro ? faker.lorem.paragraph() : null,
    clientIntroUpdatedAt: hasIntro ? faker.date.recent({ days: 120 }) : null,
    resume: hasResume ? faker.lorem.paragraphs(2) : null,
    resumeUpdatedAt: hasResume ? faker.date.recent({ days: 120 }) : null,
    allocationNotes: chance(0.4) ? faker.lorem.sentence() : null,
    skills: hasSkills ? pickSkills() : [],
    skillsUpdatedAt: hasSkills ? faker.date.recent({ days: 120 }) : null,
    joinDate,
    terminationDate: departed ? pastDate(1) : null,
    isActive: !departed,
  };
}
