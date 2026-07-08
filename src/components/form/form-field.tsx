"use client";

import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * A labelled form field: a `Label`, the control (children), and — when present —
 * the destructive validation message. Replaces the open-coded
 * `<div className="flex flex-col gap-1.5"><Label/>…<p className="text-sm
 * text-destructive"/></div>` block repeated across the CRM/staff forms.
 *
 * Wire `aria-invalid` on the control itself (the documented pattern), e.g.
 * `<Input aria-invalid={Boolean(error)} … />`, so it works uniformly for
 * `Input`, `Textarea`, `Select`, comboboxes, etc. `htmlFor` is optional — omit
 * it for controls without a focusable native input (Select, combobox).
 */
export function FormField({
  label,
  htmlFor,
  error,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
