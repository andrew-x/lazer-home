# Staff resume — design

**Date:** 2026-06-18
**Status:** approved (design), pending implementation plan

## Goal

Add a **resume** to staff profiles. On the profile page a user can edit their resume by either typing into a textarea or uploading a PDF, which we parse into text server-side. Either way we store the resume as **text**.

## Decisions (locked in brainstorming)

- **PDF parsing:** server-side.
- **Transport:** the PDF is base64-encoded on the client and sent to a server action (consistent with the existing CSV-import pattern; no new route-handler/API surface, no blob storage).
- **Permissions/visibility:** match the existing `clientIntro` / links fields — resume is viewable by any signed-in user on the profile, and editable under the current (not-yet-locked-down) stance. `secureActionClient` still requires a valid session. (Carry the same "TODO: lock down to owner/admin" comment.)
- **Upload UX:** uploading a PDF parses it and **fills the textarea** for review; the user then clicks **Save**. Single save path — the user always confirms what gets stored.

## Data model

`src/lib/db/staff-schema.ts` — add to the `staff` table, mirroring the `clientIntro` / `clientIntroUpdatedAt` pair:

```ts
resume: text(),
resumeUpdatedAt: timestamp(),
```

`resumeUpdatedAt` is **set explicitly** in the update action (`new Date()` whenever resume content is written), exactly like `clientIntroUpdatedAt` — *not* `.$onUpdate` (that would fire on any row update, e.g. an import re-sync).

Migration: `bun run db:generate` → `bun run db:migrate`.

`Staff` row type is `InferSelectModel`, so it picks up the new columns automatically.

## Reads

`src/actions/staff/getStaffProfile.ts` (the server-only read backing `/profile` and `/staff/[id]`) projects explicit columns — add `resume` and `resumeUpdatedAt` to its projection and to its exported `StaffProfile` return type.

## Server actions (`src/actions/staff/`)

Two actions, one per file, both on `secureActionClient`.

### 1. `updateStaffResume`

Direct clone of `updateStaffClientIntro`.

- Schema file `updateStaffResume.schema.ts`:
  ```ts
  export const updateStaffResumeSchema = z.object({
    staffId: z.string().min(1),
    resume: z
      .string()
      .trim()
      .max(50_000, "Keep the resume under 50,000 characters.")
      .transform((value) => (value === "" ? null : value)),
  });
  export type UpdateStaffResumeInput = z.input<typeof updateStaffResumeSchema>;
  ```
  (50k cap ≈ a long multi-page resume in plain text; clearing maps to `null`.)
- Action `updateStaffResume.ts`:
  - `.metadata({ action: "update-staff-resume" })`
  - `db.update(staff).set({ resume, resumeUpdatedAt: new Date() }).where(eq(staff.id, staffId)).returning({ id: staff.id })`
  - throw `UserSafeActionError("That staff profile no longer exists.")` if no row.
  - `revalidatePath("/profile")` and `revalidatePath(`/staff/${staffId}`)`.
  - Carry the same "TODO: lock down to owner/admin" comment as `updateStaffClientIntro`.

### 2. `parseResumePdf`

No DB write — pure parse-and-return.

- Schema file `parseResumePdf.schema.ts`:
  ```ts
  export const parseResumePdfSchema = z.object({
    // PDF bytes, base64-encoded (no data: prefix).
    fileBase64: z.string().min(1),
  });
  ```
- Action `parseResumePdf.ts`:
  - `.metadata({ action: "parse-resume-pdf" })`
  - Decode base64 → `Buffer`/`Uint8Array`.
  - Parse with **`unpdf`** (`extractText`) — modern, zero native deps, serverless-friendly (preferred over `pdf-parse`, which has a quirky default import). Add as a dependency (`bun add unpdf`).
  - Return `{ text }` (joined page text, trimmed).
  - On parse failure throw `UserSafeActionError("Couldn't read that PDF. Paste the text manually instead.")`.
  - Defensive size guard server-side (reject absurdly large payloads with a UserSafeActionError) in addition to the client size check.

### Config

Bump Next's server-action body size limit so a reasonable PDF (base64 inflates ~33%) fits:
`next.config` → `experimental.serverActions.bodySizeLimit: "8mb"` (verify the exact key against `node_modules/next/dist/docs/` for this pinned Next build before editing).

## UI

### Profile view — Resume card

`src/components/staff/profile-view.tsx`: add a **Resume** `Card` as a sibling of the Client intro card (same `CardHeader` + `CardAction` + `EditResumeDialog` shape).

- Body: if `profile.resume`, render `<p className="text-sm whitespace-pre-wrap">{profile.resume}</p>`; else muted "No resume yet."
- Show "Updated {formatDate(profile.resumeUpdatedAt)}" when present (small muted text), mirroring how the codebase surfaces `*UpdatedAt`.

### `EditResumeDialog` (`src/components/staff/edit-resume-dialog.tsx`)

Clone `edit-client-intro-dialog.tsx` (Dialog + `formKey` remount-on-open + inner form via **`useHookFormAction`** bound to `updateStaffResume`, pattern (a) per `.claude/rules/forms.md`). Additions:

- **Textarea**: prefilled with current `resume`, large (`rows`/`min-h`), `{...register("resume")}`, error display, char-count optional.
- **Upload PDF control**: a `<input type="file" accept="application/pdf" hidden>` triggered by a `Button` ("Upload PDF"). On file select:
  1. Client-side size check (reject > ~6 MB with an inline message — keeps base64 under the 8mb action limit).
  2. Read file → base64 (strip any `data:` prefix).
  3. Call `parseResumePdf` via `useAction` (separate from the form action). Drive a local "Parsing…" loading state and disable the upload button while pending.
  4. On success: `form.setValue("resume", text, { shouldDirty: true, shouldValidate: true })` so the parsed text lands in the textarea for review.
  5. On error: show `action.result.serverError` inline near the upload control.
- Save submits `updateStaffResume` as usual (`handleSubmitWithAction`); dialog closes via the action's `onSuccess`.

Components reused: `Dialog*`, `Button`, `Label`, `Textarea`, `IconPencil` (Tabler). Add an upload icon from `@tabler/icons-react` (e.g. `IconUpload`). No new icon library.

## Out of scope (YAGNI)

- Storing the original PDF file (we store text only).
- Locking edits to owner/admin (deferred with the rest of the profile fields; tracked by the existing browse-staff TODO).
- Rich-text / formatting preservation from the PDF — plain text only.
- Resume on the staff directory list or search.

## Verification

- `bun run check` (Biome + `tsc`) and `bun run build`.
- Manual: type a resume → Save → persists + "Updated" stamp; upload a PDF → textarea fills with parsed text → edit → Save → persists; clear textarea → Save → reverts to "No resume yet."
- After implementation, dispatch the **librarian** subagent to reconcile `/docs` (data-model + staff domain doc) with the new fields and flow.
