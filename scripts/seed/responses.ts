import type { InferInsertModel } from "drizzle-orm";
import { generateId } from "@/lib/db/ids";
import { responses, type Staff } from "@/lib/db/schema";
import { MANUAL_OF_ME_QUESTION_IDS } from "@/lib/staff/manual-of-me";
import { WOW_SECTIONS } from "@/lib/staff/ways-of-working";
import type { SeedDb } from "./client";
import { chance, faker } from "./faker";

type ResponseInsert = InferInsertModel<typeof responses>;

/** One answered question. `updatedAt` is pinned at/after `createdAt` so the
 * profile-completeness table's "last updated" columns have a real spread to
 * sort, rather than every row reading as saved just now. */
function makeResponse(
  staffId: string,
  questionId: string,
  value: { textResponse?: string; listResponse?: string[] },
): ResponseInsert {
  const createdAt = faker.date.recent({ days: 240 });
  return {
    id: generateId("resp"),
    staffId,
    questionId,
    textResponse: value.textResponse ?? null,
    listResponse: value.listResponse ?? null,
    createdAt,
    updatedAt: faker.date.between({ from: createdAt, to: new Date() }),
  };
}

function pickSome(options: readonly string[]): string[] {
  return faker.helpers.arrayElements(
    options,
    faker.number.int({ min: 1, max: Math.min(4, options.length) }),
  );
}

/**
 * Answers for one person's Ways of Working survey, walked generically off
 * `WOW_SECTIONS` rather than a hardcoded id list — a section added to the survey
 * is seeded automatically, and the list-vs-text shape per question can't drift
 * from the module that defines it.
 *
 * `answerRate` is applied per field, so people land at partial completion. That
 * matters: the completeness table exists to distinguish "started" from
 * "finished", and a seed where everyone is 0/30 or 30/30 wouldn't show it.
 */
function waysOfWorkingFor(staffId: string, answerRate: number) {
  const rows: ResponseInsert[] = [];

  /** Answer a section's fields at `answerRate`. Taking the field list as an
   * argument (rather than reading `section.fields` inside) is what lets the
   * switch below narrow each section to its own field type. */
  const answerFields = <F extends { questionId: string }>(
    fields: readonly F[],
    value: (field: F) => { textResponse?: string; listResponse?: string[] },
  ) => {
    for (const field of fields) {
      if (!chance(answerRate)) continue;
      rows.push(makeResponse(staffId, field.questionId, value(field)));
    }
  };

  for (const section of WOW_SECTIONS) {
    if (section.kind === "matrix") {
      if (!chance(answerRate)) continue;
      // Each tagged item belongs to exactly one usage tier and one savings tier
      // — the six list-backed ids the matrix decomposes into. Partition a
      // sample rather than sampling each tier independently, so an item can't
      // contradict itself by appearing under two tiers.
      const items = faker.helpers.shuffle(
        section.groups.flatMap((group) => [...group.items]),
      );
      const tagged = items.slice(0, faker.number.int({ min: 3, max: 9 }));
      const split = <T>(list: T[], buckets: number) => {
        const size = Math.ceil(list.length / buckets) || 1;
        return Array.from({ length: buckets }, (_, i) =>
          list.slice(i * size, (i + 1) * size),
        );
      };

      const [critical, common, avoid] = split(tagged, 3);
      const [major, minor, no] = split(faker.helpers.shuffle(tagged), 3);
      const tiers: [string, string[]][] = [
        [section.usage.critical, critical],
        [section.usage.common, common],
        [section.usage.avoid, avoid],
        [section.savings.major, major],
        [section.savings.minor, minor],
        [section.savings.no, no],
      ];
      for (const [questionId, list] of tiers) {
        if (list.length === 0) continue;
        rows.push(makeResponse(staffId, questionId, { listResponse: list }));
      }
      continue;
    }

    switch (section.kind) {
      case "multiselect":
        answerFields(section.fields, (field) => ({
          listResponse: pickSome(field.options),
        }));
        break;
      case "single-select":
        answerFields(section.fields, (field) => ({
          textResponse: faker.helpers.arrayElement(field.options),
        }));
        break;
      case "text":
        answerFields(section.fields, () => ({
          textResponse: faker.lorem.sentences(2),
        }));
        break;
    }
  }

  return rows;
}

/**
 * Seed the generic `responses` table for both profile surveys — Manual of Me and
 * Ways of Working.
 *
 * Nothing seeded these before, so both survey columns on
 * `/reporting/profile-completeness` read 0 for everyone on a fresh database and the
 * feature couldn't be eyeballed. Coverage is deliberately uneven: some people
 * have neither survey, some have one, some are part-way through.
 */
export async function seedResponses(
  db: SeedDb,
  staff: Staff[],
): Promise<number> {
  const rows: ResponseInsert[] = [];

  for (const person of staff) {
    // Departed staff never filled anything in — leaving their surveys empty
    // keeps "show inactive" visibly different from the default view.
    if (!person.isActive) continue;

    if (chance(0.6)) {
      for (const questionId of MANUAL_OF_ME_QUESTION_IDS) {
        if (!chance(0.7)) continue;
        rows.push(
          makeResponse(person.id, questionId, {
            textResponse: faker.lorem.sentences(2),
          }),
        );
      }
    }

    if (chance(0.45)) {
      rows.push(
        ...waysOfWorkingFor(
          person.id,
          faker.number.float({ min: 0.3, max: 1 }),
        ),
      );
    }
  }

  if (rows.length > 0) await db.insert(responses).values(rows);
  return rows.length;
}
