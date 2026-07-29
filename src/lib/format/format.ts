/** "FULL_TIME" → "Full time", "ENGINEER" → "Engineer". */
export function humanizeEnum(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Up to two initials from a name, falling back to the email's first letter. */
export function initialsFor(name: string, email: string): string {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("") ||
    email[0] ||
    "?"
  ).toUpperCase();
}

/**
 * Format a 0–1 fraction as an unsigned percentage, e.g. `formatPercent(0.349)` →
 * "34.9%"; `null` → "—". Unsigned on purpose: a margin is a level, not a change,
 * so it must not pick up the leading "+" that `formatChangePercent` adds. A
 * negative fraction still renders its minus sign.
 */
export function formatPercent(fraction: number | null): string {
  return fraction == null ? "—" : `${(fraction * 100).toFixed(1)}%`;
}

/** Long-form date options ("June 18, 2026"), shared by the formatters below. */
const LONG_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
};

/**
 * Parse a timezone-agnostic "YYYY-MM-DD" string to a local-midnight Date, without
 * the UTC-offset drift you'd get from `new Date("2024-03-15")`. The shared
 * drift-safe parse — see the database rule on dates being wall-clock values.
 */
export function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Format a Date back to a timezone-agnostic "YYYY-MM-DD" string using its local parts. */
export function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Format a timezone-agnostic "YYYY-MM-DD" date string for display, without the
 * UTC-offset drift you'd get from `new Date("2024-03-15")`. See the database
 * rule on dates being wall-clock values.
 */
export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", LONG_DATE_OPTIONS).format(
    parseIsoDate(value),
  );
}

/** Format a timestamp (e.g. `resumeUpdatedAt`) as a long date, e.g. "June 18, 2026". */
export function formatTimestamp(value: Date): string {
  return new Intl.DateTimeFormat("en-US", LONG_DATE_OPTIONS).format(value);
}

/** Compact date, e.g. "Jul 18, 2026" — for table cells and card lines. */
export function formatShortDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(value);
}

/**
 * Compact range of two "YYYY-MM-DD" date strings, e.g. "Jul 18, 2026 – Aug 1,
 * 2026" (en dash). Both drift-safe via `parseIsoDate`.
 */
export function formatDateRange(start: string, end: string): string {
  return `${formatShortDate(parseIsoDate(start))} – ${formatShortDate(parseIsoDate(end))}`;
}
