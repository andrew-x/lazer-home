<!--
Codex nested AGENTS.md — mirrors .claude/rules/server-actions.md (Claude Code loads
that rule by path glob; Codex loads this file when your cwd is at/under src/actions).
Deliberate duplication — keep in sync with the rule; /audit-agents checks parity.
The RBAC/permissions rule that also governs this dir lives in the root AGENTS.md
("Permissions — the inviolable rule") and always applies.
-->

# Server actions (next-safe-action)

All backend mutations go through the action layer in `src/lib/action.ts`. Read it before writing actions — auth, validation, logging, and safe errors are already handled by the client.

## The actions layer is the entry point for DB access

**Pages, layouts, and components never import `db` or touch a table** — including Server Components doing SSR data fetching. They call a function from the actions layer instead. This keeps every read and write in one place to authorize, project columns, and evolve.

- **Mutations** → next-safe-action actions (the rules below).
- **Reads** (incl. SSR) → a plain **server-only** async function in the same domain folder: `import "server-only"` at the top, named `get<Thing>.ts` (e.g. `timesheets/getTimesheet.ts`). NOT a `'use server'` action — a `'use server'` read would force the `{ data, serverError }` envelope and re-run session checks, awkward to consume during SSR. Resolve the current user inside (`getCurrentUser`) and filter by ownership so results are inherently scoped. Export a return type; pages `await` it directly.

Two narrow exceptions still import `db`, and both are fine: **framework wiring** (the Better Auth Drizzle adapter in `src/lib/auth.ts`) and **pure compute helpers an action delegates to** (e.g. `src/lib/*-import/plan.ts`, reached only through an action, never a page). The rule is about the *call site*: feature UI goes through the actions layer. (There is no `src/lib` straggler: `getCurrentStaff` was folded into the actions layer as `src/actions/staff/getCurrentStaffAccess.ts` and `src/lib/staff.ts` was deleted — see ADR 0010.)

## Mutation rules

- **One action per file.** `'use server'` at the top. Organize by domain folder: `src/actions/<domain>/<verb><Thing>.ts` (e.g. `staff/`, `crm/`, `allocations/`).
- **Pick the client:** `secureActionClient` (auth required, `ctx.user` injected) for almost everything; `publicActionClient` only for genuinely public actions.
- **Declare metadata:** `.metadata({ action: "kebab-case-name" })`. Add `role: "admin"` to gate at the route level (admins override all role checks), or `permission: { staff: ["edit"] }` to require a capability.
- **Validate with `inputSchema`** (v8 name — NOT `schema`). Default to **drizzle-zod** (`createInsertSchema`/`createUpdateSchema(Table).pick(...).extend({ id })`); drop to hand-written `z.object()` only for cross-table or computed shapes.
- **Authorization is declared in metadata, not hand-written in bodies.** `metadata.role` (coarse), `metadata.permission` (static capability), or `metadata.authorize` (an `ActionAuthorize` hook reading `clientInput` for ownership / input-dependent checks) — all enforced by `secureActionClient` before the body, never inside it. The `authorize` hook is generic; domains supply their own (e.g. `authorizeStaffEdit`). See the root AGENTS.md permissions rule.
- **User-facing errors:** `throw new UserSafeActionError("message")` — its message reaches the client as `result.serverError`. Any other throw is collapsed to a generic message. Never leak internals.
- **Revalidate** after mutations: `revalidatePath(...)` / `revalidateTag(...)` from `next/cache`.
- **Shared schemas go in their own file** (e.g. `updateThing.schema.ts`), never exported from the `'use server'` file — client components import the schema for the form resolver.
