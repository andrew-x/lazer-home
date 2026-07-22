import { faker } from "@faker-js/faker";
import { formatIsoDate } from "@/lib/format/format";

/**
 * A single faker instance seeded with a fixed value so every run of the seed
 * produces the same dataset (paired with wipe-and-reseed, runs are fully
 * reproducible). Bump the seed if you want a fresh-looking dataset.
 */
faker.seed(20260715);

export { faker };

/** Format a JS `Date` as the timezone-agnostic `"YYYY-MM-DD"` the DB expects. */
export function isoDate(date: Date): string {
  return formatIsoDate(date);
}

/** A random `"YYYY-MM-DD"` between `yearsAgo` ago and today. */
export function pastDate(yearsAgo: number): string {
  return isoDate(faker.date.past({ years: yearsAgo }));
}

/** Money rounded to 2 decimals (numeric(12,2) columns are `mode: "number"`). */
export function money(min: number, max: number): number {
  return Math.round(faker.number.float({ min, max }) * 100) / 100;
}

/** Pick roughly `fraction` of the time (0..1). */
export function chance(fraction: number): boolean {
  return faker.number.float({ min: 0, max: 1 }) < fraction;
}
