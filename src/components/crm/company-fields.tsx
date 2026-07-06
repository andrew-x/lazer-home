"use client";

import type { UseFormRegisterReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type CompanyFieldValues = {
  name: string;
  websiteUrl: string;
  isPartner: boolean;
};

/**
 * The company form fields (name, optional website, partner flag). Shared between
 * the standalone Add-company dialog and the inline create-company flow on the
 * contact form, so both stay identical.
 *
 * Text inputs are wired through react-hook-form's `register` (Base UI's `Input`
 * is uncontrolled here — its controlled API is `onValueChange`, not the native
 * `onChange`). The Switch is controlled via `isPartner` / `onPartnerChange`.
 * `idPrefix` keeps element ids unique when more than one instance is mounted.
 */
export function CompanyFields({
  idPrefix,
  nameField,
  websiteField,
  isPartner,
  onPartnerChange,
  errors,
}: {
  idPrefix: string;
  nameField: UseFormRegisterReturn;
  websiteField: UseFormRegisterReturn;
  isPartner: boolean;
  onPartnerChange: (value: boolean) => void;
  errors?: { name?: string; websiteUrl?: string };
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input
          id={`${idPrefix}-name`}
          placeholder="Acme Inc."
          aria-invalid={Boolean(errors?.name)}
          {...nameField}
        />
        {errors?.name ? (
          <p className="text-sm text-destructive">{errors.name}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-website`}>Website (optional)</Label>
        <Input
          id={`${idPrefix}-website`}
          inputMode="url"
          placeholder="acme.com"
          aria-invalid={Boolean(errors?.websiteUrl)}
          {...websiteField}
        />
        {errors?.websiteUrl ? (
          <p className="text-sm text-destructive">{errors.websiteUrl}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={`${idPrefix}-partner`}>Partner</Label>
        <Switch
          id={`${idPrefix}-partner`}
          checked={isPartner}
          onCheckedChange={onPartnerChange}
        />
      </div>
    </>
  );
}
