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
 * Format a timezone-agnostic "YYYY-MM-DD" date string for display, without the
 * UTC-offset drift you'd get from `new Date("2024-03-15")`. See the database
 * rule on dates being wall-clock values.
 */
export function formatDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(year, month - 1, day));
}

/** Format a timestamp (e.g. `resumeUpdatedAt`) as a long date, e.g. "June 18, 2026". */
export function formatTimestamp(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(value);
}
