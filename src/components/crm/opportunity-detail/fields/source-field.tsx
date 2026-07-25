"use client";

import { useState } from "react";
import type {
  EntityRef,
  OpportunityDetail,
} from "@/actions/crm/getOpportunity";
import { searchContacts } from "@/actions/crm/searchContacts";
import { searchStaff } from "@/actions/crm/searchStaff";
import {
  EntityMultiCombobox,
  type EntityOption,
} from "@/components/form/entity-multi-combobox";
import { EnumSelect } from "@/components/form/enum-select";
import { InlineEditField } from "@/components/form/inline-edit-field";
import { Button } from "@/components/ui/button";
import {
  OPPORTUNITY_SOURCES,
  type OpportunitySource,
  SOURCE_LABELS,
} from "@/lib/crm/opportunity";
import { CreateContactInlineDialog } from "../../create-contact-inline-dialog";
import { type FieldProps, useInlineSave } from "../use-inline-save";

/** The referral entities that apply to a source, for the read display. */
function referralFor(detail: OpportunityDetail): EntityRef[] {
  if (detail.source === "staff_referral") return detail.sourceStaff;
  if (detail.source === "contact_referral") return detail.sourceContacts;
  return [];
}

export function SourceField({ detail, refresh }: FieldProps) {
  const save = useInlineSave(detail, refresh);
  const [source, setSource] = useState<OpportunitySource | "">(detail.source);
  const [sourceStaff, setSourceStaff] = useState<EntityOption[]>(
    detail.sourceStaff,
  );
  const [sourceContacts, setSourceContacts] = useState<EntityOption[]>(
    detail.sourceContacts,
  );
  const [createOpen, setCreateOpen] = useState(false);

  const resetDrafts = () => {
    setSource(detail.source);
    setSourceStaff(detail.sourceStaff);
    setSourceContacts(detail.sourceContacts);
  };

  const referral = referralFor(detail);

  return (
    <InlineEditField
      label="Source"
      display={
        <div className="flex flex-col">
          <span>{SOURCE_LABELS[detail.source]}</span>
          {referral.length > 0 ? (
            <span className="text-muted-foreground">
              via {referral.map((r) => r.name).join(", ")}
            </span>
          ) : null}
        </div>
      }
      editing={save.editing}
      isSaving={save.isPending}
      error={save.error}
      editAction={
        source === "contact_referral" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            New contact
          </Button>
        ) : undefined
      }
      onEdit={() => {
        resetDrafts();
        save.open();
      }}
      onCancel={() => {
        resetDrafts();
        save.close();
      }}
      onConfirm={() =>
        save.commit({
          field: "source",
          source: source as OpportunitySource,
          // Referral entities only apply to their matching source.
          sourceStaffIds:
            source === "staff_referral" ? sourceStaff.map((s) => s.id) : [],
          sourceContactIds:
            source === "contact_referral"
              ? sourceContacts.map((c) => c.id)
              : [],
        })
      }
    >
      <div className="flex flex-col gap-2">
        <EnumSelect
          options={OPPORTUNITY_SOURCES}
          labels={SOURCE_LABELS}
          placeholder="Select a source"
          value={source}
          invalid={Boolean(save.error)}
          onValueChange={(next) => {
            setSource(next);
            // Referral entities only apply to their matching source.
            setSourceStaff([]);
            setSourceContacts([]);
          }}
        />
        {source === "staff_referral" ? (
          <EntityMultiCombobox
            value={sourceStaff}
            onChange={setSourceStaff}
            searchAction={searchStaff}
            placeholder="Search staff…"
            invalid={Boolean(save.error)}
          />
        ) : null}
        {source === "contact_referral" ? (
          <>
            <EntityMultiCombobox
              value={sourceContacts}
              onChange={setSourceContacts}
              searchAction={searchContacts}
              placeholder="Search contacts…"
              invalid={Boolean(save.error)}
            />
            <CreateContactInlineDialog
              open={createOpen}
              onOpenChange={setCreateOpen}
              onCreated={(option) =>
                setSourceContacts((prev) => [...prev, option])
              }
            />
          </>
        ) : null}
      </div>
    </InlineEditField>
  );
}
