/**
 * Skills catalogue and proficiency levels.
 *
 * Skills live on a staff profile as an inline list (see the `skills` jsonb column
 * on the `staff` table) rather than a normalized table — each entry pairs a skill
 * name from this hardcoded catalogue with a proficiency level. This module is the
 * single source of truth for both the catalogue and the levels, and is imported by
 * client form UI, server validation, AND the Drizzle schema, so it must stay free
 * of `server-only` imports (like `staff-import/types.ts`).
 *
 * NOTE: `SKILL_CATEGORIES` below is a PLACEHOLDER set — the full curated list will
 * replace it later. The shape (discipline → skills) is what the picker relies on.
 */

// --- Proficiency levels ----------------------------------------------------

// Ordered from most to least proficient — drives display order everywhere.
export const PROFICIENCY_LEVELS = [
  "senior",
  "intermediate",
  "learning",
] as const;

export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number];

export const PROFICIENCY_LABELS: Record<ProficiencyLevel, string> = {
  senior: "Senior",
  intermediate: "Intermediate",
  learning: "Learning",
};

// --- Skill catalogue (placeholder) -----------------------------------------

/**
 * The predefined skills a person can pick from, grouped by discipline. Order is
 * meaningful — categories and skills render in this order in the picker.
 */
export const SKILL_CATEGORIES = [
  {
    name: "Languages",
    skills: [
      "TypeScript",
      "JavaScript",
      "Python",
      "Go",
      "Rust",
      "Java",
      "Ruby",
      "SQL",
    ],
  },
  {
    name: "Frameworks",
    skills: ["React", "Next.js", "Node.js", "Django", "Rails", "Spring"],
  },
  {
    name: "Cloud & Infra",
    skills: ["AWS", "GCP", "Azure", "Docker", "Kubernetes", "Terraform"],
  },
  {
    name: "Data",
    skills: ["PostgreSQL", "Redis", "Kafka", "Spark", "dbt"],
  },
  {
    name: "Design",
    skills: ["Figma", "UX Research", "Prototyping", "Design Systems"],
  },
] as const satisfies ReadonlyArray<{
  name: string;
  skills: readonly string[];
}>;

/** Flat list of every catalogue skill, for membership validation. */
export const ALL_SKILLS: readonly string[] = SKILL_CATEGORIES.flatMap(
  (category) => category.skills,
);

/** Map of skill name → its discipline, for grouping on display. */
export const SKILL_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  SKILL_CATEGORIES.flatMap((category) =>
    category.skills.map((skill) => [skill, category.name] as const),
  ),
);

/** A skill a person holds, at a given proficiency level. */
export type StaffSkill = { name: string; level: ProficiencyLevel };
