# Redesign the login page — "marked-up mockup"

## Context

`/login` is the only surface of Lazer Home that isn't product chrome, and today it's the most anonymous screen in the app: a 36px logo, `text-xl` product name, one outline button, and "Lazer staff only." It could belong to any B2B SaaS.

Andrew wants it to feel **fun, whimsical and premium**, with the content pared to three things: the product name, the sign-in button, and a bottom-centre "if you have any problems, contact Andrew" message. The subtitle goes.

**The direction:** the page is a precise, quiet sheet — faint dot grid, big gradient brand mark, crisp Geist type — with exactly **one** hand-drawn ink layer on top: a wobbly graphite arrow that strokes itself in after load, pointing at the Google button, with a short handwritten note. Two voices in tension — machine-precise product type against a human pencil mark. The whimsy is the gesture; everything around it stays disciplined. It suits a software consultancy: the login screen looks like a design-review printout someone scribbled on.

Boldness is spent in one place. Ink is graphite, so the **logo gradient stays the only colour on the page**.

### This deliberately overrides a documented rule

Three places currently say the login page must stay bare:

- `docs/ui.md:112` — *"a single centered column — logo mark + product name + one Google button + 'Lazer staff only' — no card, no gradient."*
- `.claude/rules/ui.md:30` and its Codex mirror `src/AGENTS.md:50` — *"The login page is deliberately **minimal** (logo + name + one button)."*

All three must be rewritten as part of this change, or the next session will "fix" the redesign back out. The in-app design language (flat, sharp, monochrome, indigo-sparing) is **not** being relaxed — this is an explicit, scoped exception for `(auth)/login`.

## Decisions taken

| Question | Answer |
|---|---|
| Direction | Marked-up mockup (dot grid + one ink arrow + handwritten note) |
| Ink colour | Graphite `oklch(0.45 0 0)` — logo gradient remains the only colour |
| "Lazer staff only." | **Dropped** — Google gates access, and `/profile-setup` already catches anyone without a staff record |
| Contact message | Plain text, no link: "Any problems? Contact Andrew." |

## Changes

### 1. `src/app/globals.css` — tokens + keyframes

Add to `:root`, next to the existing colour tokens, with a comment noting it's the login annotation ink:

```css
/* Pencil-on-paper ink for the login page's hand-drawn annotation. Not part of
   the product chrome — the app UI stays monochrome neutral + indigo. */
--ink: oklch(0.45 0 0);
```

Map it in `@theme inline` (`--color-ink: var(--ink);`) so `stroke-ink` / `text-ink` are real Tailwind utilities and the "semantic classes only, never raw hex" rule (`.claude/rules/ui.md:27`) stays intact.

Add three keyframes plus a reduced-motion escape. Keep them together under a commented `/* Login page entrance */` block:

```css
@keyframes login-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes login-pop  { from { opacity: 0; transform: scale(0.92); }     to { opacity: 1; transform: none; } }
@keyframes ink-draw   { from { stroke-dashoffset: 1; }                   to { stroke-dashoffset: 0; } }

@media (prefers-reduced-motion: reduce) {
  [data-login-anim] { animation: none !important; opacity: 1 !important; transform: none !important; }
  [data-ink] { stroke-dashoffset: 0 !important; }
}
```

The ink path uses `pathLength={1}` with `strokeDasharray: 1`, so `ink-draw` needs no path-length measurement.

### 2. `src/app/(auth)/login/page.tsx` — rewrite

Stays an async Server Component with the existing `getCurrentUser()` / `redirect("/")` gate and `metadata`. No client component is needed — every moving part is CSS.

**Handwriting face.** Load `Architects_Daughter` from `next/font/google` **in this module, not the root layout**, so the font only ships on `/login`:

```tsx
const marker = Architects_Daughter({ weight: "400", subsets: ["latin"], variable: "--font-marker" });
```

Verified against `node_modules/next/dist/compiled/@next/font/dist/google/font-data.json` — Architects Daughter exists with `weights: ["400"]`, `subsets: ["latin","latin-ext"]`. It's an architect's-lettering face, which serves the annotated-drawing concept; Caveat is the reflexive default and reads more "cutesy note" than "marked-up drawing." Apply `marker.variable` to the `<main>` and use `font-[family-name:var(--font-marker)]` on the annotation.

**Structure** (`<main className="relative flex min-h-svh flex-col items-center justify-center px-6">`):

1. **Paper ground** — `absolute inset-0`, `aria-hidden`, `pointer-events-none`. Dots via `radial-gradient(circle, var(--border) 1px, transparent 1px)` at `background-size: 24px 24px`, vignetted with `mask-image: radial-gradient(ellipse 65% 55% at 50% 45%, #000, transparent)`. `--border` (`oklch(0.922 0 0)`) is already the codebase's hairline grey — no new colour.
2. **Centred stack** (`relative z-10`):
   - `<LogoMark size={56} priority />` — reuse the existing `src/components/brand/logo.tsx` component unchanged. It renders an `unoptimized` `next/image`, so it can't be recoloured, but `opacity`/`transform` animate fine on an `<img>`; wrap it in a div carrying `login-pop`. Do **not** inline the SVG.
   - `<h1 className="font-heading text-4xl font-semibold tracking-[-0.03em]">{APP_NAME}</h1>` — up from `text-xl`. Precision-typeset, no display-face import: Geist-at-scale vs. pencil *is* the contrast.
   - Generous gap (`mt-24`-ish) before the button cluster to give the ink room.
3. **Button cluster** — `relative w-full max-w-xs`, contains:
   - The **ink layer**: `aria-hidden`, `pointer-events-none`, absolutely positioned above-left of the button. The handwritten "sign in here" is real DOM text in the marker face at `text-ink` (better than SVG text for font loading and scaling); the arrow is an inline `<svg viewBox="0 0 160 90" className="overflow-visible">` with a single wobbly cubic bezier plus two short arrowhead strokes, `stroke-ink strokeWidth={2}` with round caps and `vectorEffect="non-scaling-stroke"`. Follow the existing hand-rolled-SVG conventions in `src/components/performance/compensation-scatter.tsx`. Declare it as a local `SignInArrow()` function at the bottom of `page.tsx`, exactly mirroring how `google-sign-in-button.tsx` keeps `GoogleIcon` local — it isn't reused, so no new file.
   - `<GoogleSignInButton />` — **unchanged**, reused as-is from `src/components/auth/google-sign-in-button.tsx`.
   - Micro-interaction: `group-has-[button:hover]:translate-x-px group-has-[button:hover]:translate-y-px transition-transform` on the ink layer, with `group` on the cluster, so the arrow nudges toward the button on hover. First thing to cut if it feels fussy.
4. **Footer** — `absolute bottom-8`, centred, `text-xs text-muted-foreground`: `Any problems? Contact Andrew.`

**Entrance sequence** (all `animation-fill-mode: both`, via arbitrary utilities like `animate-[login-rise_500ms_ease-out_220ms_both]`, each element tagged `data-login-anim`):

| t | element |
|---|---|
| 100ms | logo mark — `login-pop` |
| 220ms | product name — `login-rise` |
| 340ms | button — `login-rise` |
| 600ms | arrow strokes on over ~700ms — `ink-draw` (`data-ink`) |
| 1150ms | handwritten note — `login-rise` |
| 1300ms | footer — `login-rise` |

**Accessibility.** The whole ink layer is `aria-hidden` — "sign in here" duplicates the button's own label, and a dangling phrase read aloud is noise. The logo already carries `alt="" aria-hidden`; `<h1>` supplies the accessible name. Button focus ring is untouched. Graphite-on-white for the note is decoration, not content.

### 3. Docs and rules — required, not optional

- `docs/ui.md:112` — rewrite the "Minimal auth surfaces" bullet to describe the annotated login, name the `--ink` token and the login-only keyframes, and state that the exception is scoped to `(auth)/login` while the in-app language is unchanged.
- `.claude/rules/ui.md:30` and `src/AGENTS.md:50` — replace the "deliberately minimal" line with matching wording. These two are a deliberate full duplication (per `AGENTS.md` → *Agent runtimes*); **both** must change or the runtimes drift.
- Dispatch the **`librarian`** subagent afterwards with a summary of the change so it reconciles `/docs` and writes a short ADR (next number after 0059) recording *why* login diverges from the flat/monochrome product chrome.

## Out of scope (flagging, not doing)

`src/components/auth/onboarding-notice.tsx` and `src/app/not-found.tsx` copy the old login layout (`LogoMark size 36`, `min-h-svh` centred column, `text-xl` title). After this change the profile-setup screen a new hire sees *immediately after* signing in will feel plainer than the login they just came from. Worth a follow-up pass to carry the dot grid and larger type across — say the word and I'll fold it in.

## Verification

1. `bun run dev`, open `/login` signed out. Confirm: dot grid vignettes out at the edges; the entrance runs in order and the arrow visibly draws; the arrow tip lands on the button; no `text-xs` "Lazer staff only" remains.
2. Toggle **Reduce motion** (macOS System Settings → Accessibility → Display). Reload: everything is present and static, arrow fully drawn, nothing invisible.
3. Resize to 375px wide. The ink layer must not overlap the `<h1>` or clip off-screen, and the page must not scroll horizontally. Also check a short viewport (~600px tall) — the absolute footer must not collide with the button.
4. Tab through: the Google button is the only stop and shows its focus ring. Check with VoiceOver that the annotation isn't announced.
5. Click through the real Google flow to confirm `GoogleSignInButton` still works and the loading state renders; then load `/login` while signed in and confirm the `redirect("/")` still fires.
6. `bun run check` (Biome + `tsc --noEmit` + tests) and `bun run build` — the build catches a bad `next/font` call, which is the likeliest failure here.
