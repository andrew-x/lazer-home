import { eq, type InferInsertModel } from "drizzle-orm";
import { LINE_OF_BUSINESS } from "@/lib/crm/line-of-business";
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
import { CURRENCY } from "@/lib/format/currency";
import { PROJECT_ROLE_STATUSES } from "@/lib/projects/project-role-status";
import { PROJECT_ROLE_TYPES } from "@/lib/projects/project-role-type";
import type { SeedDb } from "./client";
import { chance, faker, isoDate, money, monthsAgo } from "./faker";

const PROJECT_COUNT = 15;

type ProjectInsert = InferInsertModel<typeof projects>;
type DeliveryManagerInsert = InferInsertModel<typeof projectDeliveryManagers>;
type RoleInsert = InferInsertModel<typeof projectRoles>;

/**
 * The billing columns for one project, spanning all three real states: a fixed fee
 * (a total + currency), time and materials (no stored money at all — it bills at the
 * standard rate card in `@/lib/projects/bill-rates`), and no budget whatsoever. The
 * last is not an oversight: every project created before budgets existed has none, so
 * the "No budget set" state needs to be exercised on real seeded data. The
 * `projects_budget_shape` check constraint rejects any other combination, so this is
 * the one place to get it right.
 */
function billingFor(): Pick<
  ProjectInsert,
  "billingType" | "budgetAmount" | "budgetCurrency"
> {
  const roll = faker.number.float({ min: 0, max: 1 });
  if (roll < 0.4) {
    return {
      billingType: "FIXED_FEE",
      budgetAmount: money(80_000, 1_200_000),
      budgetCurrency: faker.helpers.arrayElement(CURRENCY),
    };
  }
  if (roll < 0.8) {
    return {
      billingType: "TIME_AND_MATERIALS",
      budgetAmount: null,
      budgetCurrency: null,
    };
  }
  return { billingType: null, budgetAmount: null, budgetCurrency: null };
}

/**
 * Seed projects (some originating from closed-won opportunities, respecting the
 * ≤1-project-per-opportunity constraint), their delivery managers, and staffing
 * roles — a mix of staffed and open (unstaffed) positions. The CRM → delivery
 * link lives on `opportunities.projectId`, set below for the won opps that
 * spawned a project; those projects' roles are tagged with the opportunity and
 * marked confirmed (won), while standalone projects' roles vary across statuses.
 * A project has no stored status or line of business — both are derived from its
 * roles — so those live on the roles here (mirroring the app). The mix spans every
 * section of the projects list: live work, engagements that already finished, and
 * a few cancelled outright.
 *
 * Each project also gets one of the three billing states (fixed fee / time and
 * materials / no budget) — see {@link billingFor}.
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
      ...billingFor(),
    };
    // Part of the book is history, so the list's Past and Cancelled sections have
    // something in them: `finished` engagements ran and ended before today,
    // `cancelled` ones were called off (only meaningful for standalone projects —
    // a project born from a won opportunity is confirmed by definition).
    const finished = chance(0.35);
    const cancelled = !opp && !finished && chance(0.15);
    return { project, opp, finished, cancelled };
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
  for (const { project, opp, finished, cancelled } of entries) {
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
    // A finished engagement starts 10–36 months back and runs 2–8, so it always
    // ends before today; a live one started within the last 90 days.
    const start = finished
      ? monthsAgo(faker.number.int({ min: 10, max: 36 }))
      : faker.date.recent({ days: 90 });
    const end = new Date(start);
    end.setMonth(end.getMonth() + faker.number.int({ min: 2, max: 8 }));
    // Every role of a cancelled project is cancelled; won-from-CRM and delivered
    // projects are confirmed; live standalone projects vary across statuses.
    const roleStatus = (): RoleInsert["status"] => {
      if (cancelled) return "cancelled";
      if (opp || finished) return "confirmed";
      return faker.helpers.arrayElement(PROJECT_ROLE_STATUSES);
    };
    for (let i = 0; i < roleCount; i++) {
      const open = chance(0.25);
      roles.push({
        id: generateId("role"),
        projectId: project.id,
        staffId: open ? null : faker.helpers.arrayElement(staff).id,
        // Roles born from a won opportunity carry it and are confirmed;
        // standalone-project roles vary across statuses and are untagged.
        opportunityId: opp?.id ?? null,
        status: roleStatus(),
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
