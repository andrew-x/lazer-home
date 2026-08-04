"use client";

import { IconBrandSlack, IconHash, IconUnlink } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { linkSlackChannel } from "@/actions/slack/linkSlackChannel";
import { suggestSlackChannel } from "@/actions/slack/suggestSlackChannel";
import { unlinkSlackChannel } from "@/actions/slack/unlinkSlackChannel";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ExternalLink } from "@/components/external-link";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { FormField } from "@/components/form/form-field";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import {
  formatSlackChannel,
  type SlackChannelKind,
  type SlackChannelRef,
} from "@/lib/slack/channel";
import { SlackChannelDialog } from "./slack-channel-dialog";
import { SlackChannelSuggestion } from "./slack-channel-suggestion";

/**
 * One record's Slack channel slot — the single unit both surfaces use (the
 * opportunity drawer's scoping channel, the project page's delivery channel).
 *
 * Sized for a detail page's meta rail: the linked state is a channel name and an
 * unlink button, no wider than a contacts row. Everything bulky lives in the
 * dialog. It carries `data-slot="field-value"` so the rail's density rules apply
 * without this component knowing about them.
 */
export function SlackChannelField({
  kind,
  recordId,
  sourceName,
  channel,
  label,
  canManage,
  enabled,
  currentStaff,
  onChanged,
}: {
  kind: SlackChannelKind;
  /**
   * The id of the record that OWNS the column — an opportunity for `scoping`, a
   * project for `project`. Never the other one.
   */
  recordId: string;
  /** The record's name; the channel name is derived from it. */
  sourceName: string;
  channel: SlackChannelRef | null;
  label: string;
  canManage: boolean;
  /** False when no Slack bot token is configured. */
  enabled: boolean;
  currentStaff: EntityOption | null;
  /**
   * Called after a successful write. Surfaces that refetch their own payload pass
   * their refresh here; ones that rely on `revalidatePath` can omit it.
   */
  onChanged?: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const changed = () => onChanged?.();

  const suggest = useAction(suggestSlackChannel);

  const link = useAction(linkSlackChannel, {
    onSuccess: () => {
      // In-place action (not a dialog), so it confirms with a toast.
      toast.success("Slack channel linked.");
      changed();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't link the channel."),
  });

  const unlink = useAction(unlinkSlackChannel, {
    onSuccess: () => {
      setConfirmUnlink(false);
      toast.success("Slack channel unlinked.");
      changed();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't unlink the channel."),
  });

  // Whether to offer the setup control. Deliberately NOT gated on `enabled`: the
  // button shows even with no bot token, because a control you can reach and a
  // reason it won't work teach more than an absent control does. Clicking through
  // fails with "Slack isn't connected" from the action rather than silently.
  const canSetUp = canManage;

  // Only ask Slack for a suggestion when there's an empty slot someone could
  // actually fill AND a connection to ask over. This is the one part of the feature
  // that costs a round-trip, which is why it runs after render rather than in the
  // page's read — and why it stays gated on `enabled` when the button no longer is.
  const wantsSuggestion = enabled && canSetUp && !channel;
  useEffect(() => {
    if (!wantsSuggestion) return;
    suggest.execute({ kind, recordId });
  }, [wantsSuggestion, kind, recordId, suggest.execute]);

  // The only case with nothing to say: no channel, no ability to add one, and no
  // connection that could produce one. Anyone who *could* set it up sees the
  // control regardless of the token — hiding it from them made the feature
  // undiscoverable, since the person whose job it is to connect Slack was the one
  // certain never to learn the slot existed.
  //
  // An existing link always renders, token or not: `app_redirect` is just a URL and
  // needs no bot, so dropping it because a token was removed would lose information
  // for nothing. Unlinking still works too — it's app-side only.
  if (!enabled && !channel && !canManage) return null;

  const suggestion = suggest.result.data?.suggestion ?? null;
  // Deliberately NOT gated on `link.isPending`: the suggestion row owns the Link
  // button's spinner, so hiding it mid-request would unmount the thing showing
  // progress. It disappears when the refreshed payload arrives with the channel.
  const showSuggestion = suggestion !== null && !dismissed;

  return (
    <>
      <FormField
        label={label}
        labelAction={
          channel && canManage ? (
            <IconButton
              label={`Unlink ${label.toLowerCase()}`}
              onClick={() => setConfirmUnlink(true)}
            >
              <IconUnlink />
            </IconButton>
          ) : null
        }
      >
        <div data-slot="field-value" className="min-h-8 py-1 text-sm">
          {channel ? (
            <ExternalLink
              href={channel.url}
              className="flex items-center gap-1.5"
            >
              <IconBrandSlack className="size-4 shrink-0" />
              <span className="truncate">
                {formatSlackChannel(channel.name)}
              </span>
            </ExternalLink>
          ) : canSetUp ? (
            <div className="flex flex-col items-start gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDialogOpen(true)}
              >
                <IconHash />
                Create or link
              </Button>
              {!enabled ? (
                // The button stays live, so this is the only thing telling you why
                // it will fail. Not a tooltip on a disabled button: the fix is an
                // env var an admin sets, not anything actionable in the app.
                <span className="text-xs text-muted-foreground">
                  Slack isn&apos;t connected
                </span>
              ) : null}
              {showSuggestion && suggestion ? (
                <SlackChannelSuggestion
                  channelName={suggestion.channelName}
                  pending={link.isPending}
                  onLink={() =>
                    link.execute({
                      kind,
                      recordId,
                      channelId: suggestion.channelId,
                    })
                  }
                  onDismiss={() => setDismissed(true)}
                />
              ) : null}
            </div>
          ) : (
            // No channel and no ability to add one. Only reachable while the
            // integration is connected — the early return covers the other case.
            <span className="text-muted-foreground">Not linked</span>
          )}
        </div>
      </FormField>

      {canSetUp ? (
        <SlackChannelDialog
          kind={kind}
          recordId={recordId}
          sourceName={sourceName}
          currentStaff={currentStaff}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onDone={changed}
        />
      ) : null}

      {channel ? (
        <ConfirmDialog
          open={confirmUnlink}
          onOpenChange={setConfirmUnlink}
          title={`Unlink ${formatSlackChannel(channel.name)}?`}
          description="The channel stays in Slack with all its history and members — this only clears the link here."
          confirmLabel="Unlink"
          destructive
          loading={unlink.isPending}
          onConfirm={() => unlink.execute({ kind, recordId })}
        />
      ) : null}
    </>
  );
}
