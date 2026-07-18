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
- **Cursor:** a global base rule gives buttons and ARIA-interactive elements `cursor-pointer` — don't add `cursor-pointer` per component.
- Use **semantic classes** (`bg-primary`, `text-muted-foreground`, `border`) — never raw hex / `indigo-600`. Conditional classes via `cn()` from `@/lib/utils`.
- The login page is deliberately **minimal** (logo + name + one button); keep auth/marketing surfaces uncluttered.
- Brand: mark is `/public/icon.svg` (`<LogoMark>` / `<LogoWordmark>` in `src/components/brand/`). Product name is `APP_NAME` in `src/lib/constants.ts`.

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
