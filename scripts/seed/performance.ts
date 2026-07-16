import type { InferInsertModel } from "drizzle-orm";
import { generateId } from "@/lib/db/ids";
import { feedback, type Staff } from "@/lib/db/schema";
import { FEEDBACK_RATINGS } from "@/lib/feedback-rating";
import type { SeedDb } from "./client";
import { chance, faker } from "./faker";

const FEEDBACK_COUNT = 50;

type FeedbackInsert = InferInsertModel<typeof feedback>;

/** Seed peer feedback between random pairs of active staff. */
export async function seedFeedback(
  db: SeedDb,
  staff: Staff[],
): Promise<number> {
  const active = staff.filter((s) => s.isActive);
  if (active.length < 2) return 0;

  const rows: FeedbackInsert[] = [];
  for (let i = 0; i < FEEDBACK_COUNT; i++) {
    const [from, to] = faker.helpers.arrayElements(active, 2);
    rows.push({
      id: generateId("fb"),
      fromStaffId: from.id,
      toStaffId: to.id,
      rating: faker.helpers.arrayElement(FEEDBACK_RATINGS),
      context: faker.lorem.sentence(),
      keepDoing: chance(0.7) ? faker.lorem.sentence() : null,
      stopDoing: chance(0.4) ? faker.lorem.sentence() : null,
      startDoing: chance(0.5) ? faker.lorem.sentence() : null,
      other: chance(0.2) ? faker.lorem.sentence() : null,
      messageToRecipient: chance(0.6) ? faker.lorem.sentences(2) : null,
    });
  }

  await db.insert(feedback).values(rows);
  return rows.length;
}
