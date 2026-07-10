import { z } from "zod";

/**
 * A list of related-entity ids (contacts, staff, delivery managers, …),
 * defaulting to empty. Shared by every form field that collects a set of picked
 * entity ids so the "non-empty strings, defaults to []" shape stays consistent
 * in one place — the id counterpart to `optionalText`/`optionalUrl`.
 */
export const idList = z.array(z.string().min(1)).default([]);
