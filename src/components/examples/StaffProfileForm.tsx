"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { useEffect } from "react";
import { updateStaffProfile } from "@/actions/staff/updateStaffProfile";
import { updateStaffProfileSchema } from "@/actions/staff/updateStaffProfile.schema";
import { cn } from "@/lib/utils";

/**
 * Example "tight binding" form: useHookFormAction wires react-hook-form and the
 * safe action together. Submitting runs Zod validation, then the action.
 * Errors surface via `action.result.serverError` (the string handleServerError chose).
 */
export function StaffProfileForm({
  id,
  defaultValues,
}: {
  id: string;
  defaultValues?: { title?: string | null; bio?: string | null };
}) {
  const { form, action, handleSubmitWithAction } = useHookFormAction(
    updateStaffProfile,
    zodResolver(updateStaffProfileSchema),
    {
      formProps: {
        defaultValues: {
          id,
          title: defaultValues?.title ?? "",
          bio: defaultValues?.bio ?? "",
        },
      },
    },
  );

  const {
    register,
    formState: { errors },
  } = form;

  // Reset the form after a successful submit (done here, not in the hook's own
  // args, to avoid circular type inference on `form`).
  useEffect(() => {
    if (action.hasSucceeded) form.reset();
  }, [action.hasSucceeded, form]);

  return (
    <form
      onSubmit={handleSubmitWithAction}
      className="flex max-w-md flex-col gap-3"
    >
      <input type="hidden" {...register("id")} />

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Title</span>
        <input {...register("title")} className="rounded border px-2 py-1" />
        {errors.title && (
          <span className="text-sm text-red-600">{errors.title.message}</span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Bio</span>
        <textarea
          {...register("bio")}
          className="rounded border px-2 py-1"
          rows={4}
        />
        {errors.bio && (
          <span className="text-sm text-red-600">{errors.bio.message}</span>
        )}
      </label>

      <button
        type="submit"
        disabled={action.isPending}
        className={cn(
          "rounded bg-black px-3 py-1.5 text-sm font-medium text-white",
          action.isPending && "opacity-50",
        )}
      >
        {action.isPending ? "Saving…" : "Save"}
      </button>

      {action.result.serverError && (
        <p className="text-sm text-red-600">{action.result.serverError}</p>
      )}
    </form>
  );
}
