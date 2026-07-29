import {
  billableTypeEnum,
  employmentTypeEnum,
  lineOfBusinessEnum,
  roleEnum,
} from "@/lib/db/schema";

/**
 * The staff filter dimensions offered by the directory, the performance / levels
 * dashboards and the compensation-plan editor, sourced from the DB enums.
 * Client-safe (no `server-only`, no `db`): pages and UI read these option lists
 * without importing the Drizzle schema themselves (the actions layer owns all
 * `@/lib/db` access). The single source for every shared dimension — a filter bar
 * in a client component has nowhere else to get them from.
 */
export const STAFF_FILTER_OPTIONS = {
  lineOfBusiness: [...lineOfBusinessEnum.enumValues],
  role: [...roleEnum.enumValues],
  employmentType: [...employmentTypeEnum.enumValues],
  billableType: [...billableTypeEnum.enumValues],
};
