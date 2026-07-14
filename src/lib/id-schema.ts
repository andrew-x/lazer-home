import { z } from "zod";

/**
 * A single non-empty entity id. The scalar counterpart to `idList` — the shared
 * "non-empty id string" shape for any field holding one picked entity id. Carries
 * no message on purpose: it mirrors the bare `z.string().min(1)` convention used
 * for ids across the actions layer (field-specific messages stay at the call site).
 */
export const id = z.string().min(1);

/** An optional entity id — absent when the field is unset. */
export const optionalId = id.optional();

/**
 * A list of related-entity ids (contacts, staff, delivery managers, …),
 * defaulting to empty. Shared by every form field that collects a set of picked
 * entity ids so the "non-empty strings, defaults to []" shape stays consistent
 * in one place — the id counterpart to `optionalText`/`optionalUrl`.
 */
export const idList = z.array(z.string().min(1)).default([]);
