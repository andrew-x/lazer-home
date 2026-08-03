import type { TaskParentKind } from "@/actions/crm/tasks.schema";
import { ALL } from "@/components/form/filters";

/**
 * Segment labels for the task list's parent-kind filter. Plural, unlike
 * `TASK_PARENT_LABELS` — the filter narrows to a *set* of tasks ("Companies"),
 * whereas a row labels the one record it hangs off ("Company"). Shared by the
 * panel and the archive dialog so the two filter bars read identically.
 */
export const PARENT_FILTER_LABELS: Record<TaskParentKind, string> = {
  company: "Companies",
  contact: "Contacts",
  opportunity: "Opportunities",
};

/** Read a parent-kind filter segment back as a kind, or null for the "All" segment. */
export function asParentKind(value: string): TaskParentKind | null {
  return value === ALL ? null : (value as TaskParentKind);
}
