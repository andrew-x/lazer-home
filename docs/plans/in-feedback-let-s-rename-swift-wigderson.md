# Peer Feedback: rename + a "Your reports" tab

## Context

`/feedback` is titled just "Feedback" in the sidebar and on the page, which reads as generic
(client feedback? product feedback?) when the feature is specifically **peer** feedback.

Separately, the page today is entirely self-scoped: "About you" (the recipient's limited view)
and "You've given" (your own authored items). A manager has no way to see the feedback their
people are receiving — even though anyone with `feedback.review` (manager/admin) can *already*
open any individual item in full at `/feedback/[id]`. What's missing is the **list**: the
browse-all screen that was built and then removed (`docs/domains/performance.md`, ADR 0023).

This adds it back, narrowed to the caller's **direct reports**. Decisions taken with the user:

- **Gate:** `feedback.review` (manager/admin) — no change to `permissions.ts`. The tab lists
  only items the caller can already read in full, so this is a **convenience surface over
  existing authorization, not an escalation**. A delivery-manager with reports but no
  `feedback.review` does not see the tab (accepted).
- **Scope:** direct reports only — `staff.managerId = <caller's staff id>`. No recursion.
- **Label:** "Your reports (N)", third tab after "You've given".

Note this is the first read that uses `staff.managerId` for anything beyond display. It is used
to *narrow* a permitted result set, never to grant access — worth stating explicitly in the docs
because `docs/domains/performance.md` and `docs/flows.md` currently assert there is no
manager/report graph in play.

## 1. Rename to "Peer Feedback"

- `src/components/app-shell/nav.ts:88` — `title: "Feedback"` → `"Peer Feedback"`. Route, icon
  and (absent) gate unchanged.
- `src/app/(app)/feedback/page.tsx` — `metadata.title` and the `<h2>` → `"Peer Feedback"`.
  Keep the subtitle ("Give and receive peer feedback across the team.").
- Leave the sub-pages alone: `/feedback/new` stays "Give feedback", `/feedback/[id]` stays
  "Feedback detail". The URL stays `/feedback`.

## 2. New read: `src/actions/feedback/getFeedbackAboutReports.ts`

A `server-only` read function (not a `'use server'` action) per `.claude/rules/server-actions.md`,
modelled on `getFeedbackDetail.ts` — it uses the same two `alias(staff, …)` joins and the same
capability check.

```ts
export type FeedbackAboutReportsRow = {
  id: string;
  giverId: string;      // for the Author filter's option list
  giverName: string;
  recipientId: string;  // for the Target filter's option list
  recipientName: string;
  rating: FeedbackRating;
  context: string;
  keepDoing / stopDoing / startDoing / other / messageToRecipient: string | null;
  createdAt: Date;
};

/** `null` when the caller may not see this surface at all → the tab is hidden. */
export async function getFeedbackAboutReports(): Promise<FeedbackAboutReportsRow[] | null>
```

Order of checks (fail closed, mirroring `getFeedbackDetail`):

1. `getCurrentUser()` → `null` if absent.
2. `userHasPermission(user, { feedback: ["review"] })` → `null` if false. **Same key as
   `getFeedbackDetail`**, so every row listed here is one the caller could already open.
3. `getCurrentStaffId()` → `null` if the user isn't linked to a staff record.
4. Query: `select(...).from(feedback).innerJoin(giver, eq(feedback.fromStaffId, giver.id))
   .innerJoin(recipient, eq(feedback.toStaffId, recipient.id))
   .where(and(eq(recipient.managerId, staffId), ne(recipient.id, staffId)))
   .orderBy(desc(feedback.createdAt))`.

The `ne(recipient.id, staffId)` guard is deliberate: `managerId` is import-populated with no
in-app editor, so a row that points at itself would otherwise surface the caller's *own*
feedback in full — the exact privacy tier `getFeedbackAboutMe` exists to prevent.

A permitted caller with no reports gets `[]`, i.e. the tab renders with an empty state rather
than disappearing. That's intentional — predictable nav for managers, and it avoids a second
count query.

## 3. New component: `src/components/feedback/feedback-about-reports-table.tsx`

Client component, in-memory filtering over the server-fetched list — the
`src/components/staff/staff-directory.tsx` pattern, **not** the URL-backed
`contacts-list-filters` pattern. Reason: the filters live inside an uncontrolled
`<Tabs defaultValue="received">`, so pushing `?q=…` params would mean also making tab
selection URL-driven. Volume here is one manager's reports — in-memory is the right size.

**Filter bar** — `grid grid-cols-4 items-end gap-4` above the table:

| Field | Control | Source |
|---|---|---|
| For | `SearchableSelectFilter` (`inputClassName="w-full"`) | `src/components/form/filters.tsx:172` |
| Author | `SearchableSelectFilter` (`inputClassName="w-full"`) | same |
| From / To | two `DatePicker className="w-full"` inside `FilterLabel` wrappers | `src/components/ui/date-picker.tsx` |

- Option lists are derived from the rows with `useMemo` (distinct `{ id, name }`, sorted by
  name) so only people who actually appear are offerable — same finite-option semantics as
  `src/components/projects/projects-list-filters.tsx`.
- The combobox's own type-to-search covers "search target"; no extra free-text input.
- Date compare: `formatIsoDate(row.createdAt)` (from `@/lib/format/format`, already used
  client-side by `DatePicker`) string-compared inclusively against `from`/`to`. This keeps the
  filter on the same wall-clock calendar day the Date column displays and avoids a SQL cast on
  the timezone-less `timestamp` column (see `.claude/rules/database.md`).
- No-cross guard, cheaper than `PlannerRange`'s: picking a `from` after the current `to` clears
  `to`, and picking a `to` before `from` clears `from`.

**Table** — `Table` primitives, columns **Author | For | Context | Date**. The *For* name is the
button that opens the full item in a dialog, keeping the name→dialog affordance of
`feedback-given-table.tsx`. `Context` is `line-clamp-2 max-w-md text-muted-foreground`; `Date`
is `formatTimestamp(row.createdAt)`.

**Empty states:** `EmptyState` ("None of your direct reports have received feedback yet.") when
`rows.length === 0`; a muted "No feedback matches these filters." when only the filtered set is
empty (staff-directory's convention).

## 4. Extract the shared detail dialog

`feedback-given-table.tsx` already owns the `selected` + `open` split-state dialog (kept split so
content survives the close animation). Rather than copy it, pull it into
`src/components/feedback/feedback-detail-dialog.tsx`:

```ts
export type FeedbackDialogItem = FeedbackDetailFieldValues & {
  recipientName: string;
  rating: FeedbackRating;
  createdAt: Date;
};
// { item, open, onOpenChange } → DialogHeader ("Feedback for {recipientName}",
// "{RATING_LABEL} · {timestamp}") + <FeedbackDetailFields detail={item} />
```

Both `FeedbackIGaveRow` and `FeedbackAboutReportsRow` structurally satisfy `FeedbackDialogItem`.
Refactor `feedback-given-table.tsx` onto it (behaviour unchanged) and use it in the new table.

## 5. Wire up the page

`src/app/(app)/feedback/page.tsx`: add `getFeedbackAboutReports()` to the existing
`Promise.all`, then render the third trigger + content **only when the result is non-null** —
`{reports ? <TabsTrigger value="reports">Your reports ({reports.length})</TabsTrigger> : null}`.
Content mirrors the "given" tab: a one-line muted explainer ("Feedback your direct reports have
received. You can see it in full as a reviewer.") plus the table in `<div className="rounded-md border">`.

## Files

- `src/components/app-shell/nav.ts` (rename)
- `src/app/(app)/feedback/page.tsx` (rename + third tab)
- `src/actions/feedback/getFeedbackAboutReports.ts` (new)
- `src/components/feedback/feedback-about-reports-table.tsx` (new)
- `src/components/feedback/feedback-detail-dialog.tsx` (new, extracted)
- `src/components/feedback/feedback-given-table.tsx` (use the extracted dialog)

No schema change, no migration, no seed change, no `permissions.ts` change (so no matrix/test/doc
lockstep work).

## Verification

1. `bun run check` (Biome + `tsc --noEmit` + `bun test`) and `bun run build`.
2. `bun run dev`, sign in as Andrew. The seed makes Andrew an **admin leader with direct
   reports** (`scripts/seed/staff.ts:104-137` — the 3 seeded managers report to him) and
   `scripts/seed/performance.ts` seeds feedback, so the tab should have rows. If it looks empty,
   re-seed with `bun run db:seed` before assuming a bug.
3. Confirm: sidebar and page read "Peer Feedback"; tab order is About you / You've given / Your
   reports (N); every row's *For* is one of Andrew's direct reports (cross-check against
   `/staff/<id>`'s "Reports to"); clicking a *For* name opens the full item; the existing
   "You've given" dialog still works after the extraction.
4. Filters: pick a Target → only that person's rows; pick an Author → only theirs; combine both;
   set From/To to a narrow window and confirm boundary dates are **included**; confirm picking a
   From after the To clears the To; clear everything and confirm the full list returns.
5. Permission check — the important one. Temporarily set your `user.role` to `user` (or use a
   non-manager seeded account) and reload `/feedback`: the tab must be **absent**, and
   `/feedback/[id]` for one of those items must 404. Restore the role.
6. Run `/code-review` on the diff, then dispatch the `librarian` subagent to update
   `docs/domains/performance.md` (the third tab, its gate, direct-reports scope) and to correct
   the now-misleading "no per-person manager/report graph" line in `performance.md:78` and
   `docs/flows.md:126` — `managerId` is now read to *narrow* a permitted list, while
   authorization itself stays purely role-based.
