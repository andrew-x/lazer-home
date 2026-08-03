# Staffing panel — full-time / hourly cohorts

**Date:** 2026-08-03 · **Surface:** home dashboard → Lazer Status → Staffing

## Problem

The Staffing panel's `Normalized` tile carried a hint that both said too much and
too little: `Staffed ÷ 29 full time` repeated a number already on the panel, and it
read as though the numerator were *full-time* staffed. It isn't — the numerator is
**everyone** staffed, which is the whole reason the figure can exceed 100%.

Separately the panel only knew one population. Hourly headcount existed solely as
`Normalized`'s implied excess, so "how much of the hourly bench is working" had no
answer anywhere.

## Design

### Model — `summarizeStaffing` returns two cohorts

`normalizedRate` moves **up** out of the cohort summaries: it is a whole-org ratio
(all staffed ÷ full-time headcount), not a property of either cohort.

```ts
export type StaffingSummary = StaffingRate & { byRole: RoleStaffing[] };

export type StaffingModel = {
  fullTime: StaffingSummary;
  hourly: StaffingSummary;
  /** All staffed, both cohorts, ÷ full-time headcount. Null when nobody is full time. */
  normalizedRate: number | null;
  /** Whole-population headcount — drives the "nobody at all" empty state. */
  headcount: number;
};
```

`byRole` is computed per cohort, so the discipline rows and the Overall row describe
the **selected** cohort. The panel's existing invariant — rows account for exactly
the same people as Overall — holds inside each tab.

Nobody can fall between the two tabs: the population is `isBillable === true`, which
is only true when a person has an employment row, and
`staff_employment.employmentType` is `notNull`. `OrgPerson.employmentType`'s `| null`
is a type artifact of the outer join. Documented in a comment, not handled with a
third tab.

### Panel — two-segment toggle, no "All"

`Full time | Hourly`, defaulting to Full time, state local to the panel (nothing
else on the section needs it).

- **Full time** — four tiles: Staffed now, Headcount, Staffed rate, Normalized.
  Normalized's hint becomes `All staffed ÷ full-time headcount`: drops the redundant
  count, names the numerator.
- **Hourly** — three tiles. No Normalized; its numerator crosses both cohorts and
  its denominator is full-time headcount, so it is not a fact about hourly staff.

Accepted trade: the combined whole-org staffed/headcount figure is no longer on the
panel. `Normalized`'s numerator is the only place all-staffed survives, which its
hint now names.

Empty states split in two, so you are never stranded on a dead tab:

- whole population empty → message only, no toggle (nothing to toggle between)
- cohort empty, population not → toggle stays, message names the cohort

`SegmentedFilter` hardcodes a leading "All" segment, so it gains an optional
`includeAll = true` prop rather than a second segmented-control implementation.

### Deliberately not done

`AvailabilityPanel` already has an All/Full time/Hourly employment filter, so the
section now carries two employment controls. They stay **separate**: availability
needs "All" (an optional narrowing of who's free) while staffing's is a required
cohort selector. Hoisting one shared control would either strip availability's "All"
or reintroduce a combined staffing tab that was explicitly rejected. Each control
sits inside the card it filters.

## Files

- `src/lib/home/org-status.ts` — `StaffingModel`, reshaped `summarizeStaffing`
- `src/lib/home/org-status.test.ts` — per-cohort coverage
- `src/components/home/staffing-panel.tsx` — toggle, tiles, empty states, footnote
- `src/components/form/filters.tsx` — `SegmentedFilter`'s `includeAll`
- `src/components/home/lazer-status-section.tsx` — passes `model`
