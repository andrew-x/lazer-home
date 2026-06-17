# Browse Staff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-filterable staff directory and a per-person profile page, reusing the existing self-`/profile` reads, mutations, and presentation.

**Architecture:** Parameterize the existing `getMy*` reads and `updateMy*` mutations to operate on any `staffId`; `getMy*` become thin wrappers. A shared `ProfileView` server component backs both `/profile` (me) and `/staff/[id]` (anyone). The directory is a server-fetched list rendered by a client component that filters in memory.

**Tech Stack:** Next 16 (modified — `params` is a Promise), Drizzle + Postgres, next-safe-action, react-hook-form, shadcn on Base UI, Tabler icons, Bun, Biome.

**No test framework exists in this repo.** Per `AGENTS.md`, the verification gates are `bun run check` (Biome + `tsc --noEmit`) and `bun run build`, plus manual checks. Each task ends with `bun run check` and a commit; the final task runs `bun run build` and manual verification.

**Conventions to honor throughout:**
- DB access only from `src/actions/**`; pages/components call the actions layer (`.claude/rules/server-actions.md`, `database.md`).
- Reads are `import "server-only"` plain async functions named `get<Thing>.ts`; mutations are one-per-file `"use server"` next-safe-action actions with a sibling `.schema.ts`.
- Explicit column projection — never select all.
- Dates are `"YYYY-MM-DD"` strings. Latest employment = `orderBy(desc(effectiveFromDate), desc(createdAt)) limit 1`.
- shadcn/Base UI uses the `render` prop (not `asChild`); Tabler icons only; flat/sharp surfaces; semantic color classes; indigo sparingly.

---

## Task 1: Add `getCurrentStaffId` helper

Shared resolver so the `getMy*` wrappers and `/profile` page can map the signed-in user to their `staff.id` without duplicating the lookup.

**Files:**
- Create: `src/actions/staff/getCurrentStaffId.ts`

- [ ] **Step 1: Create the helper**

```ts
import "server-only";

import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";

/**
 * The signed-in user's linked staff id, or null when unauthenticated or no staff
 * record is linked to the account. Reused by the `getMy*` reads and the `/profile`
 * page (which needs the id to pass into the now-parameterized edit dialogs).
 */
export async function getCurrentStaffId(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const [row] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(eq(staff.userId, user.id))
    .limit(1);

  return row?.id ?? null;
}
```

- [ ] **Step 2: Verify and commit**

Run: `bun run check`
Expected: PASS (no type errors; file is unused so far — that's fine).

```bash
git add src/actions/staff/getCurrentStaffId.ts
git commit -m "feat(staff): add getCurrentStaffId resolver"
```

---

## Task 2: Parameterize the profile read

Extract the query body into `getStaffProfile(staffId)`; `getMyProfile()` delegates. Canonical type moves to the new file with a neutral name; `getMyProfile` re-exports it as `MyProfile` so existing imports keep working.

**Files:**
- Create: `src/actions/staff/getStaffProfile.ts`
- Modify: `src/actions/staff/getMyProfile.ts` (full rewrite below)

- [ ] **Step 1: Create the parameterized core**

```ts
import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { type StaffEmployment, staff, staffEmployment } from "@/lib/db/schema";

/**
 * A staff member's profile plus their latest employment facts. `employment` is
 * null only when a staff row has no employment history (a setup error).
 */
export type StaffProfile = {
  name: string;
  email: string;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  clientIntro: string | null;
  joinDate: string | null;
  employment: Pick<
    StaffEmployment,
    "lineOfBusiness" | "role" | "employmentType" | "isBillable"
  > | null;
};

/**
 * Read any staff member's profile by id, for SSR. NOT ownership-scoped — the
 * directory and per-person profile pages deliberately show other people; auth is
 * provided by the `(app)` layout. Returns null when the id doesn't resolve.
 */
export async function getStaffProfile(
  staffId: string,
): Promise<StaffProfile | null> {
  const [profile] = await db
    .select({
      name: staff.name,
      email: staff.email,
      linkedinUrl: staff.linkedinUrl,
      githubUrl: staff.githubUrl,
      portfolioUrl: staff.portfolioUrl,
      clientIntro: staff.clientIntro,
      joinDate: staff.joinDate,
    })
    .from(staff)
    .where(eq(staff.id, staffId))
    .limit(1);

  if (!profile) return null;

  // Latest employment row wins: effective date, then createdAt for same-day ties
  // (ADR 0007 — staff employment effective-dating).
  const [employment] = await db
    .select({
      lineOfBusiness: staffEmployment.lineOfBusiness,
      role: staffEmployment.role,
      employmentType: staffEmployment.employmentType,
      isBillable: staffEmployment.isBillable,
    })
    .from(staffEmployment)
    .where(eq(staffEmployment.staffId, staffId))
    .orderBy(
      desc(staffEmployment.effectiveFromDate),
      desc(staffEmployment.createdAt),
    )
    .limit(1);

  return { ...profile, employment: employment ?? null };
}
```

- [ ] **Step 2: Rewrite `getMyProfile.ts` to delegate**

```ts
import "server-only";

import { getCurrentStaffId } from "./getCurrentStaffId";
import { getStaffProfile, type StaffProfile } from "./getStaffProfile";

/** Back-compat alias — the profile shape is identical for self and others. */
export type MyProfile = StaffProfile;

/**
 * The signed-in user's own profile for SSR. Resolves the current staff id and
 * delegates to {@link getStaffProfile}. Returns null when unauthenticated or
 * unlinked.
 */
export async function getMyProfile(): Promise<MyProfile | null> {
  const staffId = await getCurrentStaffId();
  return staffId ? getStaffProfile(staffId) : null;
}
```

- [ ] **Step 3: Verify and commit**

Run: `bun run check`
Expected: PASS. (`/profile/page.tsx` still imports `getMyProfile`; behavior unchanged.)

```bash
git add src/actions/staff/getStaffProfile.ts src/actions/staff/getMyProfile.ts
git commit -m "refactor(staff): parameterize profile read as getStaffProfile"
```

---

## Task 3: Parameterize the history read

**Files:**
- Create: `src/actions/staff/getStaffHistory.ts`
- Modify: `src/actions/staff/getMyHistory.ts` (full rewrite below)

Note: `src/components/staff/history-sheet.tsx` imports `HistoryCategory` and `HistoryEntry` from `getMyHistory` — the rewrite re-exports both, so that file needs no change.

- [ ] **Step 1: Create the parameterized core**

```ts
import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { staffEmployment } from "@/lib/db/schema";
import { humanizeEnum } from "@/lib/format";

/**
 * The kinds of change in a person's history feed. Employment is the only source
 * today; compensation and allocation will join it. Extend the union (and add a
 * fetch + map below) when they land.
 */
export type HistoryCategory = "EMPLOYMENT" | "COMPENSATION" | "ALLOCATION";

/** One effective-dated change in the history feed, regardless of source. */
export type HistoryEntry = {
  id: string;
  /** Effective date, "YYYY-MM-DD" (wall-clock, no zone). */
  date: string;
  category: HistoryCategory;
  /** Display-ready one-line summary of what changed. */
  summary: string;
};

/**
 * Any staff member's history feed across domains, newest first. NOT
 * ownership-scoped (see getStaffProfile). Returns [] when the id has no history.
 */
export async function getStaffHistory(
  staffId: string,
): Promise<HistoryEntry[]> {
  const entries: HistoryEntry[] = [];

  const employment = await db
    .select({
      id: staffEmployment.id,
      effectiveFromDate: staffEmployment.effectiveFromDate,
      lineOfBusiness: staffEmployment.lineOfBusiness,
      role: staffEmployment.role,
      employmentType: staffEmployment.employmentType,
      isBillable: staffEmployment.isBillable,
    })
    .from(staffEmployment)
    .where(eq(staffEmployment.staffId, staffId))
    .orderBy(
      desc(staffEmployment.effectiveFromDate),
      desc(staffEmployment.createdAt),
    );

  for (const row of employment) {
    entries.push({
      id: row.id,
      date: row.effectiveFromDate,
      category: "EMPLOYMENT",
      summary: [
        humanizeEnum(row.role),
        humanizeEnum(row.lineOfBusiness),
        humanizeEnum(row.employmentType),
        row.isBillable ? "Billable" : "Non-billable",
      ].join(" · "),
    });
  }

  // Newest first across every category. "YYYY-MM-DD" sorts chronologically;
  // Array.sort is stable, so equal-date entries keep per-source insertion order.
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
```

- [ ] **Step 2: Rewrite `getMyHistory.ts` to delegate**

```ts
import "server-only";

import { getCurrentStaffId } from "./getCurrentStaffId";
import {
  type HistoryCategory,
  type HistoryEntry,
  getStaffHistory,
} from "./getStaffHistory";

export type { HistoryCategory, HistoryEntry };

/** The signed-in user's own history feed, newest first. Delegates by staff id. */
export async function getMyHistory(): Promise<HistoryEntry[]> {
  const staffId = await getCurrentStaffId();
  return staffId ? getStaffHistory(staffId) : [];
}
```

- [ ] **Step 3: Verify and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add src/actions/staff/getStaffHistory.ts src/actions/staff/getMyHistory.ts
git commit -m "refactor(staff): parameterize history read as getStaffHistory"
```

---

## Task 4: Parameterize the PTO read

**Files:**
- Create: `src/actions/staff/getStaffPto.ts`
- Modify: `src/actions/staff/getMyPto.ts` (full rewrite below)

Note: `src/components/staff/pto-section.tsx` imports `MyPto` and `PtoSpan` from `getMyPto` — the rewrite re-exports them, so that file needs no change.

- [ ] **Step 1: Create the parameterized core** (move the existing logic verbatim, swapping the ownership filter for a `staffId` filter and the join for a direct `where`)

```ts
import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { type StaffPto, staffPto } from "@/lib/db/schema";

export type PtoType = StaffPto["type"];

/** A single leave span with its Mon–Fri working-day count precomputed. */
export type PtoSpan = {
  id: string;
  startDate: string;
  endDate: string;
  type: PtoType;
  isPending: boolean;
  workingDays: number;
};

/** Total working days for one category (only non-zero categories appear). */
export type PtoCategorySummary = { type: PtoType; workingDays: number };

export type StaffPtoView = {
  /** Not yet ended (endDate >= today), soonest first. */
  upcoming: PtoSpan[];
  /** Already ended (endDate < today), most recent first. */
  past: PtoSpan[];
  /** Per-category working-day totals across all spans, largest first. */
  summary: PtoCategorySummary[];
};

/** Today as a wall-clock "YYYY-MM-DD" string (dates are timezone-agnostic). */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Count Mon–Fri days in the inclusive "YYYY-MM-DD" span (no half-days here). */
function countWorkingDays(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const cursor = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);

  let count = 0;
  while (cursor <= end) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/**
 * Any staff member's time off: upcoming and past spans plus a per-category
 * working-day summary. NOT ownership-scoped (see getStaffProfile). Counts include
 * pending requests — the list flags those.
 */
export async function getStaffPto(staffId: string): Promise<StaffPtoView> {
  const rows = await db
    .select({
      id: staffPto.id,
      startDate: staffPto.startDate,
      endDate: staffPto.endDate,
      type: staffPto.type,
      isPending: staffPto.isPending,
    })
    .from(staffPto)
    .where(eq(staffPto.staffId, staffId))
    .orderBy(asc(staffPto.startDate));

  const today = todayIso();
  const upcoming: PtoSpan[] = [];
  const past: PtoSpan[] = [];
  const totals = new Map<PtoType, number>();

  for (const row of rows) {
    const workingDays = countWorkingDays(row.startDate, row.endDate);
    const span: PtoSpan = { ...row, workingDays };

    if (row.endDate >= today) upcoming.push(span);
    else past.push(span);

    if (workingDays > 0) {
      totals.set(row.type, (totals.get(row.type) ?? 0) + workingDays);
    }
  }

  // Past spans most-recent first (the query returned them oldest first).
  past.reverse();

  const summary: PtoCategorySummary[] = [...totals.entries()]
    .map(([type, workingDays]) => ({ type, workingDays }))
    .sort((a, b) => b.workingDays - a.workingDays);

  return { upcoming, past, summary };
}
```

- [ ] **Step 2: Rewrite `getMyPto.ts` to delegate**

```ts
import "server-only";

import { getCurrentStaffId } from "./getCurrentStaffId";
import {
  type PtoCategorySummary,
  type PtoSpan,
  type PtoType,
  type StaffPtoView,
  getStaffPto,
} from "./getStaffPto";

export type { PtoCategorySummary, PtoSpan, PtoType };
/** Back-compat alias — the PTO view shape is identical for self and others. */
export type MyPto = StaffPtoView;

/** The signed-in user's own time off. Delegates by staff id. */
export async function getMyPto(): Promise<MyPto> {
  const staffId = await getCurrentStaffId();
  if (!staffId) return { upcoming: [], past: [], summary: [] };
  return getStaffPto(staffId);
}
```

- [ ] **Step 3: Verify and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add src/actions/staff/getStaffPto.ts src/actions/staff/getMyPto.ts
git commit -m "refactor(staff): parameterize PTO read as getStaffPto"
```

---

## Task 5: Add the directory read

Two queries, no N+1: all staff (+ avatar via `user` left join), all employment rows reduced in JS to the latest per staff.

**Files:**
- Create: `src/actions/staff/getStaffDirectory.ts`

- [ ] **Step 1: Create the read**

```ts
import "server-only";

import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import {
  type StaffEmployment,
  staff,
  staffEmployment,
  user,
} from "@/lib/db/schema";

/**
 * One row per staff member for the directory: identity + active flag + avatar +
 * their latest employment facts. Employment fields are null when a staff row has
 * no employment history (still listed). Includes inactive staff so the directory
 * can offer an "active only" toggle (defaults on in the UI).
 */
export type StaffDirectoryEntry = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  imageUrl: string | null;
  lineOfBusiness: StaffEmployment["lineOfBusiness"] | null;
  role: StaffEmployment["role"] | null;
  employmentType: StaffEmployment["employmentType"] | null;
  isBillable: boolean | null;
};

export async function getStaffDirectory(): Promise<StaffDirectoryEntry[]> {
  const staffRows = await db
    .select({
      id: staff.id,
      name: staff.name,
      email: staff.email,
      isActive: staff.isActive,
      imageUrl: user.image,
    })
    .from(staff)
    .leftJoin(user, eq(staff.userId, user.id))
    .orderBy(asc(staff.name));

  const employmentRows = await db
    .select({
      staffId: staffEmployment.staffId,
      lineOfBusiness: staffEmployment.lineOfBusiness,
      role: staffEmployment.role,
      employmentType: staffEmployment.employmentType,
      isBillable: staffEmployment.isBillable,
    })
    .from(staffEmployment)
    .orderBy(
      desc(staffEmployment.effectiveFromDate),
      desc(staffEmployment.createdAt),
    );

  // Rows are newest-first, so the first one seen per staffId is the latest.
  const latestByStaff = new Map<string, (typeof employmentRows)[number]>();
  for (const row of employmentRows) {
    if (!latestByStaff.has(row.staffId)) latestByStaff.set(row.staffId, row);
  }

  return staffRows.map((s) => {
    const employment = latestByStaff.get(s.id);
    return {
      id: s.id,
      name: s.name,
      email: s.email,
      isActive: s.isActive,
      imageUrl: s.imageUrl ?? null,
      lineOfBusiness: employment?.lineOfBusiness ?? null,
      role: employment?.role ?? null,
      employmentType: employment?.employmentType ?? null,
      isBillable: employment?.isBillable ?? null,
    };
  });
}
```

- [ ] **Step 2: Verify and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add src/actions/staff/getStaffDirectory.ts
git commit -m "feat(staff): add getStaffDirectory read"
```

---

## Task 6: Generalize the links mutation

Rename `updateMyLinks` → `updateStaffLinks`, add `staffId` to the input, target `staff.id`, drop owner scoping (flagged TODO).

**Files:**
- Create: `src/actions/staff/updateStaffLinks.schema.ts`
- Create: `src/actions/staff/updateStaffLinks.ts`
- Delete: `src/actions/staff/updateMyLinks.ts`, `src/actions/staff/updateMyLinks.schema.ts`

- [ ] **Step 1: Create the schema**

```ts
import { z } from "zod";

/**
 * A profile URL field: an empty string (cleared) maps to null, otherwise it must
 * be a valid URL. Lives in its own file so the edit form can import it for the
 * resolver (never export schemas from a "use server" file).
 */
const optionalUrl = z
  .union([z.literal(""), z.url("Enter a valid URL (including https://).")])
  .transform((value) => (value === "" ? null : value));

export const updateStaffLinksSchema = z.object({
  staffId: z.string().min(1),
  linkedinUrl: optionalUrl,
  githubUrl: optionalUrl,
  portfolioUrl: optionalUrl,
});

export type UpdateStaffLinksInput = z.input<typeof updateStaffLinksSchema>;
```

- [ ] **Step 2: Create the action**

```ts
"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { updateStaffLinksSchema } from "./updateStaffLinks.schema";

/**
 * Update a staff member's profile links by id.
 *
 * TODO: lock down to owner/admin. Any authenticated user can currently edit any
 * staff member's links — intentional for now (see the 2026-06-17 browse-staff
 * spec); `secureActionClient` still requires a valid session.
 */
export const updateStaffLinks = secureActionClient
  .metadata({ action: "update-staff-links" })
  .inputSchema(updateStaffLinksSchema)
  .action(async ({ parsedInput }) => {
    const [updated] = await db
      .update(staff)
      .set({
        linkedinUrl: parsedInput.linkedinUrl,
        githubUrl: parsedInput.githubUrl,
        portfolioUrl: parsedInput.portfolioUrl,
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

- [ ] **Step 3: Delete the old files**

```bash
git rm src/actions/staff/updateMyLinks.ts src/actions/staff/updateMyLinks.schema.ts
```

- [ ] **Step 4: Verify (expect a failure pointing at the dialog) — fixed in Task 8**

Run: `bun run check`
Expected: FAIL — `edit-links-dialog.tsx` still imports the deleted `updateMyLinks`. This is resolved in Task 8. Do not commit yet; proceed to Task 7 then 8, or stage all three together. (If executing strictly one task per commit, combine Task 6 + Task 8's links changes into one commit.)

---

## Task 7: Generalize the client-intro mutation

**Files:**
- Create: `src/actions/staff/updateStaffClientIntro.schema.ts`
- Create: `src/actions/staff/updateStaffClientIntro.ts`
- Delete: `src/actions/staff/updateMyClientIntro.ts`, `src/actions/staff/updateMyClientIntro.schema.ts`

- [ ] **Step 1: Create the schema**

```ts
import { z } from "zod";

/**
 * Client intro edit input. Empty (cleared) maps to null. Lives in its own file so
 * the edit form can import it for the resolver (never export schemas from a "use
 * server" file).
 */
export const updateStaffClientIntroSchema = z.object({
  staffId: z.string().min(1),
  clientIntro: z
    .string()
    .trim()
    .max(2000, "Keep the intro under 2000 characters.")
    .transform((value) => (value === "" ? null : value)),
});

export type UpdateStaffClientIntroInput = z.input<
  typeof updateStaffClientIntroSchema
>;
```

- [ ] **Step 2: Create the action**

```ts
"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { updateStaffClientIntroSchema } from "./updateStaffClientIntro.schema";

/**
 * Update a staff member's client intro by id. Stamps `clientIntroUpdatedAt`.
 *
 * TODO: lock down to owner/admin (see the 2026-06-17 browse-staff spec).
 * `secureActionClient` still requires a valid session.
 */
export const updateStaffClientIntro = secureActionClient
  .metadata({ action: "update-staff-client-intro" })
  .inputSchema(updateStaffClientIntroSchema)
  .action(async ({ parsedInput }) => {
    const [updated] = await db
      .update(staff)
      .set({
        clientIntro: parsedInput.clientIntro,
        clientIntroUpdatedAt: new Date(),
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

- [ ] **Step 3: Delete the old files**

```bash
git rm src/actions/staff/updateMyClientIntro.ts src/actions/staff/updateMyClientIntro.schema.ts
```

(Verification deferred to Task 8 — the intro dialog still imports the deleted action until then.)

---

## Task 8: Thread `staffId` through the edit dialogs

Both dialogs gain a `staffId` prop, switch to the generalized actions/schemas, and carry `staffId` as a registered hidden field so it's submitted with the form.

**Files:**
- Modify: `src/components/staff/edit-links-dialog.tsx`
- Modify: `src/components/staff/edit-client-intro-dialog.tsx`

- [ ] **Step 1: Rewrite `edit-links-dialog.tsx`**

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPencil } from "@tabler/icons-react";
import { useState } from "react";
import { updateStaffLinks } from "@/actions/staff/updateStaffLinks";
import { updateStaffLinksSchema } from "@/actions/staff/updateStaffLinks.schema";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Links = {
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
};

const FIELDS = [
  {
    name: "linkedinUrl",
    label: "LinkedIn",
    placeholder: "https://linkedin.com/in/…",
  },
  { name: "githubUrl", label: "GitHub", placeholder: "https://github.com/…" },
  { name: "portfolioUrl", label: "Portfolio", placeholder: "https://…" },
] as const;

export function EditLinksDialog({
  staffId,
  links,
}: {
  staffId: string;
  links: Links;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          <DialogTitle>Edit links</DialogTitle>
          <DialogDescription>
            Professional profiles. Leave a field blank to clear it.
          </DialogDescription>
        </DialogHeader>
        {/* Remounts each time the dialog opens, so defaults track the latest data. */}
        {open ? (
          <LinksForm
            staffId={staffId}
            links={links}
            onSaved={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function LinksForm({
  staffId,
  links,
  onSaved,
}: {
  staffId: string;
  links: Links;
  onSaved: () => void;
}) {
  const { form, action, handleSubmitWithAction } = useHookFormAction(
    updateStaffLinks,
    zodResolver(updateStaffLinksSchema),
    {
      actionProps: { onSuccess: () => onSaved() },
      formProps: {
        defaultValues: {
          staffId,
          linkedinUrl: links.linkedinUrl ?? "",
          githubUrl: links.githubUrl ?? "",
          portfolioUrl: links.portfolioUrl ?? "",
        },
      },
    },
  );

  const {
    register,
    formState: { errors },
  } = form;

  return (
    <form onSubmit={handleSubmitWithAction} className="flex flex-col gap-4">
      <input type="hidden" {...register("staffId")} />
      {FIELDS.map((field) => (
        <div key={field.name} className="flex flex-col gap-1.5">
          <Label htmlFor={field.name}>{field.label}</Label>
          <Input
            id={field.name}
            type="url"
            placeholder={field.placeholder}
            aria-invalid={Boolean(errors[field.name])}
            {...register(field.name)}
          />
          {errors[field.name] ? (
            <p className="text-sm text-destructive">
              {errors[field.name]?.message}
            </p>
          ) : null}
        </div>
      ))}

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

- [ ] **Step 2: Rewrite `edit-client-intro-dialog.tsx`**

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPencil } from "@tabler/icons-react";
import { useState } from "react";
import { updateStaffClientIntro } from "@/actions/staff/updateStaffClientIntro";
import { updateStaffClientIntroSchema } from "@/actions/staff/updateStaffClientIntro.schema";
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

export function EditClientIntroDialog({
  staffId,
  clientIntro,
}: {
  staffId: string;
  clientIntro: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          <DialogTitle>Edit client intro</DialogTitle>
          <DialogDescription>
            How this person is introduced to clients. Leave blank to clear it.
          </DialogDescription>
        </DialogHeader>
        {/* Remounts each time the dialog opens, so defaults track the latest data. */}
        {open ? (
          <ClientIntroForm
            staffId={staffId}
            clientIntro={clientIntro}
            onSaved={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ClientIntroForm({
  staffId,
  clientIntro,
  onSaved,
}: {
  staffId: string;
  clientIntro: string | null;
  onSaved: () => void;
}) {
  const { form, action, handleSubmitWithAction } = useHookFormAction(
    updateStaffClientIntro,
    zodResolver(updateStaffClientIntroSchema),
    {
      actionProps: { onSuccess: () => onSaved() },
      formProps: { defaultValues: { staffId, clientIntro: clientIntro ?? "" } },
    },
  );

  const {
    register,
    formState: { errors },
  } = form;

  return (
    <form onSubmit={handleSubmitWithAction} className="flex flex-col gap-4">
      <input type="hidden" {...register("staffId")} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="clientIntro">Client intro</Label>
        <Textarea
          id="clientIntro"
          rows={12}
          className="min-h-64"
          placeholder="A few paragraphs introducing this person to clients — background, focus areas, and what they bring to an engagement…"
          aria-invalid={Boolean(errors.clientIntro)}
          {...register("clientIntro")}
        />
        {errors.clientIntro ? (
          <p className="text-sm text-destructive">
            {errors.clientIntro.message}
          </p>
        ) : null}
      </div>

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

- [ ] **Step 3: Verify and commit Tasks 6–8 together**

Run: `bun run check`
Expected: PASS — no more references to the deleted `updateMy*` actions. (`/profile/page.tsx` will fail to type-check ONLY if it already passes props; it currently renders `<EditLinksDialog links=… />` without `staffId`, so this step WILL surface a type error there. That is fixed in Task 10. If `bun run check` flags `/profile/page.tsx` here, proceed to Task 10 before committing, or stage Tasks 6–10 together.)

```bash
git add src/actions/staff/updateStaffLinks.ts src/actions/staff/updateStaffLinks.schema.ts \
  src/actions/staff/updateStaffClientIntro.ts src/actions/staff/updateStaffClientIntro.schema.ts \
  src/components/staff/edit-links-dialog.tsx src/components/staff/edit-client-intro-dialog.tsx
git commit -m "feat(staff): generalize link/intro edits to any staffId"
```

---

## Task 9: Build the shared `ProfileView` component

Extracts the `/profile` page's presentation (header, links card, intro card) into a reusable server component, plus the inline `LinkRow`. Both `/profile` and `/staff/[id]` render it. Avatar comes from an `imageUrl` prop (not `getCurrentUser`), so it works for anyone.

**Files:**
- Create: `src/components/staff/profile-view.tsx`

- [ ] **Step 1: Create the component**

```tsx
import type { MyProfile } from "@/actions/staff/getMyProfile";
import type { HistoryEntry } from "@/actions/staff/getStaffHistory";
import type { StaffPtoView } from "@/actions/staff/getStaffPto";
import { EditClientIntroDialog } from "@/components/staff/edit-client-intro-dialog";
import { EditLinksDialog } from "@/components/staff/edit-links-dialog";
import { HistorySheet } from "@/components/staff/history-sheet";
import { PtoSection } from "@/components/staff/pto-section";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDate, humanizeEnum } from "@/lib/format";

/** Up to two initials from a name, falling back to the email's first letter. */
function initialsFor(name: string, email: string): string {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("") ||
    email[0] ||
    "?"
  ).toUpperCase();
}

/** A profile URL row, or an em dash when absent. */
function LinkRow({ label, url }: { label: string; url: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-right font-medium text-primary underline-offset-4 hover:underline"
        >
          {url}
        </a>
      ) : (
        <span className="font-medium text-muted-foreground">—</span>
      )}
    </div>
  );
}

/**
 * Read view of a staff member's profile: identity header, links, client intro,
 * time off, and history. Links and intro are editable by any signed-in user for
 * now (see the browse-staff spec). Shared by `/profile` (self) and `/staff/[id]`.
 */
export function ProfileView({
  staffId,
  imageUrl,
  profile,
  history,
  pto,
}: {
  staffId: string;
  imageUrl: string | null;
  profile: MyProfile;
  history: HistoryEntry[];
  pto: StaffPtoView;
}) {
  const { employment } = profile;
  const initials = initialsFor(profile.name, profile.email);

  const employmentSummary = employment
    ? [
        humanizeEnum(employment.role),
        humanizeEnum(employment.lineOfBusiness),
        humanizeEnum(employment.employmentType),
      ].join(" · ")
    : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex items-center gap-4">
        <Avatar className="size-12">
          {imageUrl ? <AvatarImage src={imageUrl} alt={profile.name} /> : null}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-xl font-semibold tracking-tight">
              {profile.name}
            </h2>
            {employment ? (
              <Badge variant={employment.isBillable ? "default" : "secondary"}>
                {employment.isBillable ? "Billable" : "Non-billable"}
              </Badge>
            ) : null}
          </div>
          {employmentSummary ? (
            <span className="text-sm text-muted-foreground">
              {employmentSummary}
            </span>
          ) : null}
          <span className="text-sm text-muted-foreground">
            {profile.email}
            {profile.joinDate
              ? ` · Joined ${formatDate(profile.joinDate)}`
              : ""}
          </span>
        </div>
        <div className="ml-auto self-start">
          <HistorySheet entries={history} />
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Links</CardTitle>
          <CardAction>
            <EditLinksDialog
              staffId={staffId}
              links={{
                linkedinUrl: profile.linkedinUrl,
                githubUrl: profile.githubUrl,
                portfolioUrl: profile.portfolioUrl,
              }}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <LinkRow label="LinkedIn" url={profile.linkedinUrl} />
          <LinkRow label="GitHub" url={profile.githubUrl} />
          <LinkRow label="Portfolio" url={profile.portfolioUrl} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Client intro</CardTitle>
          <CardAction>
            <EditClientIntroDialog
              staffId={staffId}
              clientIntro={profile.clientIntro}
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          {profile.clientIntro ? (
            <p className="text-sm whitespace-pre-wrap">{profile.clientIntro}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No client intro yet.
            </p>
          )}
        </CardContent>
      </Card>

      <PtoSection pto={pto} />
    </div>
  );
}
```

- [ ] **Step 2: Verify and commit**

Run: `bun run check`
Expected: PASS (component compiles; not yet used).

```bash
git add src/components/staff/profile-view.tsx
git commit -m "feat(staff): extract shared ProfileView component"
```

---

## Task 10: Refactor `/profile` to render `ProfileView`

**Files:**
- Modify: `src/app/(app)/profile/page.tsx` (full rewrite below)

- [ ] **Step 1: Rewrite the page**

```tsx
import type { Metadata } from "next";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { getMyHistory } from "@/actions/staff/getMyHistory";
import { getMyProfile } from "@/actions/staff/getMyProfile";
import { getMyPto } from "@/actions/staff/getMyPto";
import { ProfileView } from "@/components/staff/profile-view";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  // `user` supplies the Google avatar image; the rest is staff data, all scoped
  // to the signed-in user. The (app) layout already guards auth.
  const [user, staffId, profile, history, pto] = await Promise.all([
    getCurrentUser(),
    getCurrentStaffId(),
    getMyProfile(),
    getMyHistory(),
    getMyPto(),
  ]);
  if (!user || !staffId || !profile) return null;

  return (
    <ProfileView
      staffId={staffId}
      imageUrl={user.image ?? null}
      profile={profile}
      history={history}
      pto={pto}
    />
  );
}
```

- [ ] **Step 2: Verify and commit**

Run: `bun run check`
Expected: PASS.

Manual smoke (optional now, required in Task 14): `bun run dev`, open `/profile`, confirm it renders identically and editing links/intro still saves.

```bash
git add "src/app/(app)/profile/page.tsx"
git commit -m "refactor(profile): render shared ProfileView"
```

---

## Task 11: Build the directory card and client filter component

`StaffCard` renders one person; `StaffDirectory` holds filter state and renders the grid. Filter options are passed in as plain `string[]` from the server page (Task 12) to avoid bundling Drizzle's enum module into the client.

**Files:**
- Create: `src/components/staff/staff-card.tsx`
- Create: `src/components/staff/staff-directory.tsx`

- [ ] **Step 1: Create `staff-card.tsx`**

```tsx
import Link from "next/link";
import type { StaffDirectoryEntry } from "@/actions/staff/getStaffDirectory";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { humanizeEnum } from "@/lib/format";

function initialsFor(name: string, email: string): string {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("") ||
    email[0] ||
    "?"
  ).toUpperCase();
}

/** One staff member as a clickable card linking to their profile. */
export function StaffCard({ entry }: { entry: StaffDirectoryEntry }) {
  const subtitle = [entry.role, entry.lineOfBusiness]
    .filter(Boolean)
    .map((value) => humanizeEnum(value as string))
    .join(" · ");

  return (
    <Card
      render={
        <Link
          href={`/staff/${entry.id}`}
          className="flex flex-col items-center gap-3 p-5 text-center transition-colors hover:bg-accent"
        />
      }
    >
      <Avatar className="size-14">
        {entry.imageUrl ? (
          <AvatarImage src={entry.imageUrl} alt={entry.name} />
        ) : null}
        <AvatarFallback>{initialsFor(entry.name, entry.email)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-medium">{entry.name}</span>
        {subtitle ? (
          <span className="truncate text-sm text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </div>
      {!entry.isActive ? <Badge variant="secondary">Inactive</Badge> : null}
    </Card>
  );
}
```

Note on `render`: Base UI's polymorphism (`.claude/rules/ui.md`) — `<Card render={<Link/>}>` makes the whole card the link. Confirm `Card` forwards `render` (it wraps a Base UI primitive); if `Card` is a plain `div` that does NOT accept `render`, instead wrap: `<Link …><Card>…</Card></Link>` and move the padding/hover classes onto the `Link`. Check `src/components/ui/card.tsx` before choosing.

- [ ] **Step 2: Create `staff-directory.tsx`**

```tsx
"use client";

import { IconSearch } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import type { StaffDirectoryEntry } from "@/actions/staff/getStaffDirectory";
import { StaffCard } from "@/components/staff/staff-card";
import { Input } from "@/components/ui/input";
import { humanizeEnum } from "@/lib/format";
import { cn } from "@/lib/utils";

const ALL = "ALL";

/** A labelled native select styled to match the input primitive. */
function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const id = `filter-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "h-9 rounded border bg-transparent px-3 text-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <option value={ALL}>All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {humanizeEnum(option)}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Staff directory: client-side name search + line-of-business / role / type
 * filters + an "active only" toggle (default on). All filtering is in-memory over
 * the full list fetched once on the server.
 */
export function StaffDirectory({
  entries,
  lineOfBusinessOptions,
  roleOptions,
  typeOptions,
}: {
  entries: StaffDirectoryEntry[];
  lineOfBusinessOptions: string[];
  roleOptions: string[];
  typeOptions: string[];
}) {
  const [search, setSearch] = useState("");
  const [lineOfBusiness, setLineOfBusiness] = useState(ALL);
  const [role, setRole] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [activeOnly, setActiveOnly] = useState(true);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (activeOnly && !entry.isActive) return false;
      if (query && !entry.name.toLowerCase().includes(query)) return false;
      if (lineOfBusiness !== ALL && entry.lineOfBusiness !== lineOfBusiness)
        return false;
      if (role !== ALL && entry.role !== role) return false;
      if (type !== ALL && entry.employmentType !== type) return false;
      return true;
    });
  }, [entries, search, lineOfBusiness, role, type, activeOnly]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by name…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <FilterSelect
            label="Line of business"
            value={lineOfBusiness}
            options={lineOfBusinessOptions}
            onChange={setLineOfBusiness}
          />
          <FilterSelect
            label="Role"
            value={role}
            options={roleOptions}
            onChange={setRole}
          />
          <FilterSelect
            label="Type"
            value={type}
            options={typeOptions}
            onChange={setType}
          />
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(event) => setActiveOnly(event.target.checked)}
              className="size-4"
            />
            Active only
          </label>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No staff match these filters.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((entry) => (
            <StaffCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add src/components/staff/staff-card.tsx src/components/staff/staff-directory.tsx
git commit -m "feat(staff): directory card + client-side filter UI"
```

---

## Task 12: Create the directory page

**Files:**
- Create: `src/app/(app)/staff/page.tsx`

- [ ] **Step 1: Create the page**

The page reads the enum value lists from the Drizzle enums (server-side) and passes them as plain `string[]` props, keeping Drizzle out of the client bundle.

```tsx
import type { Metadata } from "next";
import { getStaffDirectory } from "@/actions/staff/getStaffDirectory";
import { StaffDirectory } from "@/components/staff/staff-directory";
import {
  employmentTypeEnum,
  lineOfBusinessEnum,
  roleEnum,
} from "@/lib/db/schema";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const entries = await getStaffDirectory();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          Staff
        </h2>
        <p className="text-sm text-muted-foreground">
          Browse the team. Search and filter to find someone.
        </p>
      </header>
      <StaffDirectory
        entries={entries}
        lineOfBusinessOptions={[...lineOfBusinessEnum.enumValues]}
        roleOptions={[...roleEnum.enumValues]}
        typeOptions={[...employmentTypeEnum.enumValues]}
      />
    </div>
  );
}
```

Note: importing the enums from `@/lib/db/schema` into a Server Component is fine (Drizzle runs server-side). The `[...enum.enumValues]` spread converts the readonly tuple to a mutable `string[]` matching the prop type.

- [ ] **Step 2: Verify and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add "src/app/(app)/staff/page.tsx"
git commit -m "feat(staff): browse-staff directory page"
```

---

## Task 13: Create the per-person profile page

**Files:**
- Create: `src/app/(app)/staff/[id]/page.tsx`

Before writing, read `node_modules/next/dist/docs/` for the dynamic-route / `params` convention in this Next build — `params` is a **Promise** here and must be awaited (`.claude/rules/nextjs.md`).

- [ ] **Step 1: Create the page**

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStaffAvatar } from "@/actions/staff/getStaffAvatar";
import { getStaffHistory } from "@/actions/staff/getStaffHistory";
import { getStaffProfile } from "@/actions/staff/getStaffProfile";
import { getStaffPto } from "@/actions/staff/getStaffPto";
import { ProfileView } from "@/components/staff/profile-view";

export const metadata: Metadata = { title: "Staff profile" };

export default async function StaffProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [profile, history, pto, imageUrl] = await Promise.all([
    getStaffProfile(id),
    getStaffHistory(id),
    getStaffPto(id),
    getStaffAvatar(id),
  ]);

  if (!profile) notFound();

  return (
    <ProfileView
      staffId={id}
      imageUrl={imageUrl}
      profile={profile}
      history={history}
      pto={pto}
    />
  );
}
```

- [ ] **Step 2: Create the avatar read it depends on** (`getStaffAvatar`)

The list join can't be reused for a single profile; add a tiny read so the page doesn't touch `db` directly (server-actions rule).

Create `src/actions/staff/getStaffAvatar.ts`:

```ts
import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { staff, user } from "@/lib/db/schema";

/**
 * A staff member's avatar URL (their linked auth account's image), or null when
 * unlinked or no image. Separate from the profile read because the avatar lives
 * on the auth `user` row, not on `staff`.
 */
export async function getStaffAvatar(staffId: string): Promise<string | null> {
  const [row] = await db
    .select({ imageUrl: user.image })
    .from(staff)
    .leftJoin(user, eq(staff.userId, user.id))
    .where(eq(staff.id, staffId))
    .limit(1);

  return row?.imageUrl ?? null;
}
```

- [ ] **Step 3: Verify and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add "src/app/(app)/staff/[id]/page.tsx" src/actions/staff/getStaffAvatar.ts
git commit -m "feat(staff): per-person profile page"
```

---

## Task 14: Add the "Staff" nav item

**Files:**
- Modify: `src/components/app-shell/nav.ts`

- [ ] **Step 1: Add `IconUsers` import and the nav entry**

Change the import block and `NAV_ITEMS`:

```ts
import {
  type Icon,
  IconHome,
  IconSettings,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { APP_NAME } from "@/lib/constants";

export type NavItem = { title: string; href: string; icon: Icon };

/** Primary nav shown in the sidebar (icons + labels). Extend as domains land. */
export const NAV_ITEMS: NavItem[] = [
  { title: "Home", href: "/", icon: IconHome },
  { title: "Staff", href: "/staff", icon: IconUsers },
  { title: "My profile", href: "/profile", icon: IconUser },
  { title: "Settings", href: "/settings", icon: IconSettings },
];
```

Note: `titleForPath` matches the longest `href` prefix, so `/profile` and `/staff/[id]` resolve correctly regardless of order. `/staff` placed above `/profile` for sensible visual ordering.

- [ ] **Step 2: Verify and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add src/components/app-shell/nav.ts
git commit -m "feat(staff): add Staff nav item"
```

---

## Task 15: Full build + manual verification + docs

- [ ] **Step 1: Full type-check and production build**

Run: `bun run check && bun run build`
Expected: both PASS. Fix any errors before continuing.

- [ ] **Step 2: Manual verification** (`bun run dev`, with the local DB up — `docker compose up -d` — and seeded staff)

Confirm each:
- `/staff` loads a card grid; only active staff show by default.
- Typing a name filters the grid; clearing restores it.
- Each of Line of business / Role / Type dropdowns narrows results; combinations AND together.
- Unchecking "Active only" reveals inactive staff (badged "Inactive").
- "No staff match these filters." appears when filters exclude everyone.
- Clicking a card navigates to `/staff/<id>` and shows that person's profile (header, links, intro, time off, history).
- Editing links and client intro from `/staff/<id>` saves and the change persists on reload.
- `/profile` still renders identically and its edits still save.
- A bogus id (`/staff/does-not-exist`) renders the not-found page.
- The sidebar shows a "Staff" icon; the header reads "Staff" on the directory and "Staff profile" on a profile.

- [ ] **Step 3: Reconcile docs** — dispatch the `librarian` subagent (Agent tool) with a summary:

> Implemented browse-staff: new `/staff` directory (client-filtered card grid) and `/staff/[id]` profile page. Parameterized the staff reads (`getStaffProfile`/`getStaffHistory`/`getStaffPto`, with `getMy*` now thin wrappers via new `getCurrentStaffId`) and added `getStaffDirectory` + `getStaffAvatar`. Generalized the link/intro mutations (`updateMyLinks`/`updateMyClientIntro` → `updateStaffLinks`/`updateStaffClientIntro`) to take a `staffId` and dropped owner-scoping (TODO: lock down to owner/admin). Extracted a shared `ProfileView` rendered by both `/profile` and `/staff/[id]`. Reconcile `docs/domains/staff-profiles.md`, `docs/flows.md`, `docs/architecture.md`, and add an ADR if the opened-up edit authorization warrants one.

- [ ] **Step 4: Final commit** (if the librarian changed docs)

```bash
git add docs
git commit -m "docs: reconcile for browse-staff feature"
```

---

## Self-review notes (resolved while writing)

- **Spec coverage:** directory + filters + active-default (T11–12), client-side only (T11), per-person profile (T13), reuse of reads (T2–4), mutations (T6–8), components (T9, T11), open edits (T6–7), nav (T14), librarian + verification (T15). All covered.
- **Type consistency:** `StaffProfile`/`MyProfile`, `StaffPtoView`/`MyPto`, `HistoryEntry`, `StaffDirectoryEntry` referenced consistently across tasks. Re-exports keep `pto-section.tsx` and `history-sheet.tsx` unchanged.
- **Cross-task build ordering:** deleting `updateMy*` (T6–7) breaks the dialogs and `/profile` until T8/T10. Flagged inline — either stage T6–T10 together or expect intermediate `bun run check` failures. Honest about it rather than pretending each task is independently green.
- **Open risk:** `StaffCard`'s `<Card render={<Link/>}>` assumes `Card` forwards Base UI's `render` prop — T11 Step 1 includes a fallback (wrap in `<Link>`) and says to check `card.tsx` first.
- **No test framework:** verification is `bun run check` / `bun run build` + manual, per `AGENTS.md` (overrides the skill's TDD default).
