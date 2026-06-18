"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPencil, IconUpload } from "@tabler/icons-react";
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit resume</DialogTitle>
          <DialogDescription>
            Type your resume or upload a PDF to extract its text. Review the
            text before saving. Leave blank to clear it.
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

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="resume">Resume</Label>
        <input
          ref={fileInputRef}
          id={fileInputId}
          type="file"
          accept="application/pdf"
          hidden
          onChange={onFileChange}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={parse.isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          <IconUpload />
          Upload PDF
        </Button>
      </div>

      <Textarea
        id="resume"
        rows={16}
        className="min-h-80"
        placeholder="Paste or type your resume here, or upload a PDF to extract its text…"
        aria-invalid={Boolean(errors.resume)}
        {...register("resume")}
      />
      {errors.resume ? (
        <p className="text-sm text-destructive">{errors.resume.message}</p>
      ) : null}
      {uploadError ? (
        <p className="text-sm text-destructive">{uploadError}</p>
      ) : null}

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
