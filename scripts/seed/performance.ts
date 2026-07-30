import type { InferInsertModel } from "drizzle-orm";
import { generateId } from "@/lib/db/ids";
import {
  compensationPlan,
  compensationPlanItem,
  feedback,
  performanceReviewNote,
  type Staff,
  staffEmployment,
  staffRating,
  staffSelfEvaluation,
} from "@/lib/db/schema";
import { parseIsoDate } from "@/lib/format/format";
import {
  type CompensationPlanItemStatus,
  currentCompAmount,
} from "@/lib/performance/compensation-plan";
import {
  FEEDBACK_RATINGS,
  type FeedbackRating,
} from "@/lib/performance/feedback-rating";
import {
  rubricForRole,
  SUBRATING_LEVELS,
  type Subratings,
} from "@/lib/performance/rating-rubric";
import {
  buildSelfEvaluationEntries,
  SELF_EVALUATION_QUESTION_IDS,
  SELF_EVALUATION_QUESTION_SET_VERSION,
  type SelfEvaluationQuestionId,
} from "@/lib/performance/self-evaluation";
import type { SeedDb } from "./client";
import { chance, faker, isoDate } from "./faker";

const FEEDBACK_COUNT = 50;

type FeedbackInsert = InferInsertModel<typeof feedback>;
type ReviewNoteInsert = InferInsertModel<typeof performanceReviewNote>;
type StaffRatingInsert = InferInsertModel<typeof staffRating>;
type StaffSelfEvaluationInsert = InferInsertModel<typeof staffSelfEvaluation>;
type CompensationPlanInsert = InferInsertModel<typeof compensationPlan>;
type CompensationPlanItemInsert = InferInsertModel<typeof compensationPlanItem>;

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

/** Share of managed staff who get review notes at all. */
const REVIEW_NOTE_COVERAGE = 0.6;
const MAX_REVIEW_NOTES_PER_STAFF = 3;
/** Chance the most recent note is still an unshared draft. */
const REVIEW_NOTE_DRAFT_CHANCE = 0.35;

const REVIEW_NOTE_TITLES = [
  "Mid-year review conversation",
  "Annual review conversation",
  "Quarterly check-in",
  "Promotion discussion",
  "Growth areas follow-up",
];

/**
 * Seed performance review notes, attributed to each person's **manager** — the
 * reporting line is what grants access to a note (see
 * `src/actions/performance/reviewNoteAccess.ts`), so the manager is the only
 * sensible author.
 *
 * **`authorUserId` is null for most rows, and that's correct here:** `seedStaff`
 * links a `user` account to exactly one staff row (the admin), because accounts
 * only exist for people who have signed in with Google. A null author models the
 * `onDelete: "set null"` state the schema allows — the note stays readable
 * through the reporting line, it just has no author name and no author path. The
 * notes reachable by the seeded admin's own reports do carry their id.
 *
 * Each covered person gets 1–3 dated notes, oldest first, all `SHARED` except
 * (sometimes) the most recent, which is left a `DRAFT` — so the manager view has
 * something only they can see, and the subject view has something to read.
 */
export async function seedReviewNotes(
  db: SeedDb,
  staff: Staff[],
): Promise<number> {
  const byId = new Map(staff.map((person) => [person.id, person]));
  const rows: ReviewNoteInsert[] = [];

  for (const person of staff) {
    if (!person.isActive || !person.managerId) continue;
    // Same self-guard the reads apply: a self-pointing managerId is reachable
    // through a bad import and must never make someone their own note-manager.
    if (person.managerId === person.id) continue;

    const manager = byId.get(person.managerId);
    if (!manager) continue;
    if (!chance(REVIEW_NOTE_COVERAGE)) continue;

    const count = faker.number.int({
      min: 1,
      max: MAX_REVIEW_NOTES_PER_STAFF,
    });
    const dates = Array.from({ length: count }, () =>
      isoDate(faker.date.past({ years: 2 })),
    ).sort();

    dates.forEach((noteDate, index) => {
      const draft = index === count - 1 && chance(REVIEW_NOTE_DRAFT_CHANCE);
      rows.push({
        id: generateId("prn"),
        staffId: person.id,
        authorUserId: manager.userId,
        noteDate,
        title: chance(0.7)
          ? faker.helpers.arrayElement(REVIEW_NOTE_TITLES)
          : null,
        body: faker.lorem.paragraphs(2),
        status: draft ? "DRAFT" : "SHARED",
        // Shared the day of the conversation. `parseIsoDate` keeps the wall-clock
        // date intact (`new Date("YYYY-MM-DD")` would drift by the UTC offset).
        sharedAt: draft ? null : parseIsoDate(noteDate),
      });
    });
  }

  if (rows.length > 0) await db.insert(performanceReviewNote).values(rows);
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
 * The current rating also carries per-role subratings (random L1–L4 across the
 * role's rubric) so the edit grid's subrating matrix has data to show.
 */
export async function seedRatings(db: SeedDb, staff: Staff[]): Promise<number> {
  const active = staff.filter((s) => s.isActive);

  // Current role per staff (subratings are role-specific). One employment row
  // per person in the seed, so the first match is the current role.
  const employmentRows = await db
    .select({ staffId: staffEmployment.staffId, role: staffEmployment.role })
    .from(staffEmployment);
  const roleByStaff = new Map(employmentRows.map((e) => [e.staffId, e.role]));

  const rows: StaffRatingInsert[] = [];

  for (const person of active) {
    if (chance(UNRATED_FRACTION)) continue; // leave unrated

    const currentLevel = faker.helpers.weightedArrayElement(LEVEL_WEIGHTS);
    const currentDate = faker.date.past({ years: 1 });

    // Random subratings across the person's role rubric (null when none).
    const rubric = rubricForRole(roleByStaff.get(person.id) ?? null);
    const subratings: Subratings | null = rubric.length
      ? Object.fromEntries(
          rubric.map((c) => [
            c.key,
            faker.helpers.arrayElement(SUBRATING_LEVELS),
          ]),
        )
      : null;

    // A prior evaluation one level lower, on a strictly earlier date (refDate
    // guarantees ordering) — models a promotion into the current level. No
    // subratings on the historical row (they were introduced later).
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
      subratings,
    });
  }

  if (rows.length > 0) await db.insert(staffRating).values(rows);
  return rows.length;
}

// --- Self-evaluations ------------------------------------------------------

/** Share of active staff who have written a self-evaluation at all. */
const SELF_EVALUATION_COVERAGE = 0.55;
const MAX_SELF_EVALUATIONS_PER_STAFF = 2;
/** Chance any one prompt is left blank — a thin record is a real shape. */
const SELF_EVALUATION_SKIP_CHANCE = 0.25;

/**
 * People rate themselves generously, but not uniformly — weighted so the badge has
 * variety without "Needs improvement" being as common as "Solid contributor".
 */
const SELF_RATING_WEIGHTS = [
  { value: "ABOVE_AND_BEYOND", weight: 2 },
  { value: "TOP_PERFORMER", weight: 5 },
  { value: "SOLID_CONTRIBUTOR", weight: 6 },
  { value: "MINOR_MISSES", weight: 2 },
  { value: "NEEDS_IMPROVEMENT", weight: 1 },
] as const satisfies { value: FeedbackRating; weight: number }[];

/**
 * Seed self-evaluations for a bit over half of active staff, 1–2 each, submitted
 * across the last ~18 months.
 *
 * `createdAt` is set explicitly — it is the record's only date, so leaving it to
 * `defaultNow()` would stack every seeded record on today and make the list
 * meaningless. `updatedAt` is set to the SAME instant on purpose: the panel marks a
 * record "edited" when `updatedAt > createdAt`, and its own `defaultNow()` would
 * otherwise label every seeded record as edited.
 *
 * Entries go through the **real `buildSelfEvaluationEntries`** rather than being
 * hand-assembled: that keeps the seed a genuine drift guard (a question-set change
 * that breaks the stored shape fails `bun run check`) and means seeded records carry
 * exactly the section/prompt snapshot the app writes.
 */
export async function seedSelfEvaluations(
  db: SeedDb,
  staff: Staff[],
): Promise<number> {
  const rows: StaffSelfEvaluationInsert[] = [];

  for (const person of staff.filter((s) => s.isActive)) {
    if (!chance(SELF_EVALUATION_COVERAGE)) continue;

    const count = faker.number.int({
      min: 1,
      max: MAX_SELF_EVALUATIONS_PER_STAFF,
    });

    for (let i = 0; i < count; i++) {
      const answers = Object.fromEntries(
        SELF_EVALUATION_QUESTION_IDS.map((questionId) => [
          questionId,
          chance(SELF_EVALUATION_SKIP_CHANCE) ? null : faker.lorem.paragraph(),
        ]),
      ) as Record<SelfEvaluationQuestionId, string | null>;

      const submittedAt = faker.date.past({ years: 1.5 });

      rows.push({
        id: generateId("sev"),
        staffId: person.id,
        questionSetVersion: SELF_EVALUATION_QUESTION_SET_VERSION,
        selfRating: faker.helpers.weightedArrayElement([
          ...SELF_RATING_WEIGHTS,
        ]),
        answers: buildSelfEvaluationEntries(answers),
        createdAt: submittedAt,
        updatedAt: submittedAt,
      });
    }
  }

  if (rows.length > 0) await db.insert(staffSelfEvaluation).values(rows);
  return rows.length;
}

// --- Compensation plans ----------------------------------------------------

const PLAN_STAFF_COUNT = 12;
/** Roughly the spread of a real review round: mostly modest, a few standouts. */
const RAISE_WEIGHTS = [
  { value: 0, weight: 2 },
  { value: 0.03, weight: 4 },
  { value: 0.05, weight: 5 },
  { value: 0.08, weight: 3 },
  { value: 0.15, weight: 1 },
];

/**
 * Discretionary bonuses go to a minority, in round lump sums. Fixed amounts rather
 * than a percentage of pay because that is what a lump sum is — and deriving one
 * from `currentCompAmount` would hand hourly staff a bonus of a few dollars, since
 * their figure is a rate. Most rows stay null so the empty cell renders too.
 */
const BONUS_CHANCE = 0.4;
const BONUS_AMOUNTS = [2000, 3000, 5000, 7500, 10000, 15000];

/**
 * A round in progress: a tail of people not started, most part-way through, some
 * finished. Spread across all four stages so the status control has something to
 * show in every state.
 */
const PLAN_ITEM_STATUS_WEIGHTS: {
  value: CompensationPlanItemStatus;
  weight: number;
}[] = [
  { value: "NOT_STARTED", weight: 3 },
  { value: "RATING_DONE", weight: 4 },
  { value: "MEETING_DONE", weight: 3 },
  { value: "COMPLETE", weight: 2 },
];

/**
 * Seed one draft plan and one committed plan so both renderings of the editor
 * have data: the draft exercises save-on-edit against live compensation, and the
 * committed one exercises the frozen snapshot plus the "not applied" drift badge
 * (its planned figures deliberately differ from live comp, because this app never
 * writes compensation — Rippling does).
 */
export async function seedCompensationPlans(
  db: SeedDb,
  staff: Staff[],
): Promise<number> {
  const active = staff.filter((s) => s.isActive);
  if (active.length === 0) return 0;

  const employmentRows = await db
    .select({
      staffId: staffEmployment.staffId,
      employmentType: staffEmployment.employmentType,
      base: staffEmployment.base,
      hourlyRate: staffEmployment.hourlyRate,
      currency: staffEmployment.currency,
    })
    .from(staffEmployment);
  const employmentByStaff = new Map(
    employmentRows.map((row) => [row.staffId, row]),
  );

  const ratingRows = await db
    .select({ staffId: staffRating.staffId, level: staffRating.level })
    .from(staffRating);
  const levelByStaff = new Map(
    ratingRows.map((row) => [row.staffId, row.level]),
  );

  const plans: CompensationPlanInsert[] = [];
  const items: CompensationPlanItemInsert[] = [];

  for (const status of ["DRAFT", "COMMITTED"] as const) {
    const planId = generateId("cplan");
    const committed = status === "COMMITTED";
    const effectiveDate = isoDate(
      committed ? faker.date.past({ years: 1 }) : faker.date.soon({ days: 45 }),
    );

    plans.push({
      id: planId,
      name: committed ? "2025 annual review" : "H2 2026 review",
      status,
      effectiveDate,
      committedAt: committed ? faker.date.past({ years: 1 }) : null,
    });

    for (const person of faker.helpers.arrayElements(
      active,
      Math.min(PLAN_STAFF_COUNT, active.length),
    )) {
      const employment = employmentByStaff.get(person.id);
      const current = currentCompAmount(employment ?? null);
      const raise = faker.helpers.weightedArrayElement(RAISE_WEIGHTS);
      const planned =
        current == null ? null : Math.round(current * (1 + raise));

      items.push({
        id: generateId("cplanitem"),
        planId,
        staffId: person.id,
        level: levelByStaff.get(person.id) ?? null,
        plannedAmount: planned,
        // Needs a currency to be interpretable, so only where there is employment.
        plannedBonus:
          employment && chance(BONUS_CHANCE)
            ? faker.helpers.arrayElement(BONUS_AMOUNTS)
            : null,
        plannedCurrency: employment?.currency ?? null,
        // A committed plan is by definition finished for everyone in it.
        status: committed
          ? "COMPLETE"
          : faker.helpers.weightedArrayElement(PLAN_ITEM_STATUS_WEIGHTS),
        evaluationNotes: chance(0.5) ? faker.lorem.sentences(2) : null,
        compensationNotes: chance(0.4) ? faker.lorem.sentence() : null,
        // Committed plans carry the frozen before-figures; drafts read live.
        snapshotAmount: committed ? current : null,
        snapshotCurrency: committed ? (employment?.currency ?? null) : null,
        snapshotEmploymentType: committed
          ? (employment?.employmentType ?? null)
          : null,
      });
    }
  }

  await db.insert(compensationPlan).values(plans);
  if (items.length > 0) await db.insert(compensationPlanItem).values(items);
  return plans.length;
}
