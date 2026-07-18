# 0005 — UI stack: shadcn on Base UI (base-nova), indigo light theme

**Status:** accepted · 2026-06-12

## Context

The stack selection ([0003](./0003-stack-selection.md)) committed to Tailwind v4 + `cn()` but left the component layer open ("UI" was an undecided row). Building the authenticated shell forced the choice: we need a component system that's consistent, accessible, ownable, and fast to extend across many domain screens — without taking a heavy runtime dependency on an external design system we can't shape.

## Decision

Use **shadcn** (copy-in, not a dependency) on **Base UI** primitives, with the **`base-nova`** preset, **Lucide** icons, and the **Geist** font. Config lives in `components.json`; vendored primitives live in `src/components/ui/**`.

- **Base UI, not Radix.** shadcn's `base-nova` style sits on Base UI primitives. The practical consequence: polymorphism is a **`render` prop**, not Radix's `asChild`. This is the single most likely thing to trip a future session (and our training data).
- **Vendored, not a package.** Primitives are copied into the repo so we own them. They're treated as generated code: don't hand-edit, and `biome.json` has an `overrides` block disabling a few lint rules (a11y label/svg-title, exhaustive-deps, document-cookie) just for `src/components/ui/**`. Update via `shadcn add --overwrite`.
- **Theme: indigo accent, light mode only.** Tokens are oklch CSS vars in `src/app/globals.css`, surfaced to Tailwind v4 via `@theme inline`. `--primary` is the Tailwind indigo ramp over a neutral base. A `.dark` block ships with the registry but is intentionally unused — there's no toggle and no requirement for one yet.
- **Brand stays off-accent on purpose.** The mark (`public/icon.svg`) is magenta (`#FF00C5`); the product chrome is indigo. Logo = brand identity, indigo = app surface. Documented so nobody "fixes" the mismatch.

## Consequences

- Adding UI is `bunx --bun shadcn@latest add <name>`, then composing — consistent and accessible by default.
- We own the primitives (can patch them), at the cost of manual `--overwrite` updates and the Biome carve-out.
- All UI must use **semantic token classes** (`bg-primary`, `text-muted-foreground`, …), never raw hex — so a future re-theme is one file (`globals.css`).
- Anyone reaching for Radix's `asChild` will be wrong here; use `render`.
- See [ui.md](../ui.md) and `.claude/rules/ui.md`.

## Alternatives considered

- **shadcn on Radix (the classic stack)** — rejected for `base-nova`'s Base UI foundation; the team chose the newer preset. Cost: `render` vs `asChild` is a gotcha for anyone with Radix muscle memory.
- **A packaged design system (e.g. MUI/Mantine as a dependency)** — rejected: we want to own and patch primitives without fighting a library's opinions, and to keep the bundle lean.
- **Dark mode now** — deferred: no requirement; the tokens leave the door open if it's ever decided.
