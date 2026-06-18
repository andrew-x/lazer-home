"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconFileUpload, IconPencil } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useId, useRef, useState } from "react";
import { parseResumePdf } from "@/actions/staff/parseResumePdf";
import { updateStaffResume } from "@/actions/staff/updateStaffResume";
import { updateStaffResumeSchema } from "@/actions/staff/updateStaffResume.schema";
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

// Client-side guard so we never POST a payload over the server-action body
// limit (8mb of base64 ≈ ~6 MB raw). Matches the server-side backstop.
const MAX_PDF_BYTES = 6 * 1024 * 1024;

/** Read a File's bytes as base64 (no `data:` prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // result is a data URL: "data:application/pdf;base64,XXXX"
      const result = reader.result as string;
      resolve(result.split(",", 2)[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function EditResumeDialog({
  staffId,
  resume,
}: {
  staffId: string;
  resume: string | null;
}) {
  const [open, setOpen] = useState(false);
  // Bump on each open so the form remounts with fresh defaults (matches
  // edit-client-intro-dialog.tsx — keeps the form mounted through the close
  // animation).
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit resume</DialogTitle>
          <DialogDescription>
            Upload a PDF to pull its text in automatically, or write your resume
            directly below. Review before saving; leave blank to clear it.
          </DialogDescription>
        </DialogHeader>
        <ResumeForm
          key={formKey}
          staffId={staffId}
          resume={resume}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ResumeForm({
  staffId,
  resume,
  onSaved,
}: {
  staffId: string;
  resume: string | null;
  onSaved: () => void;
}) {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { form, action, handleSubmitWithAction } = useHookFormAction(
    updateStaffResume,
    zodResolver(updateStaffResumeSchema),
    {
      actionProps: { onSuccess: () => onSaved() },
      formProps: { defaultValues: { staffId, resume: resume ?? "" } },
    },
  );

  const {
    register,
    setValue,
    formState: { errors },
  } = form;

  const parse = useAction(parseResumePdf, {
    onSuccess: ({ data }) => {
      if (data?.text) {
        setValue("resume", data.text, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    },
    onError: ({ error }) => {
      setUploadError(error.serverError ?? "Couldn't read that PDF.");
    },
  });

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    setUploadError(null);
    const file = event.target.files?.[0];
    // Reset the input so selecting the same file again re-fires change.
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_PDF_BYTES) {
      setUploadError("That PDF is too large. Keep it under ~6 MB.");
      return;
    }
    const fileBase64 = await fileToBase64(file);
    parse.execute({ fileBase64 });
  }

  return (
    <form onSubmit={handleSubmitWithAction} className="flex flex-col gap-4">
      <input type="hidden" {...register("staffId")} />
      <input
        ref={fileInputRef}
        id={fileInputId}
        type="file"
        accept="application/pdf"
        hidden
        onChange={onFileChange}
      />

      {/* Recommended path, emphasized as the first step — most people upload. */}
      <div className="flex flex-col items-center gap-3 border bg-muted/30 p-6 text-center">
        <IconFileUpload className="size-7 text-muted-foreground" />
        <div className="flex flex-col gap-0.5">
          <p className="font-medium">Upload your resume</p>
          <p className="text-sm text-muted-foreground">
            Drop in a PDF and we'll pull the text out for you to review.
          </p>
        </div>
        <Button
          type="button"
          loading={parse.isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          <IconFileUpload />
          Choose PDF
        </Button>
        {uploadError ? (
          <p className="text-sm text-destructive">{uploadError}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        or write it yourself
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="resume">Resume text</Label>
        <Textarea
          id="resume"
          rows={18}
          className="min-h-96"
          placeholder="Paste or type your resume here…"
          aria-invalid={Boolean(errors.resume)}
          {...register("resume")}
        />
        {errors.resume ? (
          <p className="text-sm text-destructive">{errors.resume.message}</p>
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
