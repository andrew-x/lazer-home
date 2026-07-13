# Design: `manager` on staff

**Date:** 2026-07-13
**Status:** Approved, ready for implementation plan

## Goal

Add an optional `manager` relationship to a staff member — who this person is
managed by. A person has at most one manager; the manager is another staff
record. The relationship is populated **from the staff CSV import** (a new
`Manager - Work email` column) and displayed **read-only** on the staff profile.
There is no in-app editor: the import is the sole writer.

## Decisions (settled during brainstorming)

- **Storage:** durable `staff.managerId` self-FK (one manager per person), not
  effective-dated on `staff_employment`. Mirrors the existing `contacts.managerId`
  pattern in `crm-schema.ts`.
- **UI:** display-only on the staff profile. No edit dialog. Because import is the
  only writer, re-imports never conflict with a manual edit.
- **Re-sync rule:** the CSV column is **authoritative every import**. A filled cell
  that resolves sets/updates the manager; a blank cell clears it (`managerId = null`).
- **Flagging is non-blocking:** an unresolved manager never blocks the row — the
  person still imports, only the manager link is skipped and a warning is surfaced.

## 1. Schema

Add to the `staff` table in `src/lib/db/staff-schema.ts`:

```ts
managerId: text().references((): AnyPgColumn => staff.id, { onDelete: "set null" }),
```

- Nullable (optional).
- Self-reference requires the `AnyPgColumn` return-type annotation (import from
  `drizzle-orm/pg-core`), same as `contacts.managerId`.
- `onDelete: "set null"` matches the CRM pattern: removing a manager clears their
  reports' pointers rather than blocking the delete.

Then `bun run db:generate` → `bun run db:migrate`.

## 2. Import pipeline

The manager is matched by **email**, but the import matches people by `ripplingId`
and create-ids don't exist until commit. So the manager is carried through the
pipeline as a **stable manager `ripplingId` reference**, resolved to a concrete
`managerId` (staff.id) only at commit.

### 2a. `transform.ts` (pure, client-safe)
- Read the `Manager - Work email` cell via `getField`.
- Normalize (trim + lowercase); blank → `null`.
- Emit `managerEmail: string | null` on `NormalizedStaff`.

### 2b. `types.ts`
- Add `managerEmail: string | null` to `normalizedStaffSchema` and `NormalizedStaff`.
- Add `manager` to the set of durable identity fields compared during diffing
  (so a manager-only change is an update, not "unchanged"). Because the
  comparison value is a resolved ripplingId (below), the diff does not compare
  `managerEmail` directly — see plan.
- Extend `ComparableSnapshot` with the current manager's ripplingId
  (`managerRipplingId: string | null`).
- Carry the resolved manager ripplingId on creates and updates. Creates today are
  `NormalizedStaff[]`; wrap them (or the update/create carriers) so each carries
  its resolved `managerRipplingId: string | null`.
- Add `managerWarnings` to `StaffImportPlan` and a linked-count + warnings to
  `CommitResult`. Warning shape (new type, distinct from `SkippedRow` because the
  row is NOT skipped):
  `{ rowNumber?: number; name: string; ripplingId: string; managerEmail: string; reason: string }`.

### 2c. `plan.ts` (server, trusted recompute)
1. Build an `email → ripplingId` index from **the incoming batch first, then the
   DB**. Batch coverage handles the first-import case (manager is a create in the
   same file); the DB lookup handles partial imports (manager only in the DB).
   Query the DB for staff whose email is among the manager emails not already
   covered by the batch, selecting `{ email, ripplingId }`.
2. For each row, resolve `managerEmail` → manager `ripplingId`:
   - `null` email → no manager (null), no warning.
   - email == the row's own email → **self-management** warning, null.
   - exactly one match → that ripplingId.
   - zero matches → **email matches no staff** warning, null.
   - more than one match → **ambiguous** warning, null.
3. Load each matched person's **current** manager ripplingId (self-join
   `staff` → `staff` on `managerId`), populate `ComparableSnapshot.managerRipplingId`.
4. Include `manager` in the changed-field comparison (incoming resolved ripplingId
   vs current manager ripplingId) so manager-only changes count as updates.
5. Attach the resolved manager ripplingId to each create/update; collect
   `managerWarnings`.

### 2d. `commitStaffImport.ts`
- After minting create-ids, build `ripplingId → staffId` across: creates (minted
  ids), updates (existing staffIds), plus a DB lookup for manager ripplingIds that
  live only in the DB (not in this batch).
- Set `managerId` on each `staff` row (creates and updates). Because `managerId`
  is an identity field, it rides the existing `staff` upsert's `set` clause — add
  `managerId: sql\`excluded.manager_id\`` — no new write path.
- Postgres verifies the self-FK at statement end, so intra-batch references
  (A managed by B, both new) resolve within the single batched `insert(staff)`.
- Return the linked count and `managerWarnings` in `CommitResult`.

## 3. Preview / reporting UI (`src/components/admin/staff-import.tsx`)

- Add a "Manager links" summary: number of managers linked + a warnings section
  listing each unresolved manager email with its reason, alongside the existing
  skipped-rows section.
- Warnings are informational — they do not block the commit.

## 4. Profile display (read-only)

- `getStaffProfile` (`src/actions/staff/getStaffProfile.ts`): self-join to project
  `{ managerId, managerName }` (manager's id + name). Extend the exported
  `StaffProfile` type.
- `profile-view.tsx`: add a **Manager** row to the identity/header area — a link to
  the manager's profile (`/staff/[managerId]`) showing the manager's name, or
  omitted / "—" when there is no manager.

## 5. Docs

Dispatch the `librarian` subagent after implementation to:
- Update `docs/domains/staff-profiles.md`: new `managerId` field, the
  `Manager - Work email` import column, the two-pass email→ripplingId resolution,
  and the three flagged warning cases.
- Add a short ADR covering the durable self-FK choice (vs effective-dated) and the
  two-pass batch-spanning email resolution.

## Non-goals / explicitly out of scope

- No in-app manager editor.
- No "direct reports" (inverse) view.
- No cycle detection beyond self-reference (harmless for a display-only field;
  `contacts.managerId` doesn't guard cycles either).
- No effective-dated manager history.

## Edge cases

| Case | Behavior |
|---|---|
| Blank `Manager - Work email` | `managerId = null` (cleared if previously set) |
| Manager is a create in the same import | Resolved via batch index; FK satisfied at statement end |
| Manager only exists in the DB (partial import) | Resolved via DB lookup |
| Email matches no staff | Warning; person imports with `managerId = null` |
| Email matches >1 staff | Ambiguous warning; `managerId = null` |
| Row names its own email | Self-management warning; `managerId = null` |
| Manager's staff record deleted later | `onDelete: set null` clears the pointer |
