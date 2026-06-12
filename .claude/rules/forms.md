---
paths:
  - "src/components/**"
  - "src/hooks/**"
---

# Forms (react-hook-form + next-safe-action)

Client forms use react-hook-form + Zod and bind to server actions in three deliberate ways. Pick by how closely the form shape matches the action input.

- **(a) Tight binding — `useHookFormAction`** (`@next-safe-action/adapter-react-hook-form/hooks`). One hook wires form + action; gives `handleSubmitWithAction` and `form`. Use when the form shape == the action input. See `src/components/examples/StaffProfileForm.tsx`.
- **(b) Loose binding — `useForm` + `useAction`.** Keep a manual `onSubmit` that transforms data, then `execute(...)`. Use when the form shape ≠ action input (e.g. `useFieldArray` produces `{ value }[]` but the action wants `string[]`).
- **(c) `useZodForm` + `useAction`** (`src/hooks/useZodForm.tsx`). Thin `useForm` wrapper that auto-applies `zodResolver`. Use for richer forms, e.g. one form driving create-vs-update branches.

## Always

- Drive button loading state from `isPending` / `isExecuting`.
- Read server errors off **`action.result.serverError`** (or `error.serverError` in `onError`) — that's the string `handleServerError` chose to surface.
- Use `cn()` from `@/lib/utils` for conditional class names.
