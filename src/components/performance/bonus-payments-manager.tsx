"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { usePathname, useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { Controller } from "react-hook-form";
import {
  createBonusPaymentSchema,
  updateBonusPaymentSchema,
} from "@/actions/staff/bonusPayment.schema";
import { createBonusPayment } from "@/actions/staff/createBonusPayment";
import { deleteBonusPayment } from "@/actions/staff/deleteBonusPayment";
import type {
  BonusPaymentRow,
  BonusStaffOption,
} from "@/actions/staff/getBonusPayments";
import { updateBonusPayment } from "@/actions/staff/updateBonusPayment";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EnumSelect } from "@/components/form/enum-select";
import { FilterLabel } from "@/components/form/filters";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CURRENCY, CURRENCY_LABELS, formatMoney } from "@/lib/format/currency";
import { formatDate } from "@/lib/format/format";
import {
  BONUS_MANAGER_YEAR_PARAM,
  BONUS_TYPE_DESCRIPTIONS,
  BONUS_TYPE_LABELS,
  BONUS_TYPES,
} from "@/lib/staff/staff-bonus";

/**
 * The **bonus payments** entry screen (`/performance/compensation/bonuses`):
 * record, correct and remove the one-off bonuses that feed the compensation
 * dashboard's breakdown.
 *
 * This is a stopgap by design. Bonuses will arrive from Rippling like comp and
 * PTO do, keyed on `staffBonusPayment.ripplingId`; until that importer exists
 * there has to be some way to get real payments into the system, and a hand-entry
 * screen beats a seed script. Rows entered here leave `ripplingId` null, so the
 * future importer can adopt the table without colliding with them.
 *
 * Gated by `staff.edit` + `staff.viewCompensation` at the page, the read and all
 * three actions.
 */
export function BonusPaymentsManager({
  payments,
  staffOptions,
  years,
  year,
}: {
  payments: BonusPaymentRow[];
  staffOptions: BonusStaffOption[];
  years: number[];
  year: number;
}) {
  const [editing, setEditing] = useState<BonusPaymentRow | null>(null);
  const [deleting, setDeleting] = useState<BonusPaymentRow | null>(null);
  const remove = useAction(deleteBonusPayment, {
    onSuccess: () => setDeleting(null),
  });

  const total = payments.reduce<Record<string, number>>((acc, p) => {
    acc[p.currency] = (acc[p.currency] ?? 0) + p.amount;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <YearPicker years={years} year={year} />
        <FormDialog
          trigger={
            <Button size="sm">
              <IconPlus />
              Record payment
            </Button>
          }
          title="Record a bonus payment"
          description="A payment that has already been made. Amounts for a gift are its cash-equivalent value."
        >
          {({ close }) => (
            <CreateForm staffOptions={staffOptions} onSaved={close} />
          )}
        </FormDialog>
      </div>

      {/* Per-currency, never summed: this screen does no FX, so one figure across
          CAD and USD would be invented. */}
      {Object.keys(total).length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {year} total:{" "}
          {Object.entries(total)
            .map(([currency, amount]) =>
              formatMoney(amount, currency as (typeof CURRENCY)[number]),
            )
            .join(" · ")}
        </p>
      ) : null}

      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No bonus payments recorded for {year}.
        </p>
      ) : (
        <div className="rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(payment.paymentDate)}
                  </TableCell>
                  <TableCell className="font-medium">
                    {payment.staffName}
                  </TableCell>
                  <TableCell>{BONUS_TYPE_LABELS[payment.type]}</TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">
                    {formatMoney(payment.amount, payment.currency)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {payment.notes ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <IconButton
                        label={`Edit ${payment.staffName}'s bonus`}
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(payment)}
                      >
                        <IconPencil />
                      </IconButton>
                      <IconButton
                        label={`Delete ${payment.staffName}'s bonus`}
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting(payment)}
                      >
                        <IconTrash />
                      </IconButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Keyed on the row id so switching rows remounts with fresh defaults. */}
      {editing ? (
        <FormDialog
          key={editing.id}
          open
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
          title={`Edit ${editing.staffName}'s bonus`}
          description="Correct the details of a recorded payment. To move it to a different person, delete it and record it again."
        >
          {({ close }) => (
            <EditForm
              payment={editing}
              onSaved={() => {
                close();
                setEditing(null);
              }}
            />
          )}
        </FormDialog>
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title="Delete this bonus payment?"
        description={
          deleting
            ? `${formatMoney(deleting.amount, deleting.currency)} paid to ${
                deleting.staffName
              } on ${formatDate(
                deleting.paymentDate,
              )}. This removes it from every total — it can't be undone.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.execute({ paymentId: deleting.id });
        }}
      />
      {remove.result.serverError ? (
        <p className="text-sm text-destructive">{remove.result.serverError}</p>
      ) : null}
    </div>
  );
}

/**
 * Calendar-year selector. Navigates rather than filtering in memory — the year
 * decides which payments are READ.
 */
function YearPicker({ years, year }: { years: number[]; year: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const options = years.includes(year) ? years : [year, ...years];

  return (
    <div className="flex flex-col gap-1.5">
      <FilterLabel>Year</FilterLabel>
      <ToggleGroup
        variant="outline"
        spacing={0}
        aria-label="Payment year"
        value={[String(year)]}
        onValueChange={(values) => {
          const next = values[0];
          if (next) {
            router.push(`${pathname}?${BONUS_MANAGER_YEAR_PARAM}=${next}`);
          }
        }}
      >
        {options.map((option) => (
          <ToggleGroupItem key={option} value={String(option)}>
            {option}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

function CreateForm({
  staffOptions,
  onSaved,
}: {
  staffOptions: BonusStaffOption[];
  onSaved: () => void;
}) {
  const { form, action, handleSubmitWithAction } = useHookFormAction(
    createBonusPayment,
    zodResolver(createBonusPaymentSchema),
    {
      actionProps: { onSuccess: () => onSaved() },
      formProps: {
        defaultValues: {
          staffId: "",
          paymentDate: "",
          type: "SPOT" as const,
          amount: 0,
          currency: "CAD" as const,
          notes: "",
        },
      },
    },
  );

  const {
    control,
    formState: { errors },
  } = form;

  return (
    <form onSubmit={handleSubmitWithAction} className="flex flex-col gap-4">
      <FormField
        label="Person"
        htmlFor="bonus-staff"
        error={errors.staffId?.message}
      >
        <Controller
          control={control}
          name="staffId"
          render={({ field }) => (
            <Select
              value={field.value || null}
              onValueChange={(next: string | null) =>
                field.onChange(next ?? "")
              }
            >
              <SelectTrigger
                id="bonus-staff"
                className="w-full"
                aria-invalid={Boolean(errors.staffId)}
              >
                <SelectValue>
                  {(value: string | null) => {
                    const match = staffOptions.find((s) => s.id === value);
                    return match ? (
                      match.name
                    ) : (
                      <span className="text-muted-foreground">
                        Select a person
                      </span>
                    );
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {staffOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>

      <BonusFields control={control} errors={errors} />

      <FormDialogFooter
        serverError={action.result.serverError}
        submitLabel="Record payment"
        loading={action.isPending}
      />
    </form>
  );
}

function EditForm({
  payment,
  onSaved,
}: {
  payment: BonusPaymentRow;
  onSaved: () => void;
}) {
  const { form, action, handleSubmitWithAction } = useHookFormAction(
    updateBonusPayment,
    zodResolver(updateBonusPaymentSchema),
    {
      actionProps: { onSuccess: () => onSaved() },
      formProps: {
        defaultValues: {
          paymentId: payment.id,
          paymentDate: payment.paymentDate,
          type: payment.type,
          amount: payment.amount,
          currency: payment.currency,
          notes: payment.notes ?? "",
        },
      },
    },
  );

  const {
    control,
    register,
    formState: { errors },
  } = form;

  return (
    <form onSubmit={handleSubmitWithAction} className="flex flex-col gap-4">
      <input type="hidden" {...register("paymentId")} />
      <BonusFields control={control} errors={errors} />
      <FormDialogFooter
        serverError={action.result.serverError}
        submitLabel="Save"
        loading={action.isPending}
      />
    </form>
  );
}

/**
 * The four fields shared by create and edit (everything but the person). Kept in
 * one place so the two forms can't drift in validation messages or layout.
 *
 * `control`/`errors` are loosely typed: the two forms' field unions differ
 * (`staffId` vs `paymentId`) while these four fields are identical in both, and
 * threading a generic through react-hook-form's types to express that buys
 * nothing — the resolver, not this component, is what validates.
 */
// biome-ignore lint/suspicious/noExplicitAny: see the note above.
function BonusFields({ control, errors }: { control: any; errors: any }) {
  return (
    <>
      <FormField
        label="Payment date"
        htmlFor="bonus-date"
        error={errors.paymentDate?.message}
      >
        <Controller
          control={control}
          name="paymentDate"
          render={({ field }) => (
            <DatePicker
              id="bonus-date"
              className="w-full"
              value={field.value ?? null}
              onChange={(next) => field.onChange(next ?? "")}
            />
          )}
        />
      </FormField>

      <FormField label="Type" htmlFor="bonus-type" error={errors.type?.message}>
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <div className="flex flex-col gap-1.5">
              <EnumSelect
                options={BONUS_TYPES}
                labels={BONUS_TYPE_LABELS}
                placeholder="Select a type"
                value={field.value ?? ""}
                onValueChange={field.onChange}
                invalid={Boolean(errors.type)}
              />
              {/* Discretionary vs Spot is unguessable from the labels, so the
                  meaning sits right under the picker. */}
              {field.value ? (
                <p className="text-xs text-muted-foreground">
                  {
                    BONUS_TYPE_DESCRIPTIONS[
                      field.value as keyof typeof BONUS_TYPE_DESCRIPTIONS
                    ]
                  }
                </p>
              ) : null}
            </div>
          )}
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <FormField
          label="Amount"
          htmlFor="bonus-amount"
          error={errors.amount?.message}
        >
          <Controller
            control={control}
            name="amount"
            render={({ field }) => (
              <Input
                id="bonus-amount"
                type="number"
                min="0"
                step="0.01"
                aria-invalid={Boolean(errors.amount)}
                value={field.value === 0 ? "" : String(field.value ?? "")}
                onChange={(event) => {
                  const raw = event.target.value;
                  // Empty stays 0 so the schema's "greater than zero" message is
                  // what a blank field reports, rather than a type error.
                  field.onChange(raw === "" ? 0 : Number(raw));
                }}
              />
            )}
          />
        </FormField>

        <FormField
          label="Currency"
          htmlFor="bonus-currency"
          error={errors.currency?.message}
        >
          <Controller
            control={control}
            name="currency"
            render={({ field }) => (
              <EnumSelect
                options={CURRENCY}
                labels={CURRENCY_LABELS}
                placeholder="Currency"
                value={field.value ?? ""}
                onValueChange={field.onChange}
                invalid={Boolean(errors.currency)}
              />
            )}
          />
        </FormField>
      </div>

      <FormField
        label="Notes"
        htmlFor="bonus-notes"
        error={errors.notes?.message}
      >
        <Controller
          control={control}
          name="notes"
          render={({ field }) => (
            <Textarea
              id="bonus-notes"
              rows={3}
              placeholder="Which milestone, who was referred, what the gift was…"
              aria-invalid={Boolean(errors.notes)}
              value={field.value ?? ""}
              onChange={field.onChange}
            />
          )}
        />
      </FormField>
    </>
  );
}
