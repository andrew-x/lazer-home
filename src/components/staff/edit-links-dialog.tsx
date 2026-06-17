"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPencil } from "@tabler/icons-react";
import { useState } from "react";
import { updateStaffLinks } from "@/actions/staff/updateStaffLinks";
import { updateStaffLinksSchema } from "@/actions/staff/updateStaffLinks.schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const [open, setOpen] = useState(false);
  // Bump on each open so the form remounts with fresh defaults. Unlike gating
  // on `open`, this keeps the form mounted through the close animation so the
  // popup doesn't collapse to its header before fading out.
  const [formKey, setFormKey] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setFormKey((k) => k + 1);
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <IconPencil />
            Edit
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit links</DialogTitle>
          <DialogDescription>
            Professional profiles. Leave a field blank to clear it.
          </DialogDescription>
        </DialogHeader>
        <LinksForm
          key={formKey}
          staffId={staffId}
          links={links}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
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
        <div key={field.name} className="flex flex-col gap-1.5">
          <Label htmlFor={field.name}>{field.label}</Label>
          <Input
            id={field.name}
            type="url"
            placeholder={field.placeholder}
            aria-invalid={Boolean(errors[field.name])}
            {...register(field.name)}
          />
          {errors[field.name] ? (
            <p className="text-sm text-destructive">
              {errors[field.name]?.message}
            </p>
          ) : null}
        </div>
      ))}

      {action.result.serverError ? (
        <p className="text-sm text-destructive">{action.result.serverError}</p>
      ) : null}

      <DialogFooter>
        <DialogClose
          render={
            <Button type="button" variant="outline">
              Cancel
            </Button>
          }
        />
        <Button type="submit" loading={action.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
