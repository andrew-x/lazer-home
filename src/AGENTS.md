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
- **Cursor:** a global base rule gives buttons and ARIA-interactive elements `cursor-pointer` — don't add `cursor-pointer` per component.
- Use **semantic classes** (`bg-primary`, `text-muted-foreground`, `border`) — never raw hex / `indigo-600`. Conditional classes via `cn()` from `@/lib/utils`.
- The login page is deliberately **minimal** (logo + name + one button); keep auth/marketing surfaces uncluttered.
- Brand: mark is `/public/icon.svg` (`<LogoMark>` / `<Logo>` in `src/components/brand/`). Product name is `APP_NAME` in `src/lib/constants.ts`.

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
