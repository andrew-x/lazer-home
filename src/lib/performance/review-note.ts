/**
 * Performance review notes — the pure, client-importable core (no `db`/drizzle).
 *
 * A note is a dated write-up of a review conversation between a person and their
 * manager. It has a deliberate two-step lifecycle: a manager drafts it (only they
 * see it), then **shares** it, at which point the person it is about can read it
 * too. Sharing is one-way — the person has already read it, so "unsharing" would
 * be theatre; deleting is the escape hatch for a mistake.
 *
 * Owns the status tuple (feeding the pgEnum, per ADR 0016), its labels, and the
 * confirmation copy, so the schema, the actions, and the panel share one source.
 *
 * NOTE: unlike every other gate in this codebase, who may read a note depends on
 * the **reporting line** (`staff.managerId`), not only on a role capability. That
 * decision lives in `src/actions/performance/reviewNoteAccess.ts` — it needs the
 * db, so it can't live here.
 */

export const PERFORMANCE_REVIEW_NOTE_STATUSES = ["DRAFT", "SHARED"] as const;

export type PerformanceReviewNoteStatus =
  (typeof PERFORMANCE_REVIEW_NOTE_STATUSES)[number];

export const REVIEW_NOTE_STATUS_LABELS: Record<
  PerformanceReviewNoteStatus,
  string
> = {
  DRAFT: "Draft",
  SHARED: "Shared",
};

/** Max lengths, shared by the zod schemas and the form's textarea counter. */
export const REVIEW_NOTE_TITLE_MAX = 200;
export const REVIEW_NOTE_BODY_MAX = 20_000;

/**
 * The share confirmation. Spelled out because sharing is irreversible in the
 * only sense that matters: the person can read it from that moment on.
 */
export const REVIEW_NOTE_SHARE_WARNING =
  "Sharing makes this note visible to the person it's about. You can edit or delete it afterwards, but you can't un-share it.";

/** What a draft note is, said once — used by both the manager and subject views. */
export const REVIEW_NOTE_DRAFT_HINT =
  "Drafts are visible only to you until you share them.";
