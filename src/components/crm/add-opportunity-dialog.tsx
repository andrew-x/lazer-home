"use client";

import { IconPlus } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { createOpportunity } from "@/actions/crm/createOpportunity";
import {
  createOpportunitySchema,
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STATUSES,
  type OpportunitySource,
  type OpportunityStatus,
} from "@/actions/crm/createOpportunity.schema";
import { searchStaff } from "@/actions/crm/searchStaff";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CompanyComboboxField } from "./company-combobox-field";
import { ContactsComboboxField } from "./contacts-combobox-field";
import {
  EntityMultiCombobox,
  type EntityOption,
} from "./entity-multi-combobox";
import { SOURCE_LABELS, STATUS_LABELS } from "./opportunity-display";

type OpportunityFormValues = {
  name: string;
  companyId: string;
  companyName: string;
  contacts: EntityOption[];
  owners: EntityOption[];
  source: OpportunitySource | "";
  sourceContacts: EntityOption[];
  sourceStaff: EntityOption[];
  nextSteps: string;
  status: OpportunityStatus | "";
};

const DEFAULT_VALUES: OpportunityFormValues = {
  name: "",
  companyId: "",
  companyName: "",
  contacts: [],
  owners: [],
  source: "",
  sourceContacts: [],
  sourceStaff: [],
  nextSteps: "",
  status: "",
};

// Maps a server-schema issue path to the corresponding form field.
const FIELD_FOR_ISSUE: Record<string, keyof OpportunityFormValues> = {
  name: "name",
  companyId: "companyId",
  contactIds: "contacts",
  ownerIds: "owners",
  source: "source",
  sourceContactIds: "sourceContacts",
  sourceStaffIds: "sourceStaff",
  nextSteps: "nextSteps",
  status: "status",
};

export function AddOpportunityDialog() {
  const [open, setOpen] = useState(false);
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
          <Button size="sm">
            <IconPlus />
            Add opportunity
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add opportunity</DialogTitle>
          <DialogDescription>
            Create a pipeline deal for a company.
          </DialogDescription>
        </DialogHeader>
        <OpportunityForm key={formKey} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function OpportunityForm({ onSaved }: { onSaved: () => void }) {
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    watch,
    formState: { errors },
  } = useForm<OpportunityFormValues>({ defaultValues: DEFAULT_VALUES });

  const { execute, result, isPending } = useAction(createOpportunity, {
    onSuccess: () => onSaved(),
  });

  const source = watch("source");
  const companyName = watch("companyName");

  const onSubmit = (values: OpportunityFormValues) => {
    clearErrors();
    const payload = {
      name: values.name,
      companyId: values.companyId,
      contactIds: values.contacts.map((c) => c.id),
      ownerIds: values.owners.map((o) => o.id),
      source: values.source,
      sourceContactIds: values.sourceContacts.map((c) => c.id),
      sourceStaffIds: values.sourceStaff.map((s) => s.id),
      nextSteps: values.nextSteps,
      status: values.status,
    };

    const parsed = createOpportunitySchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        const field =
          typeof key === "string" ? FIELD_FOR_ISSUE[key] : undefined;
        if (field) setError(field, { message: issue.message });
      }
      return;
    }

    execute(parsed.data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="opp-name">Name</Label>
        <Input
          id="opp-name"
          placeholder="Acme platform rebuild"
          aria-invalid={Boolean(errors.name)}
          {...register("name")}
        />
        {errors.name ? (
          <p className="text-sm text-destructive">{errors.name.message}</p>
        ) : null}
      </div>

      <Controller
        control={control}
        name="companyId"
        render={({ field }) => (
          <CompanyComboboxField
            value={field.value || null}
            selectedName={companyName || null}
            onChange={(next) => {
              field.onChange(next?.id ?? "");
              setValue("companyName", next?.name ?? "");
              if (next) clearErrors("companyId");
            }}
            error={errors.companyId?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="contacts"
        render={({ field, fieldState }) => (
          <ContactsComboboxField
            label="Contacts"
            value={field.value}
            onChange={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />

      <div className="flex flex-col gap-1.5">
        <Label>Owners</Label>
        <Controller
          control={control}
          name="owners"
          render={({ field, fieldState }) => (
            <EntityMultiCombobox
              value={field.value}
              onChange={field.onChange}
              searchAction={searchStaff}
              placeholder="Search staff…"
              invalid={Boolean(fieldState.error)}
            />
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Source</Label>
        <Controller
          control={control}
          name="source"
          render={({ field, fieldState }) => (
            <Select
              value={field.value || null}
              onValueChange={(next) => {
                field.onChange(next ?? "");
                // Referral entities only apply to their matching source.
                setValue("sourceStaff", []);
                setValue("sourceContacts", []);
                clearErrors(["sourceStaff", "sourceContacts"]);
              }}
            >
              <SelectTrigger
                className="w-full"
                aria-invalid={Boolean(fieldState.error)}
              >
                <SelectValue>
                  {(v: string | null) =>
                    v ? (
                      SOURCE_LABELS[v as OpportunitySource]
                    ) : (
                      <span className="text-muted-foreground">
                        Select a source
                      </span>
                    )
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {OPPORTUNITY_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SOURCE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.source ? (
          <p className="text-sm text-destructive">{errors.source.message}</p>
        ) : null}
      </div>

      {source === "staff_referral" ? (
        <div className="flex flex-col gap-1.5">
          <Label>Referring staff</Label>
          <Controller
            control={control}
            name="sourceStaff"
            render={({ field, fieldState }) => (
              <EntityMultiCombobox
                value={field.value}
                onChange={field.onChange}
                searchAction={searchStaff}
                placeholder="Search staff…"
                invalid={Boolean(fieldState.error)}
              />
            )}
          />
          {errors.sourceStaff ? (
            <p className="text-sm text-destructive">
              {errors.sourceStaff.message}
            </p>
          ) : null}
        </div>
      ) : null}

      {source === "contact_referral" ? (
        <Controller
          control={control}
          name="sourceContacts"
          render={({ field, fieldState }) => (
            <ContactsComboboxField
              label="Referring contacts"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label>Status</Label>
        <Controller
          control={control}
          name="status"
          render={({ field, fieldState }) => (
            <Select
              value={field.value || null}
              onValueChange={(next) => field.onChange(next ?? "")}
            >
              <SelectTrigger
                className="w-full"
                aria-invalid={Boolean(fieldState.error)}
              >
                <SelectValue>
                  {(v: string | null) =>
                    v ? (
                      STATUS_LABELS[v as OpportunityStatus]
                    ) : (
                      <span className="text-muted-foreground">
                        Select a status
                      </span>
                    )
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {OPPORTUNITY_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.status ? (
          <p className="text-sm text-destructive">{errors.status.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="opp-next-steps">Next steps</Label>
        <Textarea
          id="opp-next-steps"
          placeholder="What happens next?"
          {...register("nextSteps")}
        />
      </div>

      {result.serverError ? (
        <p className="text-sm text-destructive">{result.serverError}</p>
      ) : null}

      <DialogFooter>
        <DialogClose
          render={
            <Button type="button" variant="outline">
              Cancel
            </Button>
          }
        />
        <Button type="submit" loading={isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
