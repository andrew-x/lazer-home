"use client";

import {
  IconChevronDown,
  IconChevronUp,
  IconDotsVertical,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { deleteOpportunity } from "@/actions/crm/deleteOpportunity";
import type { OpportunityDetail } from "@/actions/crm/getOpportunity";
import { loadOpportunityDetail } from "@/actions/crm/loadOpportunityDetail";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { COMPACT_META_FIELDS } from "@/components/form/field-density";
import { IconButton } from "@/components/icon-button";
import { OpportunityProjectPlan } from "@/components/projects/opportunity-plan/opportunity-project-plan";
import { SlackChannelField } from "@/components/slack/slack-channel-field";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/core/utils";
import { EntryLog } from "../entry-log";
import { TaskList } from "../task-list";
import { CompanyField } from "./fields/company-field";
import { ContactsField } from "./fields/contacts-field";
import { HeaderNameField, HeaderStatusField } from "./fields/header-fields";
import { LineOfBusinessField } from "./fields/line-of-business-field";
import { OwnersField } from "./fields/owners-field";
import { SourceField } from "./fields/source-field";
import type { FieldProps } from "./use-inline-save";

/**
 * The opportunity detail drawer: a wide right-side sheet opened by clicking a
 * board card. The header carries the name (edited in place with confirm/cancel)
 * and the status (a direct-edit select that saves on change). Below, a Details
 * tab lays the remaining fields — including the company — in a left meta column
 * (each editing one at a time in place: per-field confirm/cancel, each saved via
 * a field-scoped `updateOpportunityField` write) alongside tasks and notes
 * on the right, plus a Project plan tab for the single project that delivers the
 * opportunity. A left-edge control strip closes the drawer and (when the card has
 * column siblings) steps to the previous/next opportunity via `onPrev`/`onNext`.
 * Detail is loaded on open via `loadOpportunityDetail` and re-fetched after every
 * save so the read views reflect it. The drawer only mounts for `crm.edit` users
 * (gated on the board), so editing is always allowed.
 */
export function OpportunityDetailSheet({
  opportunityId,
  open,
  onOpenChange,
  canCreateProject,
  onPrev,
  onNext,
  position,
  total,
}: {
  opportunityId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canCreateProject: boolean;
  // Step to the previous/next opportunity in the same board column. Undefined
  // when unavailable (boundary card). The nav controls (and the x-of-y count)
  // show only when the column has more than one card (`total > 1`).
  onPrev?: () => void;
  onNext?: () => void;
  // The open card's 1-based position within its column and the column's size,
  // for the "x of y" indicator between the prev/next buttons.
  position?: number;
  total?: number;
}) {
  const { execute: load, result, reset } = useAction(loadOpportunityDetail);
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [currentStaff, setCurrentStaff] = useState<EntityOption | null>(null);
  const [slackEnabled, setSlackEnabled] = useState(false);

  useEffect(() => {
    if (open && opportunityId) {
      load({ id: opportunityId });
    } else if (!open) {
      setDetail(null);
      reset();
    }
  }, [open, opportunityId, load, reset]);

  useEffect(() => {
    if (result.data) {
      setDetail(result.data.detail);
      setCurrentStaff(result.data.currentStaff);
      setSlackEnabled(result.data.slackEnabled);
    }
  }, [result.data]);

  // Re-fetch after a field save or project create so the read views and the
  // delivery-stage guard reflect the change. The view isn't remounted (its `key`
  // stays the same opportunity id), so tab selection and closed fields persist.
  const refresh = useCallback(() => {
    if (opportunityId) load({ id: opportunityId });
  }, [opportunityId, load]);

  // Shared edge treatment for the left-edge control boxes: hairline border +
  // popover fill; on lg+ it hangs off the drawer's outer edge, below that it
  // tucks flush against the inner-left edge.
  const edgeBox =
    "flex flex-col rounded-l-none border border-l-0 bg-popover lg:-translate-x-full lg:rounded-l lg:rounded-r-none lg:border-r-0 lg:border-l";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        showCloseButton={false}
        className="w-full gap-0 data-[side=right]:sm:max-w-[80rem]"
      >
        {/* Control strip on the drawer's left edge — a close box, then (when the
            card has column siblings) a separate prev/count/next box. Children of
            the (non-scrolling) popup so they escape the drawer's bounds and stay
            put while content scrolls. On lg+ (where the capped drawer leaves a
            left gutter) they hang off the outside; below that they tuck flush
            against the inner-left edge. The gap separates close from navigation. */}
        <div className="absolute top-4 left-0 z-10 flex flex-col gap-2">
          <div className={edgeBox}>
            <SheetClose
              render={
                <Button variant="ghost" size="icon-sm" className="h-10 w-8" />
              }
            >
              <IconX />
              <span className="sr-only">Close</span>
            </SheetClose>
          </div>
          {total && total > 1 ? (
            <div className={edgeBox}>
              <IconButton
                label="Previous opportunity"
                side="right"
                size="icon-sm"
                className="h-10 w-8"
                disabled={!onPrev}
                onClick={onPrev}
              >
                <IconChevronUp />
              </IconButton>
              <span
                className="flex flex-col items-center gap-0.5 border-t px-1 py-1.5 text-xs font-medium leading-none text-muted-foreground tabular-nums"
                role="img"
                aria-label={`Opportunity ${position} of ${total}`}
              >
                <span>{position}</span>
                <span className="h-px w-3 bg-border" aria-hidden />
                <span>{total}</span>
              </span>
              <IconButton
                label="Next opportunity"
                side="right"
                size="icon-sm"
                className="h-10 w-8 border-t"
                disabled={!onNext}
                onClick={onNext}
              >
                <IconChevronDown />
              </IconButton>
            </div>
          ) : null}
        </div>
        <div className="flex h-full flex-col overflow-y-auto">
          {/* pl clears the flush close tab below lg, where it sits inside the edge. */}
          <SheetHeader className="pl-12 lg:pl-4">
            {detail ? (
              <OpportunityHeader
                detail={detail}
                refresh={refresh}
                onDeleted={() => onOpenChange(false)}
              />
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
              currentStaff={currentStaff}
              canCreateProject={canCreateProject}
              slackEnabled={slackEnabled}
              refresh={refresh}
            />
          ) : (
            <p className="px-4 pb-4 text-sm text-muted-foreground">
              {/* `detail === null` = loaded but not found (vs `undefined` = still loading). */}
              {result.serverError || result.data?.detail === null
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
  currentStaff,
  canCreateProject,
  slackEnabled,
  refresh,
}: {
  detail: OpportunityDetail;
  currentStaff: EntityOption | null;
  canCreateProject: boolean;
  slackEnabled: boolean;
  refresh: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <Tabs defaultValue="details">
        <TabsList variant="line">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="project-plan">Project plan</TabsTrigger>
        </TabsList>

        {/* Info as a left meta column, tasks/notes filling the right. Stacks
            to a single column below lg, where the drawer is narrower. */}
        <TabsContent
          value="details"
          className="grid grid-cols-1 gap-6 pt-4 lg:grid-cols-[18rem_1fr] lg:gap-8"
        >
          <div className={cn("flex flex-col gap-3", COMPACT_META_FIELDS)}>
            <LineOfBusinessField detail={detail} refresh={refresh} />
            <SourceField detail={detail} refresh={refresh} />
            <CompanyField detail={detail} refresh={refresh} />
            <ContactsField detail={detail} refresh={refresh} />
            <OwnersField detail={detail} refresh={refresh} />
            {/* Divided off from the fields above because it's the rail's only
                *external* fact — a pointer out to Slack, not another attribute of
                the opportunity. Only the scoping channel lives here; a project's
                channel is managed on the project's own page. */}
            <div className="border-t pt-3">
              <SlackChannelField
                kind="scoping"
                recordId={detail.id}
                sourceName={detail.name}
                channel={detail.slack}
                label="Scoping channel"
                // The drawer only mounts for `crm.edit` users (gated on the
                // board), which is exactly this kind's gate.
                canManage
                enabled={slackEnabled}
                currentStaff={currentStaff}
                onChanged={refresh}
              />
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">
                Next steps{" "}
                <span className="text-muted-foreground">
                  {detail.tasks.length}
                </span>
              </h3>
              <TaskList
                variant="opportunity"
                parentId={detail.id}
                tasks={detail.tasks}
                canEdit
                currentStaff={currentStaff}
                onChanged={refresh}
              />
            </section>
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">
                Notes{" "}
                <span className="text-muted-foreground">
                  {detail.notes.length}
                </span>
              </h3>
              <EntryLog
                variant="opportunity"
                parentId={detail.id}
                entries={detail.notes}
                canEdit
                onChanged={refresh}
              />
            </section>
          </div>
        </TabsContent>

        <TabsContent value="project-plan" className="pt-4">
          <OpportunityProjectPlan
            opportunityId={detail.id}
            company={detail.company}
            lineOfBusiness={detail.lineOfBusiness}
            canManage={canCreateProject}
            // Refresh the drawer's own detail so the status guard sees the link.
            onProjectLinked={refresh}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * The drawer header: the opportunity name (edited in place via the same
 * confirm/cancel workflow as the Info fields), with the status as a direct-edit
 * select on the right. The company lives in the Info tab as its own editable
 * field. A visually-hidden `SheetTitle` keeps a stable accessible name for the
 * dialog while the visible name field swaps between read and edit modes; a
 * visually-hidden `SheetDescription` satisfies the dialog's description slot.
 */
function OpportunityHeader({
  detail,
  refresh,
  onDeleted,
}: FieldProps & { onDeleted: () => void }) {
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
        <div className="flex items-start gap-2">
          <HeaderStatusField detail={detail} refresh={refresh} />
          <OpportunityActionsMenu detail={detail} onDeleted={onDeleted} />
        </div>
      </div>
    </>
  );
}

/**
 * The header's overflow menu (a 3-dots dropdown), holding destructive/rare
 * actions off to the side. Currently just Delete: it opens a confirm, and on
 * confirm deletes the opportunity. If it has a project, the server cleans up its
 * delivery footprint first (deletes the project when this opportunity solely
 * owns it, else removes just its roles and unlinks). On success the drawer
 * closes; the board refreshes via revalidation.
 */
function OpportunityActionsMenu({
  detail,
  onDeleted,
}: {
  detail: OpportunityDetail;
  onDeleted: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const remove = useAction(deleteOpportunity, {
    onSuccess: () => {
      toast.success("Opportunity deleted.");
      setConfirmOpen(false);
      onDeleted();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't delete the opportunity."),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Opportunity actions"
            >
              <IconDotsVertical />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
          >
            <IconTrash />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(next) => {
          if (!remove.isPending) setConfirmOpen(next);
        }}
        title="Delete opportunity?"
        description={
          detail.project
            ? `Delete "${detail.name}"? Its project's roles from this opportunity are removed, and the project is deleted if nothing else uses it. This can't be undone.`
            : `Delete "${detail.name}"? This can't be undone.`
        }
        confirmLabel="Delete opportunity"
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.execute({ id: detail.id })}
      />
    </>
  );
}
