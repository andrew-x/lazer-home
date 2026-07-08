import { z } from "zod";
import { ALL_SKILLS, PROFICIENCY_LEVELS } from "@/lib/skills";

const knownSkills = new Set<string>(ALL_SKILLS);

/**
 * Skills edit input. Each entry pairs a catalogue skill name with a level; a skill
 * may appear at most once (one level per skill). Lives in its own file so the edit
 * form can import it for the resolver (never export schemas from a "use server"
 * file). Unknown skill names are rejected — the client only ever picks from the
 * catalogue, so this guards against a crafted payload.
 */
export const updateStaffSkillsSchema = z.object({
  staffId: z.string().min(1),
  skills: z
    .array(
      z.object({
        name: z.string().min(1),
        level: z.enum(PROFICIENCY_LEVELS),
      }),
    )
    .max(200, "Too many skills.")
    .superRefine((skills, ctx) => {
      const seen = new Set<string>();
      for (const [index, skill] of skills.entries()) {
        if (!knownSkills.has(skill.name)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown skill: ${skill.name}`,
            path: [index, "name"],
          });
        }
        if (seen.has(skill.name)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate skill: ${skill.name}`,
            path: [index, "name"],
          });
        }
        seen.add(skill.name);
      }
    }),
});

export type UpdateStaffSkillsInput = z.input<typeof updateStaffSkillsSchema>;
