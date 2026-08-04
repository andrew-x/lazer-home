"use client";

import { useAction } from "next-safe-action/hooks";
import { useMemo, useState } from "react";
import { toast } from "sonner";
// Two staff searches exist because they carry different gates (`crm.edit` vs
// `projects.edit`). Reuse that split rather than inventing a third search whose
// gate would have to cover both.
import { searchStaff as searchStaffForCrm } from "@/actions/crm/searchStaff";
import { searchStaff as searchStaffForProjects } from "@/actions/projects/searchStaff";
import { createSlackChannel } from "@/actions/slack/createSlackChannel";
import { linkSlackChannel } from "@/actions/slack/linkSlackChannel";
import { searchSlackChannels } from "@/actions/slack/searchSlackChannels";
import { EntityCombobox } from "@/components/form/entity-combobox";
import {
  EntityMultiCombobox,
  type EntityOption,
} from "@/components/form/entity-multi-combobox";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { InlineNotice } from "@/components/inline-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { SearchAction } from "@/lib/core/search";
import {
  buildSlackChannelCreateName,
  formatSlackChannel,
  SLACK_CHANNEL_IS_PRIVATE,
  type SlackChannelKind,
} from "@/lib/slack/channel";

const STAFF_SEARCH: Record<SlackChannelKind, SearchAction> = {
  scoping: searchStaffForCrm,
  project: searchStaffForProjects,
};

const COPY: Record<
  SlackChannelKind,
  { title: string; description: string; derivedFrom: string }
> = {
  scoping: {
    title: "Scoping channel",
    description:
      "A private channel for the pursuit team. Create one from the deal name, or link a channel that already exists.",
    derivedFrom: "opportunity",
  },
  project: {
    title: "Project channel",
    description:
      "A public channel for the delivery team. Create one from the project name, or link a channel that already exists.",
    derivedFrom: "project",
  },
};

/**
 * Set up a record's Slack channel: create a new one, or link an existing one.
 *
 * One dialog with both paths rather than two entry points — they share the same
 * explanation, and the field they're launched from has room for one control.
 * Create comes first, inverting the older `NoProjectState` layout: the name isn't
 * editable, so creating is a single confirm, and the "it already exists" case is
 * mostly caught upstream by the suggestion line.
 */
export function SlackChannelDialog({
  kind,
  recordId,
  sourceName,
  currentStaff,
  open,
  onOpenChange,
  onDone,
}: {
  kind: SlackChannelKind;
  recordId: string;
  /** The opportunity or project name the channel name is derived from. */
  sourceName: string;
  /** Defaults the invite list to the person doing this. */
  currentStaff: EntityOption | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  return (
    <FormDialog
      title={COPY[kind].title}
      description={COPY[kind].description}
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="sm:max-w-lg"
      // The opportunity surface is a Sheet, so the backdrop has to be forced or
      // the blur doesn't show over it. A no-op at top level, as on ConfirmDialog.
      forceMountOverlay
    >
      {({ close }) => (
        <SlackChannelForm
          kind={kind}
          recordId={recordId}
          sourceName={sourceName}
          currentStaff={currentStaff}
          close={close}
          onDone={onDone}
        />
      )}
    </FormDialog>
  );
}

function SlackChannelForm({
  kind,
  recordId,
  sourceName,
  currentStaff,
  close,
  onDone,
}: {
  kind: SlackChannelKind;
  recordId: string;
  sourceName: string;
  currentStaff: EntityOption | null;
  close: () => void;
  onDone: () => void;
}) {
  // The same pure builder the action calls, so this preview cannot disagree with
  // the channel that actually gets created — including the `test-` marker outside
  // production, which is exactly the part you want to see before clicking.
  const channelName = buildSlackChannelCreateName(kind, sourceName, recordId);
  const isPrivate = SLACK_CHANNEL_IS_PRIVATE[kind];

  // Defaults to the current user, and stays removable — the requirement is a
  // sensible default, not a locked member.
  const [invitees, setInvitees] = useState<EntityOption[]>(
    currentStaff ? [currentStaff] : [],
  );
  const [existing, setExisting] = useState<EntityOption | null>(null);

  // Referentially stable, or `EntityCombobox` re-runs its search every render.
  const searchArgs = useMemo(() => ({ kind }), [kind]);

  // Close first, then tell the parent. The other order lets a refetch swap the
  // parent's props — and potentially unmount this form — before `close()` runs.
  const finish = () => {
    close();
    onDone();
  };

  const create = useAction(createSlackChannel, {
    onSuccess: ({ data }) => {
      // Success closes the dialog with no toast (the house rule for dialog
      // flows), but a partial invite has to be said out loud somewhere — and by
      // then this dialog is gone.
      if (data?.warnings.length) toast.warning(data.warnings.join(" "));
      finish();
    },
  });

  const link = useAction(linkSlackChannel, { onSuccess: finish });

  // No react-hook-form: there are no registered inputs to validate — one chip
  // picker, one entity picker, and a read-only preview. Still a real <form> so
  // the footer's submit button works.
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        create.execute({
          kind,
          recordId,
          staffIds: invitees.map((invitee) => invitee.id),
        });
      }}
    >
      <FormField label="Channel name">
        <Input
          readOnly
          aria-readonly
          value={formatSlackChannel(channelName)}
          className="bg-muted/40"
        />
        <p className="text-xs text-muted-foreground">
          Derived from the {COPY[kind].derivedFrom} name; not editable. The
          channel will be {isPrivate ? "private" : "public"}.
        </p>
      </FormField>

      <FormField label="Invite">
        <EntityMultiCombobox
          value={invitees}
          onChange={setInvitees}
          searchAction={STAFF_SEARCH[kind]}
          placeholder="Search staff…"
        />
      </FormField>

      <div className="flex items-center gap-2">
        <Separator className="flex-1" />
        <span className="shrink-0 text-xs text-muted-foreground">
          or link an existing channel
        </span>
        <Separator className="flex-1" />
      </div>

      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <EntityCombobox
            value={existing}
            onChange={setExisting}
            searchAction={searchSlackChannels}
            searchArgs={searchArgs}
            placeholder="Search channels…"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!existing || link.isPending}
          loading={link.isPending}
          onClick={() =>
            existing && link.execute({ kind, recordId, channelId: existing.id })
          }
        >
          Link
        </Button>
      </div>

      {isPrivate ? (
        // Only on the private path, and sitting directly under the control it
        // explains — this is the one place the bot's private-channel blind spot
        // actually bites someone.
        <InlineNotice>
          Can&apos;t find it? Our Slack app only sees private channels it has
          been added to. Invite the app to the channel in Slack, then search
          again. Any name works — a channel you link doesn&apos;t need to follow
          the <code>l-scoping-</code> convention.
        </InlineNotice>
      ) : null}

      <FormDialogFooter
        serverError={create.result.serverError ?? link.result.serverError}
        submitLabel="Create channel"
        loading={create.isPending}
      />
    </form>
  );
}
