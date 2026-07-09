# Peer Feedback

## Context

The **performance management** domain is currently greenfield — `docs/domains/performance.md`
lists `ReviewCycle / PerformanceReview / Goal` as *proposed*, and peer feedback appears
only as an open question ("Review types: self / manager / 360?"). This change delivers the
first concrete slice of that domain: a lightweight **peer feedback** feature where any
active staff member can give structured feedback about any other active staff member.

The feature is deliberately privacy-tiered:

- **Anyone (active staff)** can submit feedback about another active staff member.
- **Recipients** can see that feedback exists about them and read the *message to recipient*
  plus *who wrote it* — but **none** of the rest (rating, context, keep/stop/start, other).
- **Managers/admins** can see **all** feedback in full, including feedback about themselves
  (explicitly acceptable for now; to be locked down later).

### Feedback fields (form)

| Field | Required | Recipient can see? |
|---|---|---|
| Recipient (who it's for) | ✅ | — |
| Rating (5-point scale) | ✅ | ❌ |
| Context (how/when you worked together) | ✅ | ❌ |
| Keep doing | ⚠️ at least one of keep/stop/start | ❌ |
| Stop doing | ⚠️ | ❌ |
| Start doing | ⚠️ | ❌ |
| Other | optional | ❌ |
| Message to recipient | optional | ✅ (+ giver's name) |

Rating scale (SCREAMING_SNAKE value → label):
`ABOVE_AND_BEYOND` "Above and beyond" · `TOP_PERFORMER` "Top performer" ·
`SOLID_CONTRIBUTOR` "Solid contributor" · `MINOR_MISSES` "Minor misses" ·
`NEEDS_IMPROVEMENT` "Needs improvement".

## Decisions (confirmed)

- **Recipient view** = message + giver name only (no rating, no other content).
- **Rating input** = a real radio group (vendor shadcn `radio-group`), so all 5 labeled
  options are visible at once. Swap any Lucide icons it pulls in for Tabler per the UI rule.
- **Entry point** = a dedicated `/feedback` page with a "Give feedback" dialog containing a
  staff picker for the recipient.
- **Required to submit** = recipient + rating + context + at least one of keep/stop/start.

## Permission model

There is **no per-person reporting graph** in this codebase, so "manager" here means the
`manager`/`admin` **role**, expressed as a new `feedback` capability — not a direct-report
relationship.

Add to `src/lib/permissions.ts` (keep the three in lockstep — matrix, test, docs):

- **Statement:** `feedback: ["review"]` — "view all feedback content".
- **Roles:** grant `feedback: ["review"]` to `manager` and `admin`. No other role gets it.
- Update `src/lib/permissions.test.ts` and `docs/domains/permissions.md` in the same change.

Access rules enforced in the actions layer (never in pages alone):

- **Give feedback** — any authenticated user with a linked **active** staff record; target
  must be an **active** staff member and **not** the caller. Enforced via a
  `metadata({ authorize })` hook (see `authorizeStaffEdit`/`canEditStaff` as the template),
  **not** a capability — everyone can give feedback.
- **Read feedback about me** — own-scoped read; limited projection (message + giver name).
- **Read feedback I gave** — own-scoped read; full content (I wrote it).
- **Read any feedback / all feedback** — requires `feedback:["review"]`.

## Files to create / modify

### Schema & data
- **`src/lib/feedback-rating.ts`** (new, pure module): `FEEDBACK_RATINGS` tuple,
  `FeedbackRating` type, `FEEDBACK_RATING_LABELS` record (and optional per-option
  descriptions for the radio group). Mirrors `src/lib/line-of-business.ts` — shared source
  of truth for the pgEnum and the zod/form labels (ADR 0016 pattern b).
- **`src/lib/db/performance-schema.ts`** (new domain module):
  - `feedbackRatingEnum = pgEnum("feedback_rating", [...FEEDBACK_RATINGS])`.
  - `feedback` table: `id` (`text().primaryKey()`, `generateId("feedback")`),
    `fromStaffId`/`toStaffId` (`text().notNull().references(() => staff.id, { onDelete: "cascade" })`),
    `rating` (`feedbackRatingEnum().notNull()`), `context` (`text().notNull()`),
    `keepDoing` / `stopDoing` / `startDoing` / `other` / `messageToRecipient` (nullable `text()`),
    `createdAt` / `updatedAt` (standard timestamp idiom).
  - Indexes: `feedback_to_staff_idx` on `toStaffId`, `feedback_from_staff_idx` on `fromStaffId`.
  - `export type Feedback = InferSelectModel<typeof feedback>`.
- **`src/lib/db/schema.ts`** (barrel): add `export * from "./performance-schema"`.
- Run `bun run db:generate` → `bun run db:migrate` (writes to `drizzle/`).

### Permissions
- **`src/lib/permissions.ts`** — add `feedback: ["review"]` to `statement`; grant it to
  `manager` and `admin`.
- **`src/lib/permissions.test.ts`** — extend the matrix assertions.
- **`docs/domains/permissions.md`** — document the new capability + matrix row.

### Actions layer (`src/actions/feedback/`)
- **`createFeedback.schema.ts`** — `z.object({ toStaffId, rating: z.enum(FEEDBACK_RATINGS),
  context: z.string().min(1), keepDoing?/stopDoing?/startDoing?/other?/messageToRecipient? }).refine(...)`
  requiring at least one of keep/stop/start. Export `z.input<>` type. (drizzle-zod
  `createInsertSchema` is awkward here because of the cross-field refine + omitting
  `fromStaffId`; hand-written `z.object` is the sanctioned fallback.)
- **`authorizeFeedback.ts`** — `authorizeFeedbackCreate: ActionAuthorize` + a `canGiveFeedback`
  helper: resolves the caller's active staff id, validates the target is active and not the
  caller. Modeled on `src/actions/staff/canEditStaff.ts`.
- **`createFeedback.ts`** — `secureActionClient.metadata({ action: "create-feedback",
  authorize: authorizeFeedbackCreate }).inputSchema(createFeedbackSchema).action(...)`:
  resolve caller staff id (reuse `getCurrentStaffId`), `db.insert(feedback)` with
  `generateId("feedback")`, `revalidatePath("/feedback")`.
- **`getFeedbackAboutMe.ts`** (`server-only`) — feedback where `toStaffId` = my staff id;
  project **only** giver name (join `staff`), `messageToRecipient`, `createdAt`. No rating/
  other content. Export return type.
- **`getFeedbackIGave.ts`** (`server-only`) — full feedback where `fromStaffId` = my staff id,
  with recipient name resolved.
- **`getAllFeedbackPage.ts`** (`server-only`) — `requirePermission(user, { feedback: ["review"] })`;
  paginated full content with both names resolved. Follow `crm/getCompaniesPage.ts` shape.
- **`getFeedbackDetail.ts`** (`server-only`) — full content for one id; allowed if caller is
  the giver OR has `feedback:["review"]`; else return `null`.
- **`searchStaffForFeedback`** — reuse/adapt `src/actions/crm/searchStaff.ts` (or
  `shared/entitySearch.ts`) to search **active** staff excluding the caller, for the picker.

### UI
- **`src/components/app-shell/nav.ts`** — add a `NAV_ITEMS` entry `{ title: "Feedback",
  href: "/feedback", icon: IconMessageStar }` (Tabler icon).
- **`src/app/(app)/feedback/page.tsx`** (Server Component, `metadata.title`): `Promise.all`
  of `getCurrentUser`, `getFeedbackAboutMe`, `getFeedbackIGave`, and (if
  `userHasPermission(user, { feedback: ["review"] })`) `getAllFeedbackPage`. Renders:
  - Header + a `<GiveFeedbackDialog />` ("Give feedback") button.
  - **"Feedback about you"** — limited list: giver name, date, message (or muted
    "No message left"). Mark the message visually as the recipient-visible part
    (matches spec's "highlighted" ask).
  - **"Feedback you've given"** — list linking to `/feedback/[id]`.
  - **"All feedback"** (managers only) — paginated table (`crm/pagination-controls.tsx`,
    `basePath="/feedback"`), rows link to detail.
- **`src/app/(app)/feedback/[id]/page.tsx`** — full feedback detail via `getFeedbackDetail`;
  `notFound()` when null/denied.
- **`src/components/feedback/give-feedback-dialog.tsx`** (`"use client"`) — `FormDialog` +
  `useHookFormAction(createFeedback, zodResolver(createFeedbackSchema))`. Recipient chosen
  via a `Combobox` staff picker (search action), rating via the new **RadioGroup**, text via
  `Textarea`. `FormField` wrappers, `FormDialogFooter` for server error + submit
  (`loading={action.isPending}`). Message-to-recipient field labeled/hinted as the only part
  the recipient will see.
- **`src/components/feedback/feedback-table.tsx`** & list/card presentational components over
  `ui/table` / `ui/card`, following `projects/projects-table.tsx`.
- **`src/components/ui/radio-group.tsx`** — vendor via `bunx --bun shadcn@latest add radio-group`;
  replace any Lucide icon import with the Tabler equivalent (UI rule). Verify it renders on
  Base UI; if the generated component assumes Radix `asChild`, adapt to the Base UI `render`
  prop as other vendored primitives do.

### Docs
- After implementation, dispatch the **`librarian`** subagent to reconcile `/docs`
  (`docs/domains/performance.md` from *proposed* → built for the feedback slice,
  `docs/data-model.md`, and a short ADR on the feedback privacy tiers if warranted).

## Verification

1. **Types & tests:** `bun run check` (Biome + `tsc --noEmit` + `bun test`) — permissions
   matrix test must pass. `bun run build` for the full type-check.
2. **RBAC audit:** run `/audit-rbac` and address findings (new `feedback` capability, the
   create authorize hook, and the read gates are the surfaces to verify).
3. **End-to-end (use `/run` to drive the app):**
   - As a regular staff user: submit feedback about another active staff member; confirm the
     required-field validation (rating, context, at least one of keep/stop/start) and that
     self is not selectable.
   - As the **recipient**: `/feedback` shows the entry with giver name + message only — no
     rating/context/keep/stop/start leak (inspect payload/DOM to confirm the projection).
   - As the **giver**: "Feedback you've given" and the detail page show full content.
   - As a **manager/admin**: "All feedback" lists everyone's feedback in full, including their
     own; a non-manager hitting `/feedback/[id]` for someone else's feedback gets `notFound`.
4. Confirm the migration applied cleanly and the nav item routes to `/feedback`.
