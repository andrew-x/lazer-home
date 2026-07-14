import { Badge } from "@/components/ui/badge";
import {
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
} from "@/lib/project-status";

// Confirmed reads as the primary (default) badge; tentative stays muted;
// paused is outlined; cancelled reads as destructive.
const VARIANT_FOR_STATUS: Record<
  ProjectStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  confirmed: "default",
  tentative: "secondary",
  paused: "outline",
  cancelled: "destructive",
};

/** A project's lifecycle status shown as a labelled badge. */
export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge variant={VARIANT_FOR_STATUS[status]}>
      {PROJECT_STATUS_LABELS[status]}
    </Badge>
  );
}
