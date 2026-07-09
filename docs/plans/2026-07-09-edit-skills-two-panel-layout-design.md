# Edit skills — two-panel layout

**Date:** 2026-07-09
**Status:** Design approved, ready for implementation plan
**Scope:** Presentational refactor of the "Edit skills" editor. No schema, action, data-model, or interaction-logic changes.

## Problem

The current editor stacks vertically: the "Your skills" list sits *above* the "Add skills" editor (level toggle + search + ~300-chip catalogue). Because the result is above the tool, it's not visually obvious that acting in the catalogue updates the list — the cause and its effect are far apart and the user often can't see both at once. The flow reads as "non-typical."

## Decision

Keep the exact interaction the user already understands (level-first "Add as" toggle, then click catalogue chips) and change **only the layout** so the editor visibly feeds the list.

## Design

### Desktop (≥ `md`)

- Two columns inside the existing `max-w-3xl` page container.
  - **Left column — "Add skills" editor:** the "Add as" level toggle, search input, and the catalogue grouped by dimension. This is the long, scrolling column.
  - **Right column — "Your skills":** the result list grouped by level (Senior → Intermediate → Learning) with the count.
- Reading order is left → right = "do this → get that" (cause → effect).
- **"Your skills" is pinned** (`sticky`, e.g. `top-…`, constrained to viewport height with its own `overflow-y-auto`) so it stays in view while the catalogue column scrolls. The user always sees skills land as they add them.
- The page header ("Edit skills" + subtitle) remains full-width above both columns. Save / Cancel actions remain where they are today.

### Mobile / narrow (< `md`)

- Collapse to a single stacked column, **"Your skills" first, then the editor.** On narrow screens the sticky benefit is lost, so surfacing the outcome (list + count) at the top keeps state glanceable; the user then scrolls into the catalogue to add.

### Explicitly out of scope

- **No delight/animation touches** for now — the list, chips, and count stay static (no fade-in, highlight ring, or count tick).
- No change to: the "Add as" level toggle behavior, search substring matching, catalogue grouping/order, per-chip `▾` re-level and `✕` remove, dedup-by-name, the 200-skill cap, the `updateStaffSkills` action, or any of the `useState` logic in the editor component.

## Affected code

- `src/components/staff/edit-skills-form.tsx` — the only component that changes. Restructure its render into the two-column responsive layout described above; the existing `EditSkillsForm` / `SelectedSkills` / `SelectedChip` / `AddSkills` sub-components and all their handlers (`addSkill`, `removeSkill`, `setLevel`) stay as-is. Ordering of the sub-components in the DOM changes to editor-then-list (with responsive/visual ordering handled via layout so mobile shows list first).
- `src/app/(app)/staff/[id]/skills/page.tsx` — unchanged unless the `max-w-3xl` wrapper needs to widen to comfortably fit two columns (evaluate during implementation; widen only if cramped).

## Follow-up

- `docs/domains/staff-profiles.md` still describes an **older** editor ("one bucket per proficiency level, each with an 'Add skill' grouped Select"). After implementation, dispatch the `librarian` subagent to reconcile the Skills section with the real editor UI.

## Verification

- `bun run check` (Biome + `tsc` + tests) and `bun run build`.
- Manually drive the page: two columns on desktop, list pinned while catalogue scrolls; single stack with list-first on a narrow viewport; adding/removing/re-leveling and saving all still work.
