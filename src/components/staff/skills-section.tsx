import { Badge } from "@/components/ui/badge";
import {
  PROFICIENCY_LABELS,
  PROFICIENCY_LEVELS,
  type StaffSkill,
} from "@/lib/skills";

/**
 * Read view of a person's skills, grouped by proficiency level (Senior →
 * Intermediate → Learning). Rendered inside the profile's Skills card.
 */
export function SkillsSection({ skills }: { skills: StaffSkill[] }) {
  if (skills.length === 0) {
    return <p className="text-sm text-muted-foreground">No skills yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {PROFICIENCY_LEVELS.map((level) => {
        const atLevel = skills.filter((skill) => skill.level === level);
        if (atLevel.length === 0) return null;
        return (
          <div key={level} className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {PROFICIENCY_LABELS[level]}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {atLevel.map((skill) => (
                <Badge key={skill.name} variant="secondary">
                  {skill.name}
                </Badge>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
