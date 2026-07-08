"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPencil } from "@tabler/icons-react";
import { updateStaffLinks } from "@/actions/staff/updateStaffLinks";
import { updateStaffLinksSchema } from "@/actions/staff/updateStaffLinks.schema";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Links = {
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
};

const FIELDS = [
  {
    name: "linkedinUrl",
    label: "LinkedIn",
    placeholder: "https://linkedin.com/in/…",
  },
  { name: "githubUrl", label: "GitHub", placeholder: "https://github.com/…" },
  { name: "portfolioUrl", label: "Portfolio", placeholder: "https://…" },
] as const;

export function EditLinksDialog({
  staffId,
  links,
}: {
  staffId: string;
  links: Links;
}) {
  return (
    <FormDialog
      trigger={
        <Button variant="ghost" size="sm">
          <IconPencil />
          Edit
        </Button>
      }
      title="Edit links"
      description="Professional profiles. Leave a field blank to clear it."
    >
      {({ close }) => (
        <LinksForm staffId={staffId} links={links} onSaved={close} />
      )}
    </FormDialog>
  );
}

function LinksForm({
  staffId,
  links,
  onSaved,
}: {
  staffId: string;
  links: Links;
  onSaved: () => void;
}) {
  const { form, action, handleSubmitWithAction } = useHookFormAction(
    updateStaffLinks,
    zodResolver(updateStaffLinksSchema),
    {
      actionProps: { onSuccess: () => onSaved() },
      formProps: {
        defaultValues: {
          staffId,
          linkedinUrl: links.linkedinUrl ?? "",
          githubUrl: links.githubUrl ?? "",
          portfolioUrl: links.portfolioUrl ?? "",
        },
      },
    },
  );

  const {
    register,
    formState: { errors },
  } = form;

  return (
    <form onSubmit={handleSubmitWithAction} className="flex flex-col gap-4">
      <input type="hidden" {...register("staffId")} />
      {FIELDS.map((field) => (
        <FormField
          key={field.name}
          label={field.label}
          htmlFor={field.name}
          error={errors[field.name]?.message}
        >
          <Input
            id={field.name}
            type="url"
            placeholder={field.placeholder}
            aria-invalid={Boolean(errors[field.name])}
            {...register(field.name)}
          />
        </FormField>
      ))}

      <FormDialogFooter
        serverError={action.result.serverError}
        submitLabel="Save"
        loading={action.isPending}
      />
    </form>
  );
}
