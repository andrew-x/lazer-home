# Allocations planner — column ranges, away dates, hourly & profile links

## Context

Four small, related UX improvements to the allocations planner (`/allocations`) that make the
grid easier to read and act on:

1. **Week column headers** currently show only the starting Monday ("Jul 6"). They should show
   the **compact working-week range** (Mon–Fri, e.g. `Jul 6–10`) so a reader can see the span
   each column covers without counting.
2. **Away blocks** (PTO strips) show only a leave type + "% of week" in their tooltip. They
   should also show the **actual start/end dates** of the time-off period.
3. **Hourly staff** are indistinguishable from salaried in the grid. Since billing treats them
   differently, the staff column should flag **Hourly** people.
4. The **staff name is plain text**. Clicking a name should open that person's **staff profile
   in a new tab** for quick cross-reference while planning.

All four are display-only. No schema/DB change and no new query — `employmentType` and the PTO
span dates are already fetched by `getAllocationsGrid`; they're just dropped during the
client-side fold into grid rows. This keeps the change confined to two files (plus tests).

## Files to modify

- `src/lib/allocations/allocations-grid.ts` — pure grid math: the header label + the two
  fields threaded into rows/cells.
- `src/components/allocations/allocations-grid.tsx` — the render: name link, hourly badge,
  away tooltip.
- `src/lib/allocations/allocations-grid.test.ts` — **new** targeted unit tests (module is pure;
  `bun run check` runs `bun test`).

> Note: `weekColumnLabel` also exists in `src/lib/projects/project-planner-grid.ts` (the
> opportunity planner). It is a **separate copy** — do NOT change it; this work only touches the
> allocations planner.

## 1. Compact week-column range (Mon–Fri)

In `allocations-grid.ts`, replace `weekColumnLabel` (currently start-day only) with a range that
collapses the month when start and end share it. Friday is `getWeekDays(weekStart)[4]`
(`getWeekDays` is already imported). Use an en-dash (`–`):

```ts
/** Compact working-week range for a column header, e.g. "Jul 6–10" / "Jun 29–Jul 3". */
export function weekColumnLabel(weekStart: string): string {
  const monday = parseIsoDate(weekStart);
  const friday = parseIsoDate(getWeekDays(weekStart)[4]);
  const month = new Intl.DateTimeFormat("en-US", { month: "short" });
  const day = new Intl.DateTimeFormat("en-US", { day: "numeric" });
  const startMonth = month.format(monday);
  const endMonth = month.format(friday);
  return startMonth === endMonth
    ? `${startMonth} ${day.format(monday)}–${day.format(friday)}`
    : `${startMonth} ${day.format(monday)}–${endMonth} ${day.format(friday)}`;
}
```

The existing `min-w-28` header (`allocations-grid.tsx:54`) comfortably fits the widest form
(`Jun 29–Jul 3`) at `text-xs`; no width change needed.

## 2. Away-block start/end dates in the tooltip

The fold currently discards the raw PTO spans. Thread the overlapping span's extent into the cell.

**`allocations-grid.ts`:**
- Extend `TimeOffCell`: add `startDate: string` and `endDate: string`.
- Add a helper mirroring `firstAwayType` that returns the **min start / max end across the spans
  overlapping this working week** (handles the rare multi-span week by merging to an outer range):

```ts
function awaySpanRange(weekStart, spans): { startDate: string; endDate: string } | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const span of spans) {
    if (activeWeekdays(weekStart, span.startDate, span.endDate) === 0) continue;
    if (start === null || span.startDate < start) start = span.startDate;
    if (end === null || span.endDate > end) end = span.endDate;
  }
  return start && end ? { startDate: start, endDate: end } : null;
}
```

- In `buildAllocationRows`, when `awayDays > 0` the range is guaranteed non-null; spread its
  `startDate`/`endDate` into the `TimeOffCell` alongside the existing `type`/`percent`.

**`allocations-grid.tsx`** — enrich `TimeOffBlock`'s `TooltipContent` (follow the stacked layout
`AllocationBlock` already uses: `className="flex-col items-start gap-0.5"`), using the existing
`formatDate` helper:

```tsx
<TooltipContent className="flex-col items-start gap-0.5">
  <span>{cell.type ? PTO_TYPE_LABELS[cell.type] : "Time off"} · {cell.percent}% of week</span>
  <span>{formatDate(cell.startDate)} – {formatDate(cell.endDate)}</span>
</TooltipContent>
```

**Permissions note (deliberate, not a bypass):** the existing design keeps the leave *reason*
(`type`) gated behind `pto:[review]` while **availability is public** — the grid already shows
every viewer which weeks a person is Away. Showing the away period's start/end dates is more
availability information, of the same kind already public, so it is shown to all viewers. The
`type` gate is **untouched**. Flagging explicitly so it can be vetoed; if exact dates should be
manager-only, we'd gate them like `type` (which would leave most viewers only "Time off · X%").

## 3. "Hourly" flag in the staff column

`employmentType` (`"FULL_TIME" | "HOURLY" | null`) is on `AllocationStaffRow` but dropped from
the grid row.

- **`allocations-grid.ts`:** add `employmentType: AllocationStaffRow["employmentType"]` to
  `AllocationRow`, and set it in the `buildAllocationRows` mapping (`person.employmentType`).
- **`allocations-grid.tsx`:** render a small badge when `row.employmentType === "HOURLY"`, using
  the vendored `Badge` (`@/components/ui/badge`) and the existing `EMPLOYMENT_TYPE_LABELS.HOURLY`
  ("Hourly"). Use `variant="outline"` — neutral/monochrome, consistent with the design language
  (indigo reserved for primary actions/links). See §4 for the combined cell markup.

## 4. Staff name links to profile (new tab)

Staff profiles live at `/staff/[id]`; `row.staffId` is already present. Wrap the name in a
`next/link` `<Link>` with `target="_blank" rel="noopener noreferrer"` (the same new-tab pattern
already used in `profile-view.tsx`). Follow the existing internal staff-link style (plain
`font-medium` + `hover:underline`, per `staff-card.tsx`) rather than indigo, to avoid tinting a
dense grid. Combined name cell (`allocations-grid.tsx:64-69`):

```tsx
<td className="sticky left-0 z-10 bg-background px-3 py-2 align-top">
  <div className="flex items-center gap-1.5">
    <Link
      href={`/staff/${row.staffId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium hover:underline"
    >
      {row.name}
    </Link>
    {row.employmentType === "HOURLY" ? (
      <Badge variant="outline" className="font-normal">Hourly</Badge>
    ) : null}
  </div>
  <div className="text-xs text-muted-foreground">{staffSublabel(row)}</div>
</td>
```

New imports in the component: `Link` from `next/link`, `Badge` from `@/components/ui/badge`,
`EMPLOYMENT_TYPE_LABELS` from `@/lib/staff/staff-enums` (already imports `PTO_TYPE_LABELS`,
`ROLE_LABELS` from there).

## Verification

- `bun run check` — Biome + `tsc --noEmit` + `bun test` (covers the new unit tests).
- New tests in `allocations-grid.test.ts`:
  - `weekColumnLabel` → same-month (`Jul 6–10`) and cross-month (`Jun 29–Jul 3`) cases.
  - `buildAllocationRows` → an away week carries the overlapping span's `startDate`/`endDate`;
    a row carries `employmentType`.
- `bun run dev`, open `/allocations`:
  - Column headers read as ranges (`Jul 6–10`), including a month-boundary column.
  - Hover an amber "Away" strip → tooltip shows the date range (and reason if you hold
    `pto:review`).
  - An hourly person shows the **Hourly** badge; salaried people don't.
  - Clicking a name opens `/staff/<id>` in a new browser tab.

## Out of scope

No changes to `getAllocationsGrid`, the DB schema, or the seed. The projects/opportunity
planner's own `weekColumnLabel` is intentionally left alone.
