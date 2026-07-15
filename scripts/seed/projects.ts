import type { InferInsertModel } from "drizzle-orm";
import { generateId } from "@/lib/db/ids";
import {
  type Company,
  type Opportunity,
  type Project,
  projectDeliveryManagers,
  projectRoles,
  projects,
  type Staff,
} from "@/lib/db/schema";
import { LINE_OF_BUSINESS } from "@/lib/line-of-business";
import { PROJECT_ROLE_TYPES } from "@/lib/project-role-type";
import { PROJECT_STATUSES } from "@/lib/project-status";
import type { SeedDb } from "./client";
import { chance, faker, isoDate } from "./faker";

const PROJECT_COUNT = 15;

type ProjectInsert = InferInsertModel<typeof projects>;
type DeliveryManagerInsert = InferInsertModel<typeof projectDeliveryManagers>;
type RoleInsert = InferInsertModel<typeof projectRoles>;

/**
 * Seed projects (some originating from closed-won opportunities, respecting the
 * ≤1-project-per-opportunity constraint), their delivery managers, and staffing
 * roles — a mix of staffed and open (unstaffed) positions.
 */
export async function seedProjects(
  db: SeedDb,
  companies: Company[],
  opportunities: Opportunity[],
  staff: Staff[],
): Promise<Project[]> {
  // Each opportunity can back at most one project — hand them out one at a time.
  const wonOpps = opportunities.filter((o) => o.status === "closed_won");
  let wonCursor = 0;

  const projectRows: ProjectInsert[] = Array.from(
    { length: PROJECT_COUNT },
    () => {
      // Consume a distinct closed-won opportunity when one is available.
      const opp =
        wonCursor < wonOpps.length && chance(0.7) ? wonOpps[wonCursor++] : null;
      const companyId =
        (opp && companies.find((c) => c.id === opp.companyId)?.id) ??
        faker.helpers.arrayElement(companies).id;
      return {
        id: generateId("project"),
        name: `${faker.commerce.productName()} ${faker.helpers.arrayElement(["Platform", "Revamp", "Migration", "MVP", "Integration"])}`,
        // Projects from a won deal are already underway; standalone ones vary.
        status: opp
          ? faker.helpers.arrayElement(["confirmed", "paused"] as const)
          : faker.helpers.arrayElement(PROJECT_STATUSES),
        companyId,
        // Inherit the originating opportunity's line of business (mirrors createProject).
        lineOfBusiness:
          opp?.lineOfBusiness ?? faker.helpers.arrayElement(LINE_OF_BUSINESS),
        opportunityId: opp?.id ?? null,
      };
    },
  );
  await db.insert(projects).values(projectRows);

  const deliveryManagers: DeliveryManagerInsert[] = [];
  const roles: RoleInsert[] = [];

  for (const project of projectRows) {
    // 1–2 delivery managers (distinct → no duplicate pairs).
    for (const s of faker.helpers.arrayElements(
      staff,
      faker.number.int({ min: 1, max: 2 }),
    )) {
      deliveryManagers.push({
        id: generateId("pdm"),
        projectId: project.id,
        staffId: s.id,
      });
    }

    // 2–4 staffing lines; some left open (null staffId) as unfilled positions.
    const roleCount = faker.number.int({ min: 2, max: 4 });
    const start = faker.date.recent({ days: 90 });
    const end = new Date(start);
    end.setMonth(end.getMonth() + faker.number.int({ min: 2, max: 8 }));
    for (let i = 0; i < roleCount; i++) {
      const open = chance(0.25);
      roles.push({
        id: generateId("role"),
        projectId: project.id,
        staffId: open ? null : faker.helpers.arrayElement(staff).id,
        name: chance(0.5) ? faker.person.jobTitle() : null,
        roleType: faker.helpers.arrayElement(PROJECT_ROLE_TYPES),
        startDate: isoDate(start),
        endDate: isoDate(end),
        hoursPerDay: faker.helpers.arrayElement([8, 7.5, 4, 6]),
      });
    }
  }

  await db.insert(projectDeliveryManagers).values(deliveryManagers);
  await db.insert(projectRoles).values(roles);

  return db.query.projects.findMany();
}
