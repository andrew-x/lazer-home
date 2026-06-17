import Link from "next/link";
import type { StaffDirectoryEntry } from "@/actions/staff/getStaffDirectory";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { humanizeEnum } from "@/lib/format";

function initialsFor(name: string, email: string): string {
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

/** One staff member as a clickable card linking to their profile. */
export function StaffCard({ entry }: { entry: StaffDirectoryEntry }) {
  const subtitle = [entry.role, entry.lineOfBusiness]
    .filter(Boolean)
    .map((value) => humanizeEnum(value as string))
    .join(" · ");

  // `Card` is a plain <div> that does not forward a Base UI `render` prop, so we
  // wrap it in the Link and carry the padding/hover/layout classes on the Card.
  return (
    <Link href={`/staff/${entry.id}`} className="block">
      <Card className="flex flex-col items-center gap-3 p-5 text-center transition-colors hover:bg-accent">
        <Avatar className="size-14">
          {entry.imageUrl ? (
            <AvatarImage src={entry.imageUrl} alt={entry.name} />
          ) : null}
          <AvatarFallback>
            {initialsFor(entry.name, entry.email)}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-medium">{entry.name}</span>
          {subtitle ? (
            <span className="truncate text-sm text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </div>
        {!entry.isActive ? <Badge variant="secondary">Inactive</Badge> : null}
      </Card>
    </Link>
  );
}
