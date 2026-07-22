import { Badge } from "@/components/ui/badge";
import {
  PROJECT_ROLE_STATUS_LABELS,
  PROJECT_ROLE_STATUS_VARIANTS,
  type ProjectRoleStatus,
} from "@/lib/projects/project-role-status";

/**
 * A project's *derived* lifecycle status shown as a labelled badge. A project
 * has no stored status; the value comes from `deriveProjectStatus` over its
 * roles, and shares the role-status labels/variants.
 */
export function ProjectStatusBadge({ status }: { status: ProjectRoleStatus }) {
  return (
    <Badge variant={PROJECT_ROLE_STATUS_VARIANTS[status]}>
      {PROJECT_ROLE_STATUS_LABELS[status]}
    </Badge>
  );
}
