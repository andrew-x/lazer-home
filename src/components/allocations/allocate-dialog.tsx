"use client";

import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { allocateStaffToRole } from "@/actions/allocations/allocateStaffToRole";
import { allocateStaffToRoleSchema } from "@/actions/allocations/allocateStaffToRole.schema";
import {
  searchUnallocatedRoles,
  type UnallocatedRoleOption,
} from "@/actions/allocations/searchUnallocatedRoles";
import {
  applyServerIssues,
  type IssueTarget,
} from "@/components/form/apply-server-issues";
import { searchEmptyMessage } from "@/components/form/combobox-empty-message";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { formatShortDate, parseIsoDate } from "@/lib/format/format";
import { PROJECT_ROLE_TYPE_LABELS } from "@/lib/projects/project-role-type";

type AllocateFormValues = {
  role: UnallocatedRoleOption | null;
  startDate: string | null;
  endDate: string | null;
  hoursPerDay: string;
};

// Maps each schema field to its form field (`roleId` → `role`); `staffId` is
// fixed for the dialog, so it never surfaces as a form error.
const ALLOCATE_ISSUE_FIELDS: Record<string, IssueTarget<AllocateFormValues>> = {
  roleId: "role",
  startDate: "startDate",
  endDate: "endDate",
  hoursPerDay: "hoursPerDay",
};

/** "Acme Redesign — Senior Backend Engineer" (falls back to the role type). */
function roleLabel(role: UnallocatedRoleOption): string {
  const what = role.description ?? PROJECT_ROLE_TYPE_LABELS[role.roleType];
  return `${role.projectName} — ${what}`;
}

/** "Senior Backend Engineer · Core · Aug 1 – Oct 31, 2026 · 8h/day". */
function roleSublabel(role: UnallocatedRoleOption): string {
  const what = role.description ?? PROJECT_ROLE_TYPE_LABELS[role.roleType];
  const range = `${formatShortDate(parseIsoDate(role.startDate))} – ${formatShortDate(parseIsoDate(role.endDate))}`;
  return `${what} · ${LINE_OF_BUSINESS_LABELS[role.lineOfBusiness]} · ${range} · ${role.hoursPerDay}h/day`;
}

/**
 * Debounced type-ahead over open (unallocated) roles, built on the same Base UI
 * Combobox as `EntityCombobox` but holding a rich {@link UnallocatedRoleOption}
 * so selecting a role can prefill the date range + hours/day.
 */
function RolePicker({
  value,
  onChange,
  invalid,
}: {
  value: UnallocatedRoleOption | null;
  onChange: (next: UnallocatedRoleOption | null) => void;
  invalid?: boolean;
}) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const { execute, reset, result, isPending } = useAction(
    searchUnallocatedRoles,
  );

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (trimmed === "") {
      reset();
      return;
    }
    execute({ query: trimmed });
  }, [debouncedQuery, execute, reset]);

  // Keep the selected role visible even when it's absent from the current
  // results; ignore results while the query is empty so a cleared field doesn't
  // repopulate from an in-flight request (mirrors `EntityCombobox`).
  const items = useMemo(() => {
    const results = query.trim() === "" ? [] : (result.data ?? []);
    if (!value || results.some((r) => r.id === value.id)) return results;
    return [value, ...results];
  }, [query, result.data, value]);

  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={(next: UnallocatedRoleOption | null) => onChange(next)}
      isItemEqualToValue={(
        item: UnallocatedRoleOption,
        val: UnallocatedRoleOption,
      ) => item.id === val.id}
      itemToStringLabel={(item: UnallocatedRoleOption) => roleLabel(item)}
      filter={null}
      onInputValueChange={(next, { reason }) => {
        if (reason === "item-press") return;
        setQuery(next);
      }}
    >
      <ComboboxInput
        className="w-full"
        placeholder="Search open roles…"
        showClear={Boolean(value)}
        aria-invalid={invalid || undefined}
      />
      <ComboboxContent>
        <ComboboxEmpty>
          {searchEmptyMessage({
            query,
            isPending,
            serverError: result.serverError,
          })}
        </ComboboxEmpty>
        <ComboboxList>
          {(item: UnallocatedRoleOption) => (
            <ComboboxItem key={item.id} value={item}>
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{item.projectName}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {roleSublabel(item)}
                </span>
              </div>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/**
 * Allocate a staff member to an open project role, from a staff row in the
 * allocations planner. Search unallocated roles, then adjust the date range and
 * hours/day (prefilled from the picked role) before saving. State-driven open —
 * the parent renders this only for the targeted staff member.
 */
export function AllocateDialog({
  staffId,
  staffName,
  onClose,
  onSaved,
}: {
  staffId: string;
  staffName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const {
    control,
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<AllocateFormValues>({
    defaultValues: {
      role: null,
      startDate: null,
      endDate: null,
      hoursPerDay: "8",
    },
  });

  const allocate = useAction(allocateStaffToRole, { onSuccess: onSaved });

  const onSubmit = (values: AllocateFormValues) => {
    const parsed = allocateStaffToRoleSchema.safeParse({
      roleId: values.role?.id ?? "",
      staffId,
      startDate: values.startDate ?? "",
      endDate: values.endDate ?? "",
      hoursPerDay: values.hoursPerDay,
    });
    if (!parsed.success) {
      applyServerIssues(setError, parsed.error, ALLOCATE_ISSUE_FIELDS);
      return;
    }
    allocate.execute(parsed.data);
  };

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      forceMountOverlay
      title={`Allocate ${staffName}`}
      description="Find an open role, then set the dates and hours before saving."
      contentClassName="max-h-[85vh] overflow-y-auto sm:max-w-lg"
    >
      {() => (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormField label="Open role" error={errors.role?.message}>
            <Controller
              control={control}
              name="role"
              render={({ field, fieldState }) => (
                <RolePicker
                  value={field.value}
                  onChange={(next) => {
                    field.onChange(next);
                    // Prefill the adjustable fields from the picked role.
                    if (next) {
                      setValue("startDate", next.startDate);
                      setValue("endDate", next.endDate);
                      setValue("hoursPerDay", String(next.hoursPerDay));
                    }
                  }}
                  invalid={Boolean(fieldState.error)}
                />
              )}
            />
          </FormField>

          <div className="flex gap-3">
            <FormField
              label="Start date"
              error={errors.startDate?.message}
              className="flex-1 min-w-0"
            >
              <Controller
                control={control}
                name="startDate"
                render={({ field }) => (
                  <DatePicker
                    value={field.value}
                    onChange={field.onChange}
                    className="w-full"
                  />
                )}
              />
            </FormField>
            <FormField
              label="End date"
              error={errors.endDate?.message}
              className="flex-1 min-w-0"
            >
              <Controller
                control={control}
                name="endDate"
                render={({ field }) => (
                  <DatePicker
                    value={field.value}
                    onChange={field.onChange}
                    className="w-full"
                  />
                )}
              />
            </FormField>
            <FormField
              label="Hours / day"
              htmlFor="allocate-hours"
              error={errors.hoursPerDay?.message}
              className="flex-1 min-w-0"
            >
              <Input
                id="allocate-hours"
                type="number"
                step="0.5"
                min="0"
                max="24"
                aria-invalid={Boolean(errors.hoursPerDay)}
                {...register("hoursPerDay")}
              />
            </FormField>
          </div>

          <FormDialogFooter
            serverError={allocate.result.serverError}
            submitLabel="Allocate"
            loading={allocate.isPending}
          />
        </form>
      )}
    </FormDialog>
  );
}
