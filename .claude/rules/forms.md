---
paths:
  - "src/components/**"
  - "src/hooks/**"
---

# Forms (react-hook-form + next-safe-action)

Client forms use react-hook-form + Zod and bind to server actions in two deliberate ways. Pick by how closely the form shape matches the action input.

- **(a) Tight binding — `useHookFormAction`** (`@next-safe-action/adapter-react-hook-form/hooks`). One hook wires form + action; gives `handleSubmitWithAction` and `form`. Use when the form shape == the action input. See `src/components/staff/edit-links-dialog.tsx` (the form is gated on dialog `open` so it remounts with fresh defaults each time, and closes via the action's `onSuccess`).
- **(b) Loose binding — `useForm` + `useAction`.** Keep a manual `onSubmit` that transforms data, then `execute(...)`. Use when the form shape ≠ action input (e.g. `useFieldArray` produces `{ value }[]` but the action wants `string[]`).

## Always

- Drive button loading state from `isPending` / `isExecuting`.
- Read server errors off **`action.result.serverError`** (or `error.serverError` in `onError`) — that's the string `handleServerError` chose to surface.
- Confirm success by the flow's own signal: dialog/navigation flows close or redirect; in-place actions use `toast.success`.
- Use `cn()` from `@/lib/utils` for conditional class names.
