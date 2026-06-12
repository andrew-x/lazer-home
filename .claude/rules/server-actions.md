---
paths:
  - "src/actions/**"
  - "src/lib/action.ts"
---

# Server actions (next-safe-action)

All backend mutations go through the action layer in `src/lib/action.ts`. Read it before writing actions — auth, validation, logging, and safe errors are already handled by the client.

## Rules

- **One action per file.** `'use server'` at the top. Organize by domain folder: `src/actions/<domain>/<verb><Thing>.ts` (e.g. `staff/`, `crm/`, `allocations/`).
- **Pick the client:** `secureActionClient` (auth required, `ctx.user` injected) for almost everything; `publicActionClient` only for genuinely public actions.
- **Declare metadata:** `.metadata({ action: "kebab-case-name" })`. Add `role: "admin"` to gate at the route level (admins override all role checks).
- **Validate with `inputSchema`** (v8 name — NOT `schema`). Default to **drizzle-zod** (`createInsertSchema`/`createUpdateSchema(Table).pick(...).extend({ id })`); drop to hand-written `z.object()` only for cross-table or computed shapes.
- **Two authz layers:** route-level (`metadata.role` → middleware) AND row-level (`if (row.userId !== user.id && user.role !== "admin") throw ...` inside the body). Do both where data is owned.
- **User-facing errors:** `throw new UserSafeActionError("message")` — its message reaches the client as `result.serverError`. Any other throw is collapsed to a generic message. Never leak internals.
- **Revalidate** after mutations: `revalidatePath(...)` / `revalidateTag(...)` from `next/cache`.
- **Shared schemas go in their own file** (e.g. `updateThing.schema.ts`), never exported from the `'use server'` file — client components import the schema for the form resolver.
