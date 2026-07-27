import type { InferInsertModel } from "drizzle-orm";
import { generateId } from "@/lib/db/ids";
import {
  type Company,
  type Contact,
  type Opportunity,
  type Staff,
  tasks,
} from "@/lib/db/schema";
import type { SeedDb } from "./client";
import { faker } from "./faker";

type TaskInsert = InferInsertModel<typeof tasks>;

/** Shared fields for a synthetic task on any parent — owner, creator, and a
 * done/open state with a matching `completedAt`. */
function makeTask(staff: Staff[]): Omit<TaskInsert, "id"> {
  const createdAt = faker.date.recent({ days: 45 });
  const done = faker.datatype.boolean({ probability: 0.35 });
  return {
    description: faker.lorem.sentence(),
    ownerStaffId: faker.helpers.arrayElement(staff).id,
    creatorStaffId: faker.helpers.arrayElement(staff).id,
    done,
    // Completed some time after creation; null while still open.
    completedAt: done ? faker.date.recent({ days: 10 }) : null,
    createdAt,
    updatedAt: createdAt,
  };
}

/**
 * Seed tasks across companies, contacts, and opportunities. Each parent gets a
 * few tasks, a mix of open and done, assigned to and created by random staff —
 * so every detail page's Tasks card and every list's open-tasks summary reads as
 * a real backlog. Each task attaches to exactly one parent (the DB CHECK enforces
 * it).
 */
export async function seedTasks(
  db: SeedDb,
  companies: Company[],
  contacts: Contact[],
  opportunities: Opportunity[],
  staff: Staff[],
): Promise<number> {
  const rows: TaskInsert[] = [];

  for (const company of companies) {
    const count = faker.number.int({ min: 0, max: 2 });
    for (let i = 0; i < count; i++) {
      rows.push({
        id: generateId("task"),
        ...makeTask(staff),
        companyId: company.id,
      });
    }
  }

  for (const contact of contacts) {
    const count = faker.number.int({ min: 0, max: 3 });
    for (let i = 0; i < count; i++) {
      rows.push({
        id: generateId("task"),
        ...makeTask(staff),
        contactId: contact.id,
      });
    }
  }

  for (const opportunity of opportunities) {
    const count = faker.number.int({ min: 0, max: 3 });
    for (let i = 0; i < count; i++) {
      rows.push({
        id: generateId("task"),
        ...makeTask(staff),
        opportunityId: opportunity.id,
      });
    }
  }

  if (rows.length > 0) await db.insert(tasks).values(rows);
  return rows.length;
}
