# 0009 — PTO import treats cancellations as deletes, and re-syncs are destructive

**Status:** accepted · 2026-06-15

## Context

A second admin importer (`/admin/upload-pto`) ingests a Rippling **leave** export into `staff_pto`, mirroring the staff importer (same localhost gate per [ADR 0008](./0008-localhost-only-admin-area.md), same pure-transform → server-diff → preview → recompute-and-commit shape). See [domains/staff-profiles.md](../domains/staff-profiles.md) and [flows.md](../flows.md).

But leave is not like staff identity: a leave request has a **lifecycle** (pending → approved, or rejected/cancelled), and `staff_pto` rows feed *capacity* — a stale or cancelled leave span would wrongly suppress someone's availability. The staff importer only ever creates/updates (people aren't deleted, they're marked inactive — ADR 0007). PTO needed a third outcome. Two questions had no obvious answer:

1. What should a re-imported export do to leave that's since been **rejected or cancelled** upstream?
2. What should happen to an otherwise-valid leave row whose **employee can't be resolved** to a `staff` record?

## Decision

- **`Leave request status` drives an `action` discriminator on each normalized row.** `APPROVED` → upsert with `isPending=false`; `Pending` → upsert with `isPending=true`; `REJECTED`/`CANCELED`/`CANCELLED` → **delete**. The transform produces `upsert` and `delete` rows; the server plan buckets them into `creates`/`updates`/`unchanged` vs. `deletes`/`ignoredCancellations`.
- **Cancellation is a hard delete, matched by `Leave request ID`** (`staffPto.ripplingId`), independent of whether the employee resolves. A cancel for leave we never imported is a no-op (`ignoredCancellations`). We delete rather than soft-flag because a cancelled request should simply stop consuming capacity, and `staff_pto` carries no lifecycle column for "cancelled".
- **Two-level match.** A row resolves a staff member by `Employee - ID` (`staff.ripplingId`), then matches the PTO record by `Leave request ID` (`staffPto.ripplingId`, notNull/unique = one row per leave request).
- **Unresolved ≠ skipped.** An *upsert* row whose `Employee - ID` matches no `staff` row goes into a distinct **`unresolved`** bucket (it can't be inserted without the staff FK), surfaced in the preview but never persisted — separate from the client-side `skipped` rows (bad/missing fields, unrecognized status, unrecognized leave type). The operator is expected to **run the staff import first**.
- **Two new `pto_type` enum values** (`COMPANY_RETREAT`, `RELIGIOUS_HOLIDAY`) were added via `ALTER TYPE ... ADD VALUE` before `OTHER_LEAVE` to cover the real Rippling leave policies; unmapped policy names skip the row rather than silently bucket into `OTHER_LEAVE`.

## Consequences

- **Re-importing the full export is the sync mechanism and it is destructive.** Records flip pending↔approved (updates), and rejected/cancelled requests are removed. This is intended: the export is the source of truth at import time. But it means a *partial* export (e.g. one filtered to a subset) would delete nothing it doesn't list (good) yet also wouldn't re-create anything — operators should import complete exports.
- **Import order matters.** PTO for an employee not yet imported as staff lands in `unresolved` and is silently not persisted until staff exists. Documented as a gotcha.
- The `staff_pto` row is the only persisted state — there's no audit trail of a cancelled-then-deleted request beyond what Rippling holds.
- Same intra-CSV duplicate-`Leave request ID` guard as the staff importer (skip the second occurrence) avoids a unique-constraint rollback of the whole commit.

## Alternatives considered

- **Soft-delete / a `status` column on `staff_pto` instead of hard delete** — rejected for now: capacity reads only care about active leave spans, and there's no current consumer for cancelled-request history. Revisit if auditing leave changes becomes a need.
- **Bucket unrecognized leave policies into `OTHER_LEAVE`** — rejected: silently mislabels capacity-affecting data; surfacing the row as skipped forces a deliberate mapping decision.
- **Treat unresolved employees as a skip (drop) rather than a named bucket** — rejected: it hides a fixable ordering problem (import staff first); the `unresolved` bucket makes it visible in the preview.
