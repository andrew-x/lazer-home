import Link from "next/link";
import type { StaffDirectoryEntry } from "@/actions/staff/getStaffDirectory";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { humanizeEnum, initialsFor } from "@/lib/format";
import { PROFICIENCY_LABELS } from "@/lib/skills";
import { cn } from "@/lib/utils";

/**
 * One staff member as a clickable card linking to their profile. When
 * `highlightedSkills` is passed (the active skill search), the person's matching
 * skills render as badges so the card shows why they matched.
 */
export function StaffCard({
  entry,
  highlightedSkills,
}: {
  entry: StaffDirectoryEntry;
  highlightedSkills?: string[];
}) {
  const subtitle = [entry.role, entry.lineOfBusiness]
    .filter((value) => value !== null)
    .map((value) => humanizeEnum(value))
    .join(" · ");

  const matchedSkills = highlightedSkills?.length
    ? entry.skills.filter((skill) => highlightedSkills.includes(skill.name))
    : [];

  // `Card` is a plain <div> that does not forward a Base UI `render` prop, so we
  // wrap it in the Link and carry the padding/hover/layout classes on the Card.
  return (
    <Link href={`/staff/${entry.id}`} aria-label={entry.name} className="block">
      <Card
        className={cn(
          "relative flex flex-col items-center gap-3 p-5 text-center transition-colors hover:bg-accent",
          // Inactive staff read as muted; the badge below is positioned
          // absolutely so it never changes the card's height vs. active cards.
          !entry.isActive && "border-dashed bg-muted/30",
        )}
      >
        {!entry.isActive ? (
          <Badge variant="secondary" className="absolute top-2 right-2">
            Inactive
          </Badge>
        ) : null}
        <Avatar
          className={cn("size-14", !entry.isActive && "opacity-50 grayscale")}
        >
          {entry.imageUrl ? (
            <AvatarImage src={entry.imageUrl} alt={entry.name} />
          ) : null}
          <AvatarFallback>
            {initialsFor(entry.name, entry.email)}
          </AvatarFallback>
        </Avatar>
        <div
          className={cn(
            "flex min-w-0 flex-col gap-1",
            !entry.isActive && "opacity-60",
          )}
        >
          <span className="truncate font-medium">{entry.name}</span>
          {subtitle ? (
            <span className="truncate text-sm text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </div>
        {matchedSkills.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-1">
            {matchedSkills.map((skill) => (
              <Badge
                key={skill.name}
                variant="secondary"
                className="font-normal"
              >
                {skill.name}
                <span className="ml-1 text-muted-foreground">
                  {PROFICIENCY_LABELS[skill.level]}
                </span>
              </Badge>
            ))}
          </div>
        ) : null}
      </Card>
    </Link>
  );
}
