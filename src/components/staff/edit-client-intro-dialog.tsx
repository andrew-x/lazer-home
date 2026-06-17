"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPencil } from "@tabler/icons-react";
import { useState } from "react";
import { updateStaffClientIntro } from "@/actions/staff/updateStaffClientIntro";
import { updateStaffClientIntroSchema } from "@/actions/staff/updateStaffClientIntro.schema";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function EditClientIntroDialog({
  staffId,
  clientIntro,
}: {
  staffId: string;
  clientIntro: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          <DialogTitle>Edit client intro</DialogTitle>
          <DialogDescription>
            How this person is introduced to clients. Leave blank to clear it.
          </DialogDescription>
        </DialogHeader>
        {/* Remounts each time the dialog opens, so defaults track the latest data. */}
        {open ? (
          <ClientIntroForm
            staffId={staffId}
            clientIntro={clientIntro}
            onSaved={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ClientIntroForm({
  staffId,
  clientIntro,
  onSaved,
}: {
  staffId: string;
  clientIntro: string | null;
  onSaved: () => void;
}) {
  const { form, action, handleSubmitWithAction } = useHookFormAction(
    updateStaffClientIntro,
    zodResolver(updateStaffClientIntroSchema),
    {
      actionProps: { onSuccess: () => onSaved() },
      formProps: { defaultValues: { staffId, clientIntro: clientIntro ?? "" } },
    },
  );

  const {
    register,
    formState: { errors },
  } = form;

  return (
    <form onSubmit={handleSubmitWithAction} className="flex flex-col gap-4">
      <input type="hidden" {...register("staffId")} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="clientIntro">Client intro</Label>
        <Textarea
          id="clientIntro"
          rows={12}
          className="min-h-64"
          placeholder="A few paragraphs introducing this person to clients — background, focus areas, and what they bring to an engagement…"
          aria-invalid={Boolean(errors.clientIntro)}
          {...register("clientIntro")}
        />
        {errors.clientIntro ? (
          <p className="text-sm text-destructive">
            {errors.clientIntro.message}
          </p>
        ) : null}
      </div>

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
