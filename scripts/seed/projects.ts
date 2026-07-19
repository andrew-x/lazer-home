import { eq, type InferInsertModel } from "drizzle-orm";
import { generateId } from "@/lib/db/ids";
import {
  type Company,
  type Opportunity,
  opportunities as opportunitiesTable,
  type Project,
  projectDeliveryManagers,
  projectRoles,
  projects,
  type Staff,
} from "@/lib/db/schema";
import { LINE_OF_BUSINESS } from "@/lib/line-of-business";
import { PROJECT_ROLE_STATUSES } from "@/lib/project-role-status";
import { PROJECT_ROLE_TYPES } from "@/lib/project-role-type";
import type { SeedDb } from "./client";
import { chance, faker, isoDate } from "./faker";

const PROJECT_COUNT = 15;

type ProjectInsert = InferInsertModel<typeof projects>;
type DeliveryManagerInsert = InferInsertModel<typeof projectDeliveryManagers>;
type RoleInsert = InferInsertModel<typeof projectRoles>;

/**
 * Seed projects (some originating from closed-won opportunities, respecting the
 * ≤1-project-per-opportunity constraint), their delivery managers, and staffing
 * roles — a mix of staffed and open (unstaffed) positions. The CRM → delivery
 * link lives on `opportunities.projectId`, set below for the won opps that
 * spawned a project; those projects' roles are tagged with the opportunity and
 * marked confirmed (won), while standalone projects' roles vary across statuses.
 * A project has no stored status or line of business — both are derived from its
 * roles — so those live on the roles here (mirroring the app).
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

  // Track the originating opportunity (if any) alongside each project so we can
  // set `opportunities.projectId` and tag the project's roles afterward.
  const entries = Array.from({ length: PROJECT_COUNT }, () => {
    // Consume a distinct closed-won opportunity when one is available.
    const opp =
      wonCursor < wonOpps.length && chance(0.7) ? wonOpps[wonCursor++] : null;
    const companyId =
      (opp && companies.find((c) => c.id === opp.companyId)?.id) ??
      faker.helpers.arrayElement(companies).id;
    const project: ProjectInsert = {
      id: generateId("project"),
      name: `${faker.commerce.productName()} ${faker.helpers.arrayElement(["Platform", "Revamp", "Migration", "MVP", "Integration"])}`,
      companyId,
    };
    return { project, opp };
  });

  const projectRows = entries.map((e) => e.project);
  await db.insert(projects).values(projectRows);

  // Set the inverted link on each opportunity that spawned a project.
  for (const { project, opp } of entries) {
    if (opp) {
      await db
        .update(opportunitiesTable)
        .set({ projectId: project.id })
        .where(eq(opportunitiesTable.id, opp.id));
    }
  }

  const deliveryManagers: DeliveryManagerInsert[] = [];
  const roles: RoleInsert[] = [];

  for (const { project, opp } of entries) {
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
        // Roles born from a won opportunity carry it and are confirmed;
        // standalone-project roles vary across statuses and are untagged.
        opportunityId: opp?.id ?? null,
        status: opp
          ? "confirmed"
          : faker.helpers.arrayElement(PROJECT_ROLE_STATUSES),
        // A role's line of business: inherit the originating opportunity's, or a
        // random one for standalone roles (so those projects span several LoBs).
        lineOfBusiness:
          opp?.lineOfBusiness ?? faker.helpers.arrayElement(LINE_OF_BUSINESS),
        description: chance(0.5) ? faker.person.jobTitle() : null,
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
