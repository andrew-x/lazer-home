"use client";

import type { Control, FieldErrors, UseFormRegister } from "react-hook-form";
import { Controller, useWatch } from "react-hook-form";
import { searchStaff } from "@/actions/projects/searchStaff";
import type { IssueTarget } from "@/components/form/apply-server-issues";
import { EntityCombobox } from "@/components/form/entity-combobox";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { EnumSelect } from "@/components/form/enum-select";
import { FormField } from "@/components/form/form-field";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  LINE_OF_BUSINESS,
  LINE_OF_BUSINESS_LABELS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import { BILL_RATE_CURRENCY, billRateFor } from "@/lib/projects/bill-rates";
import {
  PROJECT_ROLE_TYPE_LABELS,
  PROJECT_ROLE_TYPES,
  type ProjectRoleType,
} from "@/lib/projects/project-role-type";

/**
 * The form shape behind every role editor. Hours and the bill rate stay strings
 * (coerced by the schema).
 */
export type RoleFormValues = {
  staff: EntityOption | null;
  lineOfBusiness: LineOfBusiness | "";
  description: string;
  roleType: ProjectRoleType | "";
  startDate: string | null;
  endDate: string | null;
  hoursPerDay: string;
  billRate: string;
};

/**
 * Maps each role schema field to its form field (note `staffId` → `staff`); the
 * server-controlled `id`/`projectId`/`opportunityId` never surface as form errors.
 */
export const ROLE_ISSUE_FIELDS: Record<string, IssueTarget<RoleFormValues>> = {
  staffId: "staff",
  lineOfBusiness: "lineOfBusiness",
  description: "description",
  roleType: "roleType",
  startDate: "startDate",
  endDate: "endDate",
  hoursPerDay: "hoursPerDay",
  billRate: "billRate",
};

/**
 * The editable fields of a project role: line of business, role type, description,
 * assignee, dates and daily hours. Shared by the opportunity planner's role dialog
 * and the project detail page's role dialog so the two can't drift — the mirror of
 * `projectRoleFields`, which already shares the validation rules server-side.
 *
 * `status` is deliberately absent: a role's status is system-driven (tentative until
 * its opportunity is won), never picked in a form.
 *
 * `idPrefix` keeps element ids unique if more than one instance is ever mounted.
 */
export function RoleFields({
  idPrefix,
  control,
  register,
  errors,
}: {
  idPrefix: string;
  control: Control<RoleFormValues>;
  register: UseFormRegister<RoleFormValues>;
  errors: FieldErrors<RoleFormValues>;
}) {
  return (
    <>
      <div className="flex gap-3">
        <FormField
          label="Line of business"
          error={errors.lineOfBusiness?.message}
          className="flex-1 min-w-0"
        >
          <Controller
            control={control}
            name="lineOfBusiness"
            render={({ field, fieldState }) => (
              <EnumSelect
                options={LINE_OF_BUSINESS}
                labels={LINE_OF_BUSINESS_LABELS}
                placeholder="Select a line of business"
                value={field.value}
                invalid={Boolean(fieldState.error)}
                onValueChange={field.onChange}
              />
            )}
          />
        </FormField>
        <FormField
          label="Role type"
          error={errors.roleType?.message}
          className="flex-1 min-w-0"
        >
          <Controller
            control={control}
            name="roleType"
            render={({ field, fieldState }) => (
              <EnumSelect
                options={PROJECT_ROLE_TYPES}
                labels={PROJECT_ROLE_TYPE_LABELS}
                placeholder="Select a role type"
                value={field.value}
                invalid={Boolean(fieldState.error)}
                onValueChange={field.onChange}
              />
            )}
          />
        </FormField>
      </div>

      <FormField
        label="Description (optional)"
        htmlFor={`${idPrefix}-description`}
        error={errors.description?.message}
      >
        <Input
          id={`${idPrefix}-description`}
          placeholder="Senior Backend Engineer"
          aria-invalid={Boolean(errors.description)}
          {...register("description")}
        />
      </FormField>

      <FormField label="Staff (optional)" error={errors.staff?.message}>
        <Controller
          control={control}
          name="staff"
          render={({ field, fieldState }) => (
            <EntityCombobox
              value={field.value}
              onChange={field.onChange}
              searchAction={searchStaff}
              placeholder="Search staff…"
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
          htmlFor={`${idPrefix}-hours`}
          error={errors.hoursPerDay?.message}
          className="flex-1 min-w-0"
        >
          <Input
            id={`${idPrefix}-hours`}
            type="number"
            step="0.5"
            min="0"
            max="24"
            aria-invalid={Boolean(errors.hoursPerDay)}
            {...register("hoursPerDay")}
          />
        </FormField>
      </div>

      <BillRateField
        idPrefix={idPrefix}
        control={control}
        register={register}
        errors={errors}
      />
    </>
  );
}

/**
 * The role's hourly bill rate, with the current rate card as its **placeholder** rather
 * than as a pre-filled value.
 *
 * That's the whole interaction: an empty field shows exactly what the role will bill at,
 * and submitting it blank snapshots that figure (`snapshotBillRate` server-side). So
 * "leave it alone" and "reset a role that's stuck on a superseded price" are the same
 * gesture, and there's no dirty-tracking needed to stop a typed rate being clobbered
 * when the discipline changes.
 *
 * The currency is named in the label because there is no per-role currency column — every
 * rate is in `BILL_RATE_CURRENCY`, and the budget panel converts for display.
 */
function BillRateField({
  idPrefix,
  control,
  register,
  errors,
}: {
  idPrefix: string;
  control: Control<RoleFormValues>;
  register: UseFormRegister<RoleFormValues>;
  errors: FieldErrors<RoleFormValues>;
}) {
  const [lineOfBusiness, roleType] = useWatch({
    control,
    name: ["lineOfBusiness", "roleType"],
  });
  // Both are required elsewhere in this form, so before they're picked there is no card
  // cell to quote — fall back to the plain default rather than guessing a line.
  const cardRate =
    lineOfBusiness && roleType
      ? billRateFor({ lineOfBusiness, roleType })
      : null;

  return (
    <FormField
      label={`Bill rate (${BILL_RATE_CURRENCY}/hr)`}
      htmlFor={`${idPrefix}-bill-rate`}
      error={errors.billRate?.message}
    >
      <Input
        id={`${idPrefix}-bill-rate`}
        type="number"
        inputMode="decimal"
        step="5"
        min="0"
        className="tabular-nums"
        placeholder={cardRate === null ? undefined : String(cardRate)}
        aria-invalid={Boolean(errors.billRate)}
        {...register("billRate")}
      />
      <p className="text-xs text-muted-foreground">
        Leave blank to use the standard rate card.
      </p>
    </FormField>
  );
}

/**
 * Default form values for a role editor: the existing role's values, or a blank row
 * defaulting to `defaultLineOfBusiness` and a full 8-hour day.
 */
export function roleDefaultValues(
  existing: {
    staffId: string | null;
    staffName: string | null;
    lineOfBusiness: LineOfBusiness;
    description: string | null;
    roleType: ProjectRoleType;
    startDate: string;
    endDate: string;
    hoursPerDay: number;
    billRate: number;
  } | null,
  defaultLineOfBusiness: LineOfBusiness | "",
): RoleFormValues {
  return {
    staff:
      existing?.staffId && existing.staffName
        ? { id: existing.staffId, name: existing.staffName }
        : null,
    lineOfBusiness: existing?.lineOfBusiness ?? defaultLineOfBusiness,
    description: existing?.description ?? "",
    roleType: existing?.roleType ?? "",
    startDate: existing?.startDate ?? null,
    endDate: existing?.endDate ?? null,
    hoursPerDay: existing ? String(existing.hoursPerDay) : "8",
    // A new role opens blank so its placeholder previews the card rate it will
    // snapshot; an existing role shows the rate it actually carries, which may be off
    // the current card.
    billRate: existing ? String(existing.billRate) : "",
  };
}
