"use client";

import { IconCheck, IconPencil, IconPlus, IconX } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
import type {
  EntityRef,
  OpportunityDetail,
} from "@/actions/crm/getOpportunity";
import { loadOpportunityDetail } from "@/actions/crm/loadOpportunityDetail";
import { searchContacts } from "@/actions/crm/searchContacts";
import { searchStaff } from "@/actions/crm/searchStaff";
import { updateOpportunityField } from "@/actions/crm/updateOpportunityField";
import {
  type UpdateOpportunityFieldInput,
  updateOpportunityFieldSchema,
} from "@/actions/crm/updateOpportunityField.schema";
import {
  EntityMultiCombobox,
  type EntityOption,
} from "@/components/form/entity-multi-combobox";
import { EnumSelect } from "@/components/form/enum-select";
import { InlineEditField } from "@/components/form/inline-edit-field";
import { IconButton } from "@/components/icon-button";
import { AddProjectDialog } from "@/components/projects/add-project-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  LINE_OF_BUSINESS,
  LINE_OF_BUSINESS_LABELS,
  type LineOfBusiness,
} from "@/lib/line-of-business";
import {
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STATUSES,
  type OpportunitySource,
  type OpportunityStatus,
  SOURCE_LABELS,
} from "@/lib/opportunity";
import { requiresProject } from "@/lib/opportunity-pipeline";
import { CompanyCombobox } from "./company-combobox";
import { CreateContactInlineDialog } from "./create-contact-inline-dialog";
import { STATUS_SELECT_LABELS } from "./opportunity-display";

/**
 * The opportunity detail drawer: a wide right-side sheet opened by clicking a
 * board card. The header carries the name (edited in place with confirm/cancel)
 * and the status (a direct-edit select that saves on change). Below, an Info tab
 * holds the remaining fields — including the company — each editing one at a time
 * in place (per-field confirm/cancel, each saved via a field-scoped
 * `updateOpportunityField` write), and a
 * Project plan tab for the single project that delivers the opportunity. Detail
 * is loaded on open via `loadOpportunityDetail` and
 * re-fetched after every save so the read views reflect it. The drawer only
 * mounts for `crm.edit` users (gated on the board), so editing is always allowed.
 */
export function OpportunityDetailSheet({
  opportunityId,
  open,
  onOpenChange,
  canCreateProject,
}: {
  opportunityId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canCreateProject: boolean;
}) {
  const { execute: load, result, reset } = useAction(loadOpportunityDetail);
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);

  useEffect(() => {
    if (open && opportunityId) {
      load({ id: opportunityId });
    } else if (!open) {
      setDetail(null);
      reset();
    }
  }, [open, opportunityId, load, reset]);

  useEffect(() => {
    if (result.data) setDetail(result.data);
  }, [result.data]);

  // Re-fetch after a field save or project create so the read views and the
  // delivery-stage guard reflect the change. The view isn't remounted (its `key`
  // stays the same opportunity id), so tab selection and closed fields persist.
  const refresh = useCallback(() => {
    if (opportunityId) load({ id: opportunityId });
  }, [opportunityId, load]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        showCloseButton={false}
        className="w-full gap-0 data-[side=right]:sm:max-w-3xl"
      >
        {/* Close handle as a tab on the drawer's left edge, clear of the header's
            status control. It's a child of the (non-scrolling) popup so it can
            escape the drawer's bounds and stays put while content scrolls. On lg+
            (where the capped drawer leaves a left gutter) it hangs off the outside;
            below that it tucks flush against the inner-left edge. */}
        <SheetClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-4 left-0 z-10 h-10 w-8 rounded-l-none border border-l-0 bg-popover lg:-translate-x-full lg:rounded-l lg:rounded-r-none lg:border-r-0 lg:border-l"
            />
          }
        >
          <IconX />
          <span className="sr-only">Close</span>
        </SheetClose>
        <div className="flex h-full flex-col overflow-y-auto">
          {/* pl clears the flush close tab below lg, where it sits inside the edge. */}
          <SheetHeader className="pl-12 lg:pl-4">
            {detail ? (
              <OpportunityHeader detail={detail} refresh={refresh} />
            ) : (
              <>
                <SheetTitle>Opportunity</SheetTitle>
                <SheetDescription>Loading…</SheetDescription>
              </>
            )}
          </SheetHeader>
          {detail ? (
            <OpportunityDetailView
              key={detail.id}
              detail={detail}
              canCreateProject={canCreateProject}
              refresh={refresh}
            />
          ) : (
            <p className="px-4 pb-4 text-sm text-muted-foreground">
              {/* `data === null` = loaded but not found (vs `undefined` = still loading). */}
              {result.serverError || result.data === null
                ? "Couldn't load this opportunity."
                : "Loading…"}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function OpportunityDetailView({
  detail,
  canCreateProject,
  refresh,
}: {
  detail: OpportunityDetail;
  canCreateProject: boolean;
  refresh: () => void;
}) {
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const linkedProject = detail.projects[0];

  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <Tabs defaultValue="info">
        <TabsList variant="line">
          <TabsTrigger value="info">Info</TabsTrigger>
          <TabsTrigger value="project-plan">Project plan</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="flex flex-col gap-4 pt-4">
          <LineOfBusinessField detail={detail} refresh={refresh} />
          <SourceField detail={detail} refresh={refresh} />
          <CompanyField detail={detail} refresh={refresh} />
          <ContactsField detail={detail} refresh={refresh} />
          <OwnersField detail={detail} refresh={refresh} />
          <NextStepsField detail={detail} refresh={refresh} />
        </TabsContent>

        <TabsContent value="project-plan" className="flex flex-col gap-3 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Project</span>
            {canCreateProject && !linkedProject ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setProjectDialogOpen(true)}
              >
                <IconPlus />
                Create project
              </Button>
            ) : null}
          </div>
          {linkedProject ? (
            <div className="rounded-md border p-3 text-sm font-medium">
              {linkedProject.name}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No project yet. A project is required once this opportunity
              reaches Allocating.
            </p>
          )}
        </TabsContent>
      </Tabs>

      <AddProjectDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        // Launched from within the drawer (a Base UI dialog), so force its own
        // backdrop to blur the drawer behind it.
        forceMountOverlay
        opportunityId={detail.id}
        defaultCompanyId={detail.company.id}
        defaultCompanyName={detail.company.name}
        defaultLineOfBusiness={detail.lineOfBusiness}
        lockCompany
        onCreated={refresh}
      />
    </div>
  );
}

type FieldProps = { detail: OpportunityDetail; refresh: () => void };

/**
 * One field's edit payload — a `updateOpportunityField` variant minus the `id`,
 * which `commit` fills from the loaded detail. A distributive `Omit` so it stays
 * a discriminated union (each variant keeps only its own keys).
 */
type FieldEdit = UpdateOpportunityFieldInput extends infer T
  ? T extends { id: string }
    ? Omit<T, "id">
    : never
  : never;

/**
 * Per-field edit state + save. Each field owns its own instance so pending and
 * error are isolated. `commit` sends *only* the changed field's slice via the
 * field-scoped `updateOpportunityField` — so a save never clobbers a concurrent
 * edit to another field or needlessly rewrites the other people junctions — and
 * closes the field on success. A client-side `safeParse` surfaces the field's
 * own validation message before the round-trip; `fail` lets a field report a
 * guard failure directly.
 */
function useInlineSave(detail: OpportunityDetail, refresh: () => void) {
  const [editing, setEditing] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const { execute, result, isPending, reset } = useAction(
    updateOpportunityField,
    {
      onSuccess: () => {
        setEditing(false);
        refresh();
      },
    },
  );

  return {
    editing,
    isPending,
    error: clientError ?? result.serverError ?? undefined,
    open: () => {
      setClientError(null);
      reset();
      setEditing(true);
    },
    close: () => {
      setClientError(null);
      reset();
      setEditing(false);
    },
    fail: (message: string) => setClientError(message),
    commit: (edit: FieldEdit) => {
      setClientError(null);
      const parsed = updateOpportunityFieldSchema.safeParse({
        ...edit,
        id: detail.id,
      });
      if (!parsed.success) {
        // The payload only carries this field's keys, so any issue is this
        // field's — surface the first.
        const issue = parsed.error.issues[0];
        setClientError(issue?.message ?? "Please check this value.");
        return;
      }
      execute(parsed.data);
    },
  };
}

/** Comma-joined entity names, or a muted "None" when empty. */
function EntityNames({ items }: { items: EntityRef[] }) {
  if (items.length === 0) {
    return <span className="text-muted-foreground">None</span>;
  }
  return <>{items.map((item) => item.name).join(", ")}</>;
}

/**
 * The drawer header: the opportunity name (edited in place via the same
 * confirm/cancel workflow as the Info fields), with the status as a direct-edit
 * select on the right. The company lives in the Info tab as its own editable
 * field. A visually-hidden `SheetTitle` keeps a stable accessible name for the
 * dialog while the visible name field swaps between read and edit modes; a
 * visually-hidden `SheetDescription` satisfies the dialog's description slot.
 */
function OpportunityHeader({ detail, refresh }: FieldProps) {
  return (
    <>
      <SheetTitle className="sr-only">{detail.name}</SheetTitle>
      <SheetDescription className="sr-only">
        Opportunity details for {detail.name}
      </SheetDescription>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <HeaderNameField detail={detail} refresh={refresh} />
        </div>
        <HeaderStatusField detail={detail} refresh={refresh} />
      </div>
    </>
  );
}

/** The name, rendered as the title but editable in place (confirm/cancel). */
function HeaderNameField({ detail, refresh }: FieldProps) {
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
function HeaderStatusField({ detail, refresh }: FieldProps) {
  const save = useInlineSave(detail, refresh);
  const hasProject = detail.projects.length > 0;

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

function LineOfBusinessField({ detail, refresh }: FieldProps) {
  const save = useInlineSave(detail, refresh);
  const [draft, setDraft] = useState<LineOfBusiness | "">(
    detail.lineOfBusiness,
  );
  return (
    <InlineEditField
      label="Line of business"
      display={LINE_OF_BUSINESS_LABELS[detail.lineOfBusiness]}
      editing={save.editing}
      isSaving={save.isPending}
      error={save.error}
      onEdit={() => {
        setDraft(detail.lineOfBusiness);
        save.open();
      }}
      onCancel={save.close}
      onConfirm={() =>
        save.commit({
          field: "lineOfBusiness",
          lineOfBusiness: draft as LineOfBusiness,
        })
      }
    >
      <EnumSelect
        options={LINE_OF_BUSINESS}
        labels={LINE_OF_BUSINESS_LABELS}
        placeholder="Select a line of business"
        value={draft}
        invalid={Boolean(save.error)}
        onValueChange={setDraft}
      />
    </InlineEditField>
  );
}

function OwnersField({ detail, refresh }: FieldProps) {
  const save = useInlineSave(detail, refresh);
  const [draft, setDraft] = useState<EntityOption[]>(detail.owners);
  return (
    <InlineEditField
      label="Owners"
      display={<EntityNames items={detail.owners} />}
      editing={save.editing}
      isSaving={save.isPending}
      error={save.error}
      onEdit={() => {
        setDraft(detail.owners);
        save.open();
      }}
      onCancel={save.close}
      onConfirm={() =>
        save.commit({ field: "owners", ownerIds: draft.map((o) => o.id) })
      }
    >
      <EntityMultiCombobox
        value={draft}
        onChange={setDraft}
        searchAction={searchStaff}
        placeholder="Search staff…"
        invalid={Boolean(save.error)}
      />
    </InlineEditField>
  );
}

function CompanyField({ detail, refresh }: FieldProps) {
  const save = useInlineSave(detail, refresh);
  const [draft, setDraft] = useState<EntityRef | null>(detail.company);
  return (
    <InlineEditField
      label="Company"
      display={detail.company.name}
      editing={save.editing}
      isSaving={save.isPending}
      error={save.error}
      onEdit={() => {
        setDraft(detail.company);
        save.open();
      }}
      onCancel={save.close}
      // A cleared company fails the schema's required rule, surfacing inline.
      onConfirm={() =>
        save.commit({ field: "companyId", companyId: draft?.id ?? "" })
      }
    >
      <CompanyCombobox
        value={draft?.id ?? null}
        selectedName={draft?.name ?? null}
        onChange={setDraft}
      />
    </InlineEditField>
  );
}

function ContactsField({ detail, refresh }: FieldProps) {
  const save = useInlineSave(detail, refresh);
  const [draft, setDraft] = useState<EntityOption[]>(detail.contacts);
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <InlineEditField
      label="Contacts"
      display={<EntityNames items={detail.contacts} />}
      editing={save.editing}
      isSaving={save.isPending}
      error={save.error}
      editAction={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCreateOpen(true)}
        >
          New contact
        </Button>
      }
      onEdit={() => {
        setDraft(detail.contacts);
        save.open();
      }}
      onCancel={save.close}
      onConfirm={() =>
        save.commit({ field: "contacts", contactIds: draft.map((c) => c.id) })
      }
    >
      <EntityMultiCombobox
        value={draft}
        onChange={setDraft}
        searchAction={searchContacts}
        placeholder="Search contacts…"
        invalid={Boolean(save.error)}
      />
      <CreateContactInlineDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(option) => setDraft((prev) => [...prev, option])}
      />
    </InlineEditField>
  );
}

/** The referral entities that apply to a source, for the read display. */
function referralFor(detail: OpportunityDetail): EntityRef[] {
  if (detail.source === "staff_referral") return detail.sourceStaff;
  if (detail.source === "contact_referral") return detail.sourceContacts;
  return [];
}

function SourceField({ detail, refresh }: FieldProps) {
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

function NextStepsField({ detail, refresh }: FieldProps) {
  const save = useInlineSave(detail, refresh);
  const [draft, setDraft] = useState(detail.nextSteps ?? "");
  return (
    <InlineEditField
      label="Next steps"
      display={
        detail.nextSteps ? (
          <span className="whitespace-pre-wrap">{detail.nextSteps}</span>
        ) : (
          <span className="text-muted-foreground">None</span>
        )
      }
      editing={save.editing}
      isSaving={save.isPending}
      error={save.error}
      onEdit={() => {
        setDraft(detail.nextSteps ?? "");
        save.open();
      }}
      onCancel={save.close}
      onConfirm={() => save.commit({ field: "nextSteps", nextSteps: draft })}
    >
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="What happens next?"
      />
    </InlineEditField>
  );
}
