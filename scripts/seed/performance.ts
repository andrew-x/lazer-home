import type { InferInsertModel } from "drizzle-orm";
import { generateId } from "@/lib/db/ids";
import { feedback, type Staff, staffRating } from "@/lib/db/schema";
import { FEEDBACK_RATINGS } from "@/lib/performance/feedback-rating";
import type { SeedDb } from "./client";
import { chance, faker, isoDate } from "./faker";

const FEEDBACK_COUNT = 50;

type FeedbackInsert = InferInsertModel<typeof feedback>;
type StaffRatingInsert = InferInsertModel<typeof staffRating>;

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

/** Fraction of active staff left deliberately unrated (no rating rows at all). */
const UNRATED_FRACTION = 0.2;
/** Fraction of rated staff given an earlier evaluation (a promotion history). */
const HISTORY_FRACTION = 0.4;

/** Overall levels weighted toward the middle (bell-ish around L2). */
const LEVEL_WEIGHTS = [
  { value: 0, weight: 1 },
  { value: 1, weight: 3 },
  { value: 2, weight: 5 },
  { value: 3, weight: 3 },
  { value: 4, weight: 1 },
];

/**
 * Seed overall levels (L0–L4) for active staff. Most get a current rating with a
 * bell-ish distribution; ~20% are left unrated; ~40% of the rated also get one
 * earlier, lower dated row so the level history (effective-dating) is non-trivial.
 */
export async function seedRatings(db: SeedDb, staff: Staff[]): Promise<number> {
  const active = staff.filter((s) => s.isActive);
  const rows: StaffRatingInsert[] = [];

  for (const person of active) {
    if (chance(UNRATED_FRACTION)) continue; // leave unrated

    const currentLevel = faker.helpers.weightedArrayElement(LEVEL_WEIGHTS);
    const currentDate = faker.date.past({ years: 1 });

    // A prior evaluation one level lower, on a strictly earlier date (refDate
    // guarantees ordering) — models a promotion into the current level.
    if (chance(HISTORY_FRACTION)) {
      rows.push({
        id: generateId("rating"),
        staffId: person.id,
        effectiveDate: isoDate(
          faker.date.past({ years: 1, refDate: currentDate }),
        ),
        level: Math.max(0, currentLevel - 1),
      });
    }

    rows.push({
      id: generateId("rating"),
      staffId: person.id,
      effectiveDate: isoDate(currentDate),
      level: currentLevel,
    });
  }

  if (rows.length > 0) await db.insert(staffRating).values(rows);
  return rows.length;
}
