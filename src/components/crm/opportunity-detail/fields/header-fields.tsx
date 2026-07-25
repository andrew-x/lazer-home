"use client";

import { IconCheck, IconPencil, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { EnumSelect } from "@/components/form/enum-select";
import { IconButton } from "@/components/icon-button";
import { Input } from "@/components/ui/input";
import {
  OPPORTUNITY_STATUSES,
  type OpportunityStatus,
} from "@/lib/crm/opportunity";
import { requiresProject } from "@/lib/crm/opportunity-pipeline";
import { STATUS_SELECT_LABELS } from "../../opportunity-display";
import { type FieldProps, useInlineSave } from "../use-inline-save";

/** The name, rendered as the title but editable in place (confirm/cancel). */
export function HeaderNameField({ detail, refresh }: FieldProps) {
  const save = useInlineSave(detail, refresh);
  const [draft, setDraft] = useState(detail.name);

  if (save.editing) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Name"
            aria-invalid={Boolean(save.error)}
            autoFocus
          />
          <IconButton
            label="Save name"
            onClick={() => save.commit({ field: "name", name: draft })}
            loading={save.isPending}
          >
            <IconCheck />
          </IconButton>
          <IconButton
            label="Cancel editing name"
            onClick={save.close}
            disabled={save.isPending}
          >
            <IconX />
          </IconButton>
        </div>
        {save.error ? (
          <p className="text-sm text-destructive">{save.error}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="truncate font-heading text-base font-medium text-foreground">
        {detail.name}
      </span>
      <IconButton
        label="Edit name"
        onClick={() => {
          setDraft(detail.name);
          save.open();
        }}
      >
        <IconPencil />
      </IconButton>
    </div>
  );
}

/**
 * Status as a direct-edit select — no confirm step; picking a value saves it
 * immediately. Mirrors the server's delivery-stage guard: advancing into a
 * stage that requires a project without one surfaces an error and reverts (the
 * select stays bound to the saved `detail.status`).
 */
export function HeaderStatusField({ detail, refresh }: FieldProps) {
  const save = useInlineSave(detail, refresh);
  const hasProject = detail.project !== null;

  const handleChange = (next: OpportunityStatus | "") => {
    if (!next || next === detail.status) return;
    if (requiresProject(next) && !hasProject) {
      save.fail(
        "Create a project for this opportunity before moving it to Allocating or later.",
      );
      return;
    }
    save.commit({ field: "status", status: next });
  };

  return (
    <div className="flex w-56 shrink-0 flex-col gap-1">
      <EnumSelect
        options={OPPORTUNITY_STATUSES}
        labels={STATUS_SELECT_LABELS}
        placeholder="Select a status"
        value={detail.status}
        invalid={Boolean(save.error)}
        onValueChange={handleChange}
      />
      {save.error ? (
        <p className="text-sm text-destructive">{save.error}</p>
      ) : null}
    </div>
  );
}
