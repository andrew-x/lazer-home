"use client";

import { IconSearch } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import type { CompensationPlanEditorItem } from "@/actions/performance/getCompensationPlan";
import type { CompensationPlanCandidate } from "@/actions/performance/getStaffForCompensationPlan";
import { setCompensationPlanStaff } from "@/actions/performance/setCompensationPlanStaff";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ALL, FilterLabel, SelectFilter } from "@/components/form/filters";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/core/utils";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { EMPLOYMENT_TYPE_LABELS, ROLE_LABELS } from "@/lib/staff/staff-enums";
import { STAFF_FILTER_OPTIONS } from "@/lib/staff/staff-filters";

function matches(query: string, ...fields: (string | null | undefined)[]) {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(q));
}

/** Whether a plan row holds work that removing the person would throw away. */
function hasWork(item: CompensationPlanEditorItem): boolean {
  return (
    item.plannedAmount != null ||
    item.evaluationNotes != null ||
    item.compensationNotes != null ||
    item.ratingDone ||
    item.meetingDone ||
    item.isComplete
  );
}

/**
 * The plan's membership, managed on its own page rather than inside the editor.
 *
 * Keeping "who is in this round" separate from "what are we giving them" keeps
 * the editor a pure comparison grid — no per-row destructive control sitting
 * next to the money columns. The whole checked set is submitted at once, so
 * adding and removing are one reviewable change rather than a series of
 * immediate side effects.
 */
export function ManagePlanStaff({
  planId,
  planName,
  items,
  candidates,
  readOnly,
}: {
  planId: string;
  planName: string;
  items: CompensationPlanEditorItem[];
  candidates: CompensationPlanCandidate[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const searchId = useId();

  const [query, setQuery] = useState("");
  const [lineOfBusiness, setLineOfBusiness] = useState<string>(ALL);
  const [role, setRole] = useState<string>(ALL);
  const [employmentType, setEmploymentType] = useState<string>(ALL);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const initialIds = useMemo(
    () => new Set(items.map((item) => item.staffId)),
    [items],
  );
  const [selected, setSelected] = useState<Set<string>>(initialIds);

  const workByStaffId = useMemo(
    () => new Map(items.map((item) => [item.staffId, hasWork(item)])),
    [items],
  );

  const save = useAction(setCompensationPlanStaff, {
    onSuccess: ({ data }) => {
      setConfirmOpen(false);
      const parts = [
        data?.added ? `${data.added} added` : null,
        data?.removed ? `${data.removed} removed` : null,
      ].filter(Boolean);
      toast.success(parts.length ? parts.join(", ") : "No changes.");
      router.push(`/performance/compensation-plans/${planId}`);
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't update the plan's staff."),
  });

  const filtered = useMemo(
    () =>
      candidates.filter(
        (candidate) =>
          matches(query, candidate.name, candidate.location) &&
          (lineOfBusiness === ALL ||
            candidate.lineOfBusiness === lineOfBusiness) &&
          (role === ALL || candidate.role === role) &&
          (employmentType === ALL ||
            candidate.employmentType === employmentType),
      ),
    [candidates, query, lineOfBusiness, role, employmentType],
  );

  const filteredIds = filtered.map((candidate) => candidate.staffId);
  const allSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  const someSelected = filteredIds.some((id) => selected.has(id));

  const added = [...selected].filter((id) => !initialIds.has(id));
  const removed = [...initialIds].filter((id) => !selected.has(id));
  const removedWithWork = removed.filter((id) => workByStaffId.get(id));
  const dirty = added.length > 0 || removed.length > 0;

  function toggle(staffId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(staffId);
      else next.delete(staffId);
      return next;
    });
  }

  function toggleAllFiltered(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const staffId of filteredIds) {
        if (checked) next.add(staffId);
        else next.delete(staffId);
      }
      return next;
    });
  }

  function submit() {
    // Removing a row discards its proposal and notes — confirm only when there
    // is actually something to lose.
    if (removedWithWork.length > 0 && !confirmOpen) {
      setConfirmOpen(true);
      return;
    }
    save.execute({ planId, staffIds: [...selected] });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <IconSearch className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={searchId}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or location"
          className="pl-9"
          disabled={readOnly}
        />
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <SelectFilter
          label="Line of business"
          value={lineOfBusiness}
          options={STAFF_FILTER_OPTIONS.lineOfBusiness}
          labels={LINE_OF_BUSINESS_LABELS}
          onChange={setLineOfBusiness}
        />
        <SelectFilter
          label="Role"
          value={role}
          options={STAFF_FILTER_OPTIONS.role}
          labels={ROLE_LABELS}
          onChange={setRole}
        />
        <SelectFilter
          label="Type"
          value={employmentType}
          options={STAFF_FILTER_OPTIONS.employmentType}
          labels={EMPLOYMENT_TYPE_LABELS}
          onChange={setEmploymentType}
        />
        <div className="ml-auto flex flex-col gap-1.5">
          <FilterLabel>In this plan</FilterLabel>
          <span className="text-sm tabular-nums">{selected.size} staff</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            id={`${searchId}-all`}
            checked={allSelected}
            indeterminate={someSelected && !allSelected}
            disabled={readOnly || filteredIds.length === 0}
            onCheckedChange={(checked) => toggleAllFiltered(checked === true)}
          />
          <Label htmlFor={`${searchId}-all`} className="font-normal">
            Select all {filteredIds.length} matching
          </Label>
        </div>
        <span className="text-sm text-muted-foreground">
          {dirty
            ? `${added.length} to add · ${removed.length} to remove`
            : "No changes"}
        </span>
      </div>

      <div className="max-h-[32rem] overflow-y-auto rounded-md border">
        {filtered.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            No staff match those filters.
          </p>
        ) : (
          <ul>
            {filtered.map((candidate) => (
              <li key={candidate.staffId} className="border-b last:border-b-0">
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2",
                    !readOnly && "hover:bg-muted",
                  )}
                >
                  <Checkbox
                    id={`${searchId}-${candidate.staffId}`}
                    checked={selected.has(candidate.staffId)}
                    disabled={readOnly}
                    onCheckedChange={(checked) =>
                      toggle(candidate.staffId, checked === true)
                    }
                  />
                  <Label
                    htmlFor={`${searchId}-${candidate.staffId}`}
                    className="flex min-w-0 flex-1 flex-col items-start gap-0.5 font-normal"
                  >
                    <span className="truncate text-sm font-medium">
                      {candidate.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {describe(candidate)}
                    </span>
                  </Label>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {save.result.serverError ? (
        <p className="text-sm text-destructive">{save.result.serverError}</p>
      ) : null}

      {readOnly ? null : (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            render={
              <Link href={`/performance/compensation-plans/${planId}`}>
                Cancel
              </Link>
            }
          />
          <Button onClick={submit} disabled={!dirty} loading={save.isPending}>
            Save staff
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Remove ${removedWithWork.length === 1 ? "1 person" : `${removedWithWork.length} people`} from “${planName}”?`}
        description="Their proposed rating, planned figure and notes in this plan will be discarded. This can't be undone."
        confirmLabel="Remove and save"
        destructive
        loading={save.isPending}
        onConfirm={() => save.execute({ planId, staffIds: [...selected] })}
      />
    </div>
  );
}

/** The muted sub-line: line of business · role · type · location. */
function describe(candidate: CompensationPlanCandidate): string {
  return [
    candidate.lineOfBusiness
      ? LINE_OF_BUSINESS_LABELS[candidate.lineOfBusiness]
      : null,
    candidate.role ? ROLE_LABELS[candidate.role] : null,
    candidate.employmentType
      ? EMPLOYMENT_TYPE_LABELS[candidate.employmentType]
      : null,
    candidate.location,
  ]
    .filter(Boolean)
    .join(" · ");
}
