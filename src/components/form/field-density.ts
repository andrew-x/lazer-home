/**
 * Tighter geometry for label/value rows in a **meta rail** — the narrow sidebar of
 * facts that sits beside a detail page's main column. The rail stacks a dozen
 * short rows in ~320px, where `FormField`'s page-form rhythm (a `gap-1.5` label
 * gap and a `min-h-8 py-1` value box, sized for real inputs) reads as air rather
 * than structure.
 *
 * The overrides live at the call site — one class on the rail container — rather
 * than as a `variant` prop threaded through `FormField`, `InlineEditField` and
 * every read-only row: rail density is a property of *where* a field is rendered,
 * and pushing it into the app's most-used form primitive would put a
 * sidebar-only concern in everyone's path. Same reasoning (and shape) as
 * `ROOMY_TABLE` in `src/components/table-density.ts`.
 *
 * Both rules are descendant selectors on the container, so they land at
 * specificity (0,2,0) and beat the plain `gap-1.5` / `min-h-8` utilities (0,1,0)
 * on the rows themselves. A row that needs to opt *out* therefore needs
 * matching-or-higher specificity, not just a class of its own.
 *
 * Applies to anything emitting `data-slot="form-field"` (`FormField`, so also
 * `InlineEditField`) or `data-slot="field-value"` (a read-mode value box —
 * `InlineEditField`'s display, `MetaField`'s value).
 */
export const COMPACT_META_FIELDS =
  "[&_[data-slot=field-value]]:min-h-7 [&_[data-slot=field-value]]:py-0.5 [&_[data-slot=form-field]]:gap-1";
