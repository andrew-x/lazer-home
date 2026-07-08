# Add skills to staff profiles

## Context

Staff profiles currently carry identity, links, client intro, resume, and PTO — but
no capability data. We want each person's **skills** with a **proficiency level**
(`senior` / `intermediate` / `learning`) surfaced as a section on their profile and
editable on a **dedicated page** (not a dialog).

Skills are chosen from a **hardcoded config list** in code (grouped by discipline),
and stored **inline on the staff record** — not as a normalized `skill` table with FK
references (per the explicit request). The docs currently describe a *proposed*
many:many `Skill` entity (`docs/domains/staff-profiles.md`, `docs/data-model.md`); this
feature deliberately takes the simpler inline path, which must be reconciled in docs.

Decisions confirmed with the user:
- Config **grouped by discipline** (Languages, Frameworks, etc.) — placeholder skills for now.
- Edit page uses **three proficiency buckets** (Senior / Intermediate / Learning), each with an "Add skill" picker; selected skills show as removable chips. A skill lives in exactly one bucket.
- Editable by **self + managers/admins** — reuse the existing `authorizeStaffEdit` / `staff.edit` gate. **No new permission** (so no `permissions.ts` / matrix-test / permissions-doc changes).

## Storage decision

Add a single `jsonb` column `skills` to the `staff` table holding
`Array<{ name: string; level: ProficiencyLevel }>`. This honors "stored as text, not a
dedicated table." **Note:** this is the first `jsonb`/array column in the schema (all
existing columns are scalar) — a new but idiomatic shape. Verify the Drizzle `jsonb`
+ `.default([])` syntax against the installed `drizzle-orm` version and the schema
conventions in `.claude/rules/database.md` before generating the migration.

## Implementation

### 1. Skills config — `src/lib/skills.ts` (new, client-safe, no `server-only` import)
Mirror the client-safe value-tuple convention in `src/lib/staff-import/types.ts`.
- `PROFICIENCY_LEVELS = ["senior", "intermediate", "learning"] as const` + `type ProficiencyLevel`.
- `PROFICIENCY_LABELS: Record<ProficiencyLevel, string>` and a display order (Senior → Intermediate → Learning).
- `SKILL_CATEGORIES: ReadonlyArray<{ name: string; skills: readonly string[] }>` — placeholder groups (e.g. Languages, Frameworks, Cloud & Infra, Design) with a handful of skills each. Ordered for display.
- Derived `ALL_SKILLS: readonly string[]` (flat, from the groups) for validation, and a `SKILL_TO_CATEGORY` map for grouping on display.
- `type StaffSkill = { name: string; level: ProficiencyLevel }`.
Leave a clear comment that placeholders will be replaced by the full list later.

### 2. Schema + migration — `src/lib/db/staff-schema.ts`
Add to the `staff` table:
```ts
skills: jsonb().$type<StaffSkill[]>().notNull().default([]),
```
Import `StaffSkill` from `@/lib/skills` and `jsonb` from `drizzle-orm/pg-core`.
Then `bun run db:generate` → `bun run db:migrate`.

### 3. Read — `src/actions/staff/getStaffProfile.ts`
Add `skills: staff.skills` to the `.select({...})` projection and `skills: StaffSkill[]`
to the exported `StaffProfile` type.

### 4. Update action + schema (mirror `updateStaffLinks` / `updateStaffResume`)
- **`src/actions/staff/updateStaffSkills.schema.ts`** (new): `z.object({ staffId: z.string().min(1), skills: z.array(z.object({ name: z.string(), level: z.enum(PROFICIENCY_LEVELS) })).max(200) })` with a `.superRefine` that (a) rejects any `name` not in `ALL_SKILLS`, and (b) rejects duplicate names (one level per skill). Export `type UpdateStaffSkillsInput = z.input<...>`.
- **`src/actions/staff/updateStaffSkills.ts`** (new): `'use server'`, `secureActionClient.metadata({ action: "update-staff-skills", authorize: authorizeStaffEdit }).inputSchema(updateStaffSkillsSchema)`. Body: `db.update(staff).set({ skills }).where(eq(staff.id, staffId)).returning({ id })`; throw `UserSafeActionError` if no row; `revalidatePath("/profile")`, `revalidatePath("/staff/${staffId}")`, `revalidatePath("/staff/${staffId}/skills")`.

### 5. Profile Skills section — `src/components/staff/skills-section.tsx` (new) + wire into `profile-view.tsx`
- New presentational component (keeps `ProfileView` tidy, like `PtoSection`). Renders a `<Card>` titled **Skills**; content groups skills by proficiency level (Senior / Intermediate / Learning) as `Badge` chips, empty state "No skills yet."
- In `profile-view.tsx`, add the card after Resume. When `canEdit`, put an edit affordance in `CardAction`: a link-button to the edit page — `<Button variant="outline" size="sm" render={<Link href={`/staff/${staffId}/skills`} />}>Edit</Button>` (Base UI `render` prop per `.claude/rules/ui.md`, not a dialog).

### 6. Dedicated edit page — `src/app/(app)/staff/[id]/skills/page.tsx` (new)
Async Server Component. Mirror `src/app/(app)/staff/[id]/page.tsx` for **`params` handling** (it's a Promise in this Next build — read the existing page, don't assume). Steps:
- Resolve `id`, `getCurrentUser()`, and `canEditStaff(user, id)`. If not editable → `notFound()` (server boundary; UI affordance is only shown when `canEdit`).
- `getStaffProfile(id)` for current skills + name; `notFound()` if null.
- `export const metadata` / page heading "Edit skills · {name}", a back link to `/staff/${id}` (ghost button + Tabler back icon), and render `<EditSkillsForm staffId={id} initialSkills={profile.skills} />`.
Use the `max-w-3xl mx-auto` + `font-heading` heading page layout from `src/app/(app)/settings/page.tsx`.

### 7. Edit form — `src/components/staff/edit-skills-form.tsx` (new, client)
Bucket UI (forms style **b** — local state + `useAction`, since the shape is a custom grouped list, not a flat rhf form):
- `useState<StaffSkill[]>(initialSkills)`. Three sections from `PROFICIENCY_LEVELS`; each lists its skills as removable chips (Badge + `IconButton` with `label`, Tabler X icon).
- Each bucket has an **"Add skill"** control: a grouped `Select` (`src/components/ui/select.tsx`, `SelectGroup`/`SelectLabel` by discipline from `SKILL_CATEGORIES`) listing only skills **not yet chosen in any bucket**; picking one appends `{ name, level }`.
- `const { execute, isExecuting, result } = useAction(updateStaffSkills)`; Save button driven by `isExecuting`, errors read from `result.serverError`. On success, `router.push(`/staff/${staffId}`)` so the change is visible on the profile. (Follow `.claude/rules/forms.md`.)

No nav entry needed (reached from the profile card).

## After implementation — docs (dispatch `librarian`)
Reconcile the three-way lockstep and record the decision:
- `docs/domains/staff-profiles.md` — skills are now **built** (inline, config-driven, self+manager editable via a dedicated page); update the "proposed" status and open question on skill taxonomy/proficiency scale.
- `docs/data-model.md` — Person→Skill is realized as an **inline `jsonb` array on `staff`**, not a many:many table; update lines describing the proposed entity + ER diagram.
- New ADR in `docs/decisions/` — "Skills stored inline (jsonb) from a hardcoded config, not a normalized table," with the why (simplicity now; taxonomy still small/curated) and the tradeoff (no cross-staff skill queries/joins).

## Verification
1. `bun run db:generate` && `bun run db:migrate` — migration applies cleanly; confirm the `skills` column exists (`bun run db:studio`).
2. `bun run check` (Biome + `tsc --noEmit` + tests) and `bun run build`.
3. Consider a small unit test for `updateStaffSkillsSchema`: rejects an unknown skill name and duplicate names, accepts a valid set.
4. `bun run dev` and drive the flow end-to-end:
   - As yourself: `/profile` shows an empty **Skills** card → click **Edit** → land on `/staff/<id>/skills` → add skills into Senior/Intermediate/Learning, remove one, Save → redirected back, skills render grouped by level.
   - As a **manager/admin** viewing another person's `/staff/<id>`: Edit affordance present and editing works.
   - As a **non-manager** viewing someone else's `/staff/<id>`: Skills card visible, **no** Edit affordance; hitting `/staff/<id>/skills` directly → 404 (`notFound`).
5. `/audit-rbac` is not required (no permission-matrix change), but confirm the action's `authorize: authorizeStaffEdit` gate is present.
