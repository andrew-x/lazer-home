# Staff Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a staff member set their resume on the profile page by typing into a textarea or uploading a PDF we parse to text server-side; store the resume as text with a `resumeUpdatedAt` stamp.

**Architecture:** Two new `staff` columns (`resume`, `resumeUpdatedAt`) mirror the existing `clientIntro` / `clientIntroUpdatedAt` pair. A new `updateStaffResume` action (clone of `updateStaffClientIntro`) writes the text and stamps the time. A separate `parseResumePdf` action takes a base64-encoded PDF, extracts text with `unpdf`, and returns it — no DB write. A new `EditResumeDialog` (clone of `EditClientIntroDialog`) holds a textarea plus an "Upload PDF" button that calls `parseResumePdf` and drops the extracted text into the textarea for review before the user saves.

**Tech Stack:** Next.js 16 (pinned build), Drizzle + Postgres, next-safe-action v8, react-hook-form + `@next-safe-action/adapter-react-hook-form`, Zod v4, shadcn-on-Base-UI, Tabler icons, `unpdf` (new), Bun + Biome.

## Global Constraints

- Runtime/package manager is **Bun**; linter/formatter is **Biome**. Verify with `bun run check` (Biome + `tsc --noEmit`) and `bun run build`.
- **No test framework exists** in this repo and AGENTS.md defines verification as `bun run check` + `bun run build` + manual checks. Each task below therefore ends with a `bun run check` gate (plus `bun run build` / manual where noted) instead of unit tests — do **not** add a test runner.
- **DB access only from `src/actions/**`.** Pages/components never import `db`. Reads = `import "server-only"` async fns named `get<Thing>`; mutations = one `'use server'` action per file on `secureActionClient`.
- **Schemas live in their own `*.schema.ts` file** — never export a schema from a `'use server'` file (the client form imports it for the resolver).
- **Drizzle casing:** write camelCase keys, omit explicit column names (snake_case is derived). Timestamps use `timestamp()` (no timezone). Project explicit columns — never `select()` all.
- **UI:** shadcn/Base UI primitives in `src/components/ui/**` (don't hand-edit them). Icons from `@tabler/icons-react` only. Use `cn()` for conditional classes. Sharp corners / flat surfaces — overlays keep their shadow. Light mode only.
- After all tasks, dispatch the **librarian** subagent to reconcile `/docs`.

Reference implementations to clone (read them before editing):
- Action: `src/actions/staff/updateStaffClientIntro.ts`
- Action schema: `src/actions/staff/updateStaffClientIntro.schema.ts`
- Dialog/form: `src/components/staff/edit-client-intro-dialog.tsx`
- Read: `src/actions/staff/getStaffProfile.ts`
- Profile view: `src/components/staff/profile-view.tsx`

---

### Task 1: Add `resume` columns to the staff schema + migrate

**Files:**
- Modify: `src/lib/db/staff-schema.ts` (the `staff` table, after the `clientIntro` pair at lines 83-84)

**Interfaces:**
- Produces: two new columns on the `staff` table — `resume` (`text`, nullable) and `resumeUpdatedAt` (`timestamp`, nullable). The `Staff` row type (`InferSelectModel<typeof staff>`) gains `resume: string | null` and `resumeUpdatedAt: Date | null` automatically.

- [ ] **Step 1: Add the columns**

In `src/lib/db/staff-schema.ts`, inside `export const staff = pgTable("staff", { ... })`, add the two fields immediately after the existing `clientIntro` / `clientIntroUpdatedAt` lines:

```ts
  clientIntro: text(),
  clientIntroUpdatedAt: timestamp(),

  // Free-text resume. Typed in or extracted from an uploaded PDF (we store text
  // only, never the file). `resumeUpdatedAt` is stamped explicitly by the update
  // action when the text changes — NOT $onUpdate, which would fire on every row
  // write (e.g. an import re-sync).
  resume: text(),
  resumeUpdatedAt: timestamp(),
```

- [ ] **Step 2: Generate the migration**

Run: `bun run db:generate`
Expected: a new SQL file appears under `./drizzle` adding `resume` and `resume_updated_at` columns to `staff` (`ALTER TABLE "staff" ADD COLUMN ...`). No other tables touched.

- [ ] **Step 3: Apply the migration**

Run: `bun run db:migrate`
Expected: migration applies cleanly against the remote dev Postgres (exit 0).

- [ ] **Step 4: Typecheck**

Run: `bun run check`
Expected: PASS (no type or lint errors).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/staff-schema.ts drizzle
git commit -m "feat(staff): add resume + resumeUpdatedAt columns"
```

---

### Task 2: Surface `resume` / `resumeUpdatedAt` from the profile read

**Files:**
- Modify: `src/actions/staff/getStaffProfile.ts` (the `StaffProfile` type, lines 12-24, and the select projection, lines 37-45)

**Interfaces:**
- Consumes: the `staff.resume` / `staff.resumeUpdatedAt` columns from Task 1.
- Produces: `StaffProfile` gains `resume: string | null` and `resumeUpdatedAt: Date | null`, available to `/profile` and `/staff/[id]` SSR and to `ProfileView`.

- [ ] **Step 1: Extend the `StaffProfile` type**

In `src/actions/staff/getStaffProfile.ts`, add the two fields to the `StaffProfile` type, after `clientIntro`:

```ts
  clientIntro: string | null;
  resume: string | null;
  resumeUpdatedAt: Date | null;
```

- [ ] **Step 2: Project the new columns**

In the first `db.select({ ... })` (the `staff` projection), add the two columns after `clientIntro: staff.clientIntro,`:

```ts
        clientIntro: staff.clientIntro,
        resume: staff.resume,
        resumeUpdatedAt: staff.resumeUpdatedAt,
        joinDate: staff.joinDate,
```

(No change needed to the return statement — `...profile` already spreads them.)

- [ ] **Step 3: Typecheck**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/actions/staff/getStaffProfile.ts
git commit -m "feat(staff): include resume in profile read"
```

---

### Task 3: `updateStaffResume` action

**Files:**
- Create: `src/actions/staff/updateStaffResume.schema.ts`
- Create: `src/actions/staff/updateStaffResume.ts`

**Interfaces:**
- Consumes: `staff.resume` / `staff.resumeUpdatedAt` (Task 1).
- Produces:
  - `updateStaffResumeSchema` (Zod) and `UpdateStaffResumeInput = z.input<typeof updateStaffResumeSchema>` — imported by the form in Task 5.
  - `updateStaffResume` action — input `{ staffId: string; resume: string }`, returns `{ ok: true }`.

- [ ] **Step 1: Write the schema file**

Create `src/actions/staff/updateStaffResume.schema.ts`:

```ts
import { z } from "zod";

/**
 * Resume edit input. Empty (cleared) maps to null. Lives in its own file so the
 * edit form can import it for the resolver (never export schemas from a "use
 * server" file).
 */
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

- [ ] **Step 2: Write the action**

Create `src/actions/staff/updateStaffResume.ts`:

```ts
"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { updateStaffResumeSchema } from "./updateStaffResume.schema";

/**
 * Update a staff member's resume by id. Stamps `resumeUpdatedAt`.
 *
 * TODO: lock down to owner/admin (see the 2026-06-17 browse-staff spec).
 * `secureActionClient` still requires a valid session.
 */
export const updateStaffResume = secureActionClient
  .metadata({ action: "update-staff-resume" })
  .inputSchema(updateStaffResumeSchema)
  .action(async ({ parsedInput }) => {
    const [updated] = await db
      .update(staff)
      .set({
        resume: parsedInput.resume,
        resumeUpdatedAt: new Date(),
      })
      .where(eq(staff.id, parsedInput.staffId))
      .returning({ id: staff.id });

    if (!updated) {
      throw new UserSafeActionError("That staff profile no longer exists.");
    }

    revalidatePath("/profile");
    revalidatePath(`/staff/${parsedInput.staffId}`);
    return { ok: true };
  });
```

- [ ] **Step 3: Typecheck**

Run: `bun run check`
Expected: PASS. (Confirms `secureActionClient`, `UserSafeActionError`, and `@/lib/db/schema` re-export `staff` as used by the sibling action.)

- [ ] **Step 4: Commit**

```bash
git add src/actions/staff/updateStaffResume.ts src/actions/staff/updateStaffResume.schema.ts
git commit -m "feat(staff): updateStaffResume action"
```

---

### Task 4: `parseResumePdf` action (+ `unpdf` dep, body-size limit)

**Files:**
- Modify: `package.json` (add `unpdf` via Bun)
- Modify: `next.config.ts`
- Create: `src/actions/staff/parseResumePdf.schema.ts`
- Create: `src/actions/staff/parseResumePdf.ts`

**Interfaces:**
- Produces: `parseResumePdf` action — input `{ fileBase64: string }`, returns `{ text: string }`. Imported by the dialog in Task 5. `parseResumePdfSchema` is exported from the schema file.

- [ ] **Step 1: Add the dependency**

Run: `bun add unpdf`
Expected: `unpdf` appears in `package.json` dependencies; lockfile updated.

- [ ] **Step 2: Raise the server-action body-size limit**

Edit `next.config.ts` so server actions accept a base64 PDF (base64 inflates bytes ~33%; 8mb covers a ~6 MB PDF):

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
```

(Confirmed against `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md` for this pinned build: `serverActions.bodySizeLimit` accepts a `bytes` string like `"8mb"`.)

- [ ] **Step 3: Write the schema file**

Create `src/actions/staff/parseResumePdf.schema.ts`:

```ts
import { z } from "zod";

/**
 * A PDF to extract resume text from. `fileBase64` is the raw PDF bytes,
 * base64-encoded with no `data:` prefix. ~8 MB of base64 ≈ a ~6 MB PDF, which
 * sits under the configured server-action body limit; reject anything larger
 * server-side as a backstop to the client's own size check.
 */
export const parseResumePdfSchema = z.object({
  fileBase64: z
    .string()
    .min(1, "No file provided.")
    .max(8_000_000, "That PDF is too large. Keep it under ~6 MB."),
});
```

- [ ] **Step 4: Write the action**

Create `src/actions/staff/parseResumePdf.ts`:

```ts
"use server";

import { extractText, getDocumentProxy } from "unpdf";
import { secureActionClient } from "@/lib/action";
import { UserSafeActionError } from "@/lib/errors";
import { parseResumePdfSchema } from "./parseResumePdf.schema";

/**
 * Extract plain text from an uploaded PDF so the client can drop it into the
 * resume textarea for review. Does NOT touch the database — the user reviews
 * and then saves via `updateStaffResume`. `secureActionClient` requires a
 * valid session.
 */
export const parseResumePdf = secureActionClient
  .metadata({ action: "parse-resume-pdf" })
  .inputSchema(parseResumePdfSchema)
  .action(async ({ parsedInput }) => {
    let text: string;
    try {
      const bytes = new Uint8Array(Buffer.from(parsedInput.fileBase64, "base64"));
      const pdf = await getDocumentProxy(bytes);
      ({ text } = await extractText(pdf, { mergePages: true }));
    } catch {
      throw new UserSafeActionError(
        "Couldn't read that PDF. Paste the text manually instead.",
      );
    }

    const trimmed = text.trim();
    if (!trimmed) {
      throw new UserSafeActionError(
        "That PDF had no extractable text (it may be scanned images). Paste the text manually instead.",
      );
    }

    return { text: trimmed };
  });
```

- [ ] **Step 5: Typecheck + build**

Run: `bun run check`
Expected: PASS (resolves `unpdf` types and the action shape).

Run: `bun run build`
Expected: PASS — confirms `unpdf` bundles in the server build and `next.config.ts` is valid for this build.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock next.config.ts src/actions/staff/parseResumePdf.ts src/actions/staff/parseResumePdf.schema.ts
git commit -m "feat(staff): parseResumePdf action with unpdf"
```

---

### Task 5: `EditResumeDialog` component

**Files:**
- Create: `src/components/staff/edit-resume-dialog.tsx`

**Interfaces:**
- Consumes: `updateStaffResume` + `updateStaffResumeSchema` (Task 3), `parseResumePdf` (Task 4).
- Produces: `EditResumeDialog` React component — props `{ staffId: string; resume: string | null }`. Used by `ProfileView` in Task 6.

- [ ] **Step 1: Write the component**

Create `src/components/staff/edit-resume-dialog.tsx`. Pattern (a) tight binding via `useHookFormAction` for the save, plus a separate `useAction(parseResumePdf)` for upload. A hidden file input is triggered by an "Upload PDF" button; on select the file is read to base64 (via `FileReader`, robust for large files), parsed, and the result written into the textarea with `form.setValue`.

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPencil, IconUpload } from "@tabler/icons-react";
import { useId, useRef, useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { parseResumePdf } from "@/actions/staff/parseResumePdf";
import { updateStaffResume } from "@/actions/staff/updateStaffResume";
import { updateStaffResumeSchema } from "@/actions/staff/updateStaffResume.schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Client-side guard so we never POST a payload over the server-action body
// limit (8mb of base64 ≈ ~6 MB raw). Matches the server-side backstop.
const MAX_PDF_BYTES = 6 * 1024 * 1024;

/** Read a File's bytes as base64 (no `data:` prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is a data URL: "data:application/pdf;base64,XXXX"
      resolve(result.split(",", 2)[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function EditResumeDialog({
  staffId,
  resume,
}: {
  staffId: string;
  resume: string | null;
}) {
  const [open, setOpen] = useState(false);
  // Bump on each open so the form remounts with fresh defaults (matches
  // edit-client-intro-dialog.tsx — keeps the form mounted through the close
  // animation).
  const [formKey, setFormKey] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setFormKey((k) => k + 1);
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <IconPencil />
            Edit
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit resume</DialogTitle>
          <DialogDescription>
            Type your resume or upload a PDF to extract its text. Review the text
            before saving. Leave blank to clear it.
          </DialogDescription>
        </DialogHeader>
        <ResumeForm
          key={formKey}
          staffId={staffId}
          resume={resume}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ResumeForm({
  staffId,
  resume,
  onSaved,
}: {
  staffId: string;
  resume: string | null;
  onSaved: () => void;
}) {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { form, action, handleSubmitWithAction } = useHookFormAction(
    updateStaffResume,
    zodResolver(updateStaffResumeSchema),
    {
      actionProps: { onSuccess: () => onSaved() },
      formProps: { defaultValues: { staffId, resume: resume ?? "" } },
    },
  );

  const {
    register,
    setValue,
    formState: { errors },
  } = form;

  const parse = useAction(parseResumePdf, {
    onSuccess: ({ data }) => {
      if (data?.text) {
        setValue("resume", data.text, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    },
    onError: ({ error }) => {
      setUploadError(error.serverError ?? "Couldn't read that PDF.");
    },
  });

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    setUploadError(null);
    const file = event.target.files?.[0];
    // Reset the input so selecting the same file again re-fires change.
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_PDF_BYTES) {
      setUploadError("That PDF is too large. Keep it under ~6 MB.");
      return;
    }
    const fileBase64 = await fileToBase64(file);
    parse.execute({ fileBase64 });
  }

  return (
    <form onSubmit={handleSubmitWithAction} className="flex flex-col gap-4">
      <input type="hidden" {...register("staffId")} />

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="resume">Resume</Label>
        <input
          ref={fileInputRef}
          id={fileInputId}
          type="file"
          accept="application/pdf"
          hidden
          onChange={onFileChange}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={parse.isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          <IconUpload />
          Upload PDF
        </Button>
      </div>

      <Textarea
        id="resume"
        rows={16}
        className="min-h-80"
        placeholder="Paste or type your resume here, or upload a PDF to extract its text…"
        aria-invalid={Boolean(errors.resume)}
        {...register("resume")}
      />
      {errors.resume ? (
        <p className="text-sm text-destructive">{errors.resume.message}</p>
      ) : null}
      {uploadError ? (
        <p className="text-sm text-destructive">{uploadError}</p>
      ) : null}

      {action.result.serverError ? (
        <p className="text-sm text-destructive">{action.result.serverError}</p>
      ) : null}

      <DialogFooter>
        <DialogClose
          render={
            <Button type="button" variant="outline">
              Cancel
            </Button>
          }
        />
        <Button type="submit" loading={action.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run check`
Expected: PASS. (Confirms `useAction` import path `next-safe-action/hooks`, the `Textarea`/`Label`/`Dialog`/`Button` imports, and that `Button` accepts a `loading` prop — all already used elsewhere in `src/components/staff/`.)

- [ ] **Step 3: Commit**

```bash
git add src/components/staff/edit-resume-dialog.tsx
git commit -m "feat(staff): EditResumeDialog with PDF upload"
```

---

### Task 6: Resume card on the profile view (+ timestamp helper)

**Files:**
- Modify: `src/lib/format.ts` (add `formatTimestamp`)
- Modify: `src/components/staff/profile-view.tsx` (import + new card after the Client intro card, lines 125-144)

**Interfaces:**
- Consumes: `EditResumeDialog` (Task 5), `profile.resume` / `profile.resumeUpdatedAt` (Task 2).
- Produces: `formatTimestamp(value: Date): string` in `src/lib/format.ts`.

- [ ] **Step 1: Add a timestamp formatter**

`formatDate` only accepts `"YYYY-MM-DD"` strings, but `resumeUpdatedAt` is a `Date`. Add a sibling helper to `src/lib/format.ts`:

```ts
/** Format a timestamp (e.g. `resumeUpdatedAt`) as a long date, e.g. "June 18, 2026". */
export function formatTimestamp(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(value);
}
```

- [ ] **Step 2: Import the dialog and helper in `profile-view.tsx`**

Add the dialog import alongside the other staff component imports (after the `EditClientIntroDialog` import on line 4):

```ts
import { EditClientIntroDialog } from "@/components/staff/edit-client-intro-dialog";
import { EditResumeDialog } from "@/components/staff/edit-resume-dialog";
```

And add `formatTimestamp` to the existing `@/lib/format` import (line 17):

```ts
import { formatDate, formatTimestamp, humanizeEnum, initialsFor } from "@/lib/format";
```

- [ ] **Step 3: Add the Resume card**

In `src/components/staff/profile-view.tsx`, insert a new card immediately after the closing `</Card>` of the Client intro card and before `<PtoSection pto={pto} />`:

```tsx
      <Card>
        <CardHeader>
          <CardTitle>Resume</CardTitle>
          <CardAction>
            <EditResumeDialog staffId={staffId} resume={profile.resume} />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {profile.resume ? (
            <>
              <p className="text-sm whitespace-pre-wrap">{profile.resume}</p>
              {profile.resumeUpdatedAt ? (
                <p className="text-xs text-muted-foreground">
                  Updated {formatTimestamp(profile.resumeUpdatedAt)}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No resume yet.</p>
          )}
        </CardContent>
      </Card>
```

- [ ] **Step 4: Typecheck + build**

Run: `bun run check`
Expected: PASS.

Run: `bun run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts src/components/staff/profile-view.tsx
git commit -m "feat(staff): resume card on profile view"
```

---

### Task 7: Manual verification + docs

**Files:** none (verification + docs reconciliation)

- [ ] **Step 1: Run the app and exercise the flow**

Run: `bun run dev`, open `/profile` (and a `/staff/[id]`), then:
- Resume card shows "No resume yet." for an empty profile.
- Click **Edit** → type text → **Save** → dialog closes, card shows the text and an "Updated <date>" line.
- Click **Edit** → **Upload PDF**, pick a text-based PDF → button shows loading → textarea fills with extracted text → edit if needed → **Save** → persists.
- Upload a scanned/image-only PDF (or a non-PDF renamed `.pdf`) → inline error "Couldn't read that PDF…" / "no extractable text…"; the textarea and saved value are untouched.
- Edit → clear the textarea → **Save** → card reverts to "No resume yet." (stored `null`).
- Confirm an oversized PDF (>6 MB) is rejected client-side with the size message before any request.

Expected: all behaviors as described; no console errors.

- [ ] **Step 2: Final gate**

Run: `bun run check && bun run build`
Expected: both PASS.

- [ ] **Step 3: Reconcile docs (librarian)**

Dispatch the **librarian** subagent (Agent tool) with a summary: "Added `resume` + `resumeUpdatedAt` to the `staff` table; new `updateStaffResume` and `parseResumePdf` (unpdf) actions; `EditResumeDialog` with PDF-to-text upload on the profile view; raised `serverActions.bodySizeLimit` to 8mb." Let it update `docs/data-model.md`, `docs/domains/staff*.md`, and any flows/decisions docs. Do not hand-write `/docs`.

- [ ] **Step 4: Commit any stray changes**

```bash
git add -A && git commit -m "docs: reconcile staff resume feature" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Schema `resume` + `resumeUpdatedAt` → Task 1. ✓
- Read projection + type → Task 2. ✓
- `updateStaffResume` (stamps time, clears to null) → Task 3. ✓
- `parseResumePdf` server-side with `unpdf`, base64 transport, body-size bump → Task 4. ✓
- `EditResumeDialog` (textarea + upload-fills-textarea, single save path) → Task 5. ✓
- Resume card on `ProfileView` w/ empty state + "Updated" stamp → Task 6. ✓
- Permissions "match existing fields" → Tasks 3/4 reuse `secureActionClient` with the same not-locked-down stance + TODO comment. ✓
- Size guards (client + server) → Tasks 4 (server max + size message) and 5 (client `MAX_PDF_BYTES`). ✓
- Out-of-scope items (store PDF, owner/admin lock, rich text, directory) → not implemented, as specified. ✓
- Verification + librarian → Task 7. ✓

**Placeholder scan:** No TBD/TODO-as-work; the only "TODO" is the verbatim owner/admin comment carried from the existing action (intentional, matches the codebase). All code steps show complete code.

**Type consistency:** `StaffProfile.resume`/`resumeUpdatedAt` (Task 2) ↔ `EditResumeDialog` prop `resume: string | null` and `formatTimestamp(value: Date)` (Tasks 5/6). `updateStaffResumeSchema` name consistent across Tasks 3/5. `parseResumePdf` returns `{ text }`, consumed as `data.text` in Task 5. `fileBase64` field name consistent across Tasks 4/5. ✓
