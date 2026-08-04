<!--
Codex nested AGENTS.md — mirrors three path-scoped Claude Code rules that all apply
broadly across src/ (src/app, src/components, src/hooks):
  .claude/rules/nextjs.md  ·  .claude/rules/ui.md  ·  .claude/rules/forms.md
Claude Code loads them by path glob; Codex loads this file when your cwd is at/under
src/. Placed here (the common ancestor) so it applies whether you're in src/app,
src/components, or src/hooks. Deliberate duplication — keep in sync with the rules;
/audit-agents checks parity. Deeper areas add their own AGENTS.md (src/actions,
src/lib/db); the RBAC/permissions rule lives in the root AGENTS.md and always applies.
-->

# Working with this (modified) Next.js

This repo pins a Next.js build with **breaking changes** vs. public releases. Your training data is likely wrong about its APIs, file conventions, and config.

**Before writing or editing any Next.js code:**
1. Read the relevant guide under `node_modules/next/dist/docs/` for the API you're about to use (routing, data fetching, config, etc.).
2. Heed any deprecation notices there over your prior assumptions.
3. If a public-Next.js pattern you "know" isn't confirmed by those docs, verify before using it.

For library/framework APIs generally, prefer the Context7 docs MCP over memory.

---

# UI conventions

*(Applies to `src/components/**` and `src/app/**`.)*

**Use shadcn whenever possible.** Before hand-writing a component, check if shadcn has it and add it:

```
bunx --bun shadcn@latest add <name>     # e.g. dialog, table, tabs, badge
```

- **Library:** shadcn on **Base UI** primitives (`base-nova` preset, Geist). Config in `components.json`.
- **Vendored primitives** live in `src/components/ui/**` — don't hand-edit them; Biome skips linting that dir (see `biome.json` overrides). Re-add with `--overwrite` to update. (Note: re-adding pulls Lucide imports — we've migrated those to Tabler, so re-swap if you re-add.)
- **Polymorphism:** Base UI uses a `render` prop, NOT Radix's `asChild`. To render a button/menu item as a link: `<Button render={<Link href="/x" />}>`.
- **Icons:** `@tabler/icons-react` (`Icon*` components, e.g. `IconHome`). Do not add other icon libraries.
- **Icon-only buttons:** use `IconButton` (`src/components/icon-button.tsx`) — it requires a `label` and renders a **tooltip + aria-label**. Never ship a bare icon-only button without a tooltip. (SidebarMenuButton's `tooltip` prop already covers the collapsed nav.)

## Theming & design language

Aim for a distinctive, editorial look — not the default rounded/shadowed AI-app aesthetic. Design tokens (oklch) live in `src/app/globals.css`. The app is **light mode only** (the `.dark` block is unused).

- **Sharp corners:** `--radius` is `0.25rem` (4px). Keep it tight; don't bump radii per-component.
- **Flat surfaces:** no elevation shadows on **in-page** surfaces — hairline `border`s define edges. A global rule (`globals.css`, `@layer utilities`) neutralizes `shadow-*` utilities, so don't rely on shadows for separation between in-page surfaces; use `border` instead. **Exception — floating overlays** (Select/dropdown menus, Popover, Dialog, Tooltip) keep a soft elevation shadow as a usability cue that they sit above the page: the same global rule re-applies a `box-shadow` to their `[data-slot="*-content"]` elements. Overlays get **both** a `border` (crisp edge) and that shadow (depth). Don't flatten overlays.
- **Indigo sparingly:** the UI is mostly monochrome (neutral grays). Indigo (`--primary`/`--ring`) appears only on primary buttons, focus rings, links, and the active nav icon. Don't tint hovers/cards/backgrounds with indigo.
- **Cursor:** a global utilities-layer rule (declared in `@layer utilities`, not base, so it beats the `cursor-default` the vendored primitives hardcode) gives buttons and ARIA-interactive elements `cursor-pointer` — don't add `cursor-pointer` per component.
- Use **semantic classes** (`bg-primary`, `text-muted-foreground`, `border`) — never raw hex / `indigo-600`. Conditional classes via `cn()` from `@/lib/utils`.
- **The login page is the one deliberate exception to all of the above** — it's the only surface that isn't product chrome. `(auth)/login/page.tsx` is a quiet dot-grid sheet with **exactly one** hand-drawn annotation: a graphite arrow that strokes itself in toward the Google button, captioned "sign in here". Contents: logo mark + `APP_NAME` + the button + a bottom-centre "Any problems? Contact Andrew." — nothing else. **Spend the boldness once: don't add a second flourish**, and don't "fix" it back to a plain centred column. `--ink` (`text-ink`/`stroke-ink`) is login-only. The page renders **all at once** — a staggered entrance was built and then deliberately removed, so don't reintroduce one; the only motion is a hover nudge on the ink. Full rationale in `docs/ui.md` → *Login page*. Everywhere else, keep surfaces uncluttered.
- Brand: mark is `/public/icon.svg` (`<LogoMark>` / `<LogoWordmark>` in `src/components/brand/`). Product name is `APP_NAME` in `src/lib/core/constants.ts`.

## Editable tables — two patterns, not interchangeable

Pick by **when the write happens**, and don't bend one into the other:

- **Batch edit (draft → confirm)** — `EditableTable` / `useEditableRows` (`src/components/admin/editable-table.tsx`). Accumulates a diff, shows a floating "N changed" bar, confirms in a dialog, saves once. Used by edit-levels, bulk-edit-roles, manage-users. **Gotcha:** cell editors must read the draft via the `useEditableDraft()` context, NOT TanStack `table.options.meta` — `cell.getContext()` is memoized, so cells silently freeze. Draft values must be a **flat** `Record<string, string>` for `!==` diffing.
- **Save on edit (autosave)** — the shared queue in `src/hooks/use-autosave-queue.ts`: a dirty set of keys, per-key debounce, single-flight drain, per-key `SaveState`, `flush`/`flushAll`/`abandon`. Consumers supply `save(key)` and own their own values. Two consumers today: `use-response-autosave.ts` (profile surveys) and `compensation-plans/use-plan-autosave.ts`. Status shows through `SaveIndicator` (`src/components/form/save-indicator.tsx`) — **never a toast**; toasts are for discrete actions. On revalidation, see the autosave note in the server-actions rules.

`EditableTable` renders exactly one `<tr>` per row, so **expandable rows can't be built on it.** The one expandable table (`performance/compensation-plans/plan-editor.tsx`) uses the `Table` primitives directly with a `Set<string>` of expanded ids and a second `<tr>` whose `colSpan` comes from a shared column list — keep the header and that `colSpan` sourced from the same array or the layout breaks silently. Flush a row's pending saves *before* collapsing it, or the panel unmounts with unsaved text.

## App structure & navigation

- `src/app/(app)/**` — **authenticated** pages. The `(app)/layout.tsx` Server Component calls `getCurrentUser()` and `redirect("/login")` if absent, then renders `AppShell`. Route protection lives here, not in middleware.
- **Sidebar** is a **floating icon island**: `<Sidebar variant="floating" collapsible="icon">` with `SidebarProvider defaultOpen={false}`, so it defaults to an icon rail; nav icons get tooltips automatically. Sidebar icons are `size-5`. The open/close **toggle lives in the sidebar footer** (a `SidebarMenuButton` calling `useSidebar().toggleSidebar`). There is **no global page header bar** — pages render their own in-page `<h2>` title and set the tab title via `export const metadata`.
- `src/app/(auth)/**` — **public** pages (currently just `/login`).
- **Add a nav item** by editing `src/components/app-shell/nav.ts` (`NAV_ITEMS`) — drives the sidebar entries (there's no page-title header).
- Auth is **Google-only**: `authClient.signIn.social({ provider: "google" })` / `authClient.signOut()`.

## Error / not-found / loading (Next 16 specifics)

- `error.tsx` is a **Client Component**; the retry prop is **`unstable_retry`** (this Next build), NOT `reset`.
- `not-found.tsx` is a Server Component; trigger with `notFound()` from `next/navigation`.
- `global-error.tsx` replaces the root layout, so it renders its own `<html>`/`<body>` with inline styles.

## JSX text — no HTML entities in a client component

Write apostrophes and ampersands **literally** (`doesn't`, `R&D`), not as `&apos;` / `&amp;`, in any `"use client"` component. An entity inside a **multi-line** JSX text run makes **SWC drop that run's leading space** while Babel keeps it — and Next runs React Compiler (Babel) on the *client* compilation only (`getReactCompilerPlugins` returns `undefined` when `isServer`), so the browser and the SSR HTML end up one space apart. React reports it as *"server rendered text didn't match the client"* on a paragraph that looks completely innocent.

- **Don't "fix" it with `{" "}`** — an explicit `{" "}` does converge the two builds, but `bun run format` collapses it straight back to a literal space. Drop the entity instead.
- **`&nbsp;` isn't interchangeable with a space.** If you need one, keep its text run on a single line so no leading-space decision is in play.
- Server Components are immune (never re-rendered on the client), so the same text is safe outside `"use client"` — but it becomes a silent bug the day the file gains the directive.

Precedent: the explanatory paragraph in `src/components/home/staffing-panel.tsx`.

---

# Forms (react-hook-form + next-safe-action)

*(Applies to `src/components/**` and `src/hooks/**`.)*

Client forms use react-hook-form + Zod and bind to server actions in two deliberate ways. Pick by how closely the form shape matches the action input.

- **(a) Tight binding — `useHookFormAction`** (`@next-safe-action/adapter-react-hook-form/hooks`). One hook wires form + action; gives `handleSubmitWithAction` and `form`. Use when the form shape == the action input. See `src/components/staff/edit-links-dialog.tsx` (the form is gated on dialog `open` so it remounts with fresh defaults each time, and closes via the action's `onSuccess`).
- **(b) Loose binding — `useForm` + `useAction`.** Keep a manual `onSubmit` that transforms data, then `execute(...)`. Use when the form shape ≠ action input (e.g. `useFieldArray` produces `{ value }[]` but the action wants `string[]`).

## Always

- Drive button loading state from `isPending` / `isExecuting`.
- Read server errors off **`action.result.serverError`** (or `error.serverError` in `onError`) — that's the string `handleServerError` chose to surface.
- Confirm success by the flow's own signal: dialog/navigation flows close or redirect; in-place actions use `toast.success`.
- Use `cn()` from `@/lib/utils` for conditional class names.
