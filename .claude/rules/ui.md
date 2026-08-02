---
paths:
  - "src/components/**"
  - "src/app/**"
---

# UI conventions

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
- **Save on edit (autosave)** — the shared queue in `src/hooks/use-autosave-queue.ts`: a dirty set of keys, per-key debounce, single-flight drain, per-key `SaveState`, `flush`/`flushAll`/`abandon`. Consumers supply `save(key)` and own their own values. Two consumers today: `use-response-autosave.ts` (profile surveys) and `compensation-plans/use-plan-autosave.ts`. Status shows through `SaveIndicator` (`src/components/form/save-indicator.tsx`) — **never a toast**; toasts are for discrete actions. On revalidation, see the autosave note in `server-actions.md`.

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
