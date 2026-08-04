"use client";

import { IconX } from "@tabler/icons-react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";

/**
 * "We found #l-project-acme — is this it?", offered inside an empty channel slot.
 *
 * Deliberately **not** an `InlineNotice`: a bordered strip is too much weight for a
 * guess, and that component's tones read as *FYI* or *problem*, while this is an
 * affordance. Sitting inside the slot also means it never has to say which slot it
 * belongs to.
 *
 * Dismissal is the caller's component state, not persisted. It's a quiet line in
 * an already-empty field rather than an interruption, so re-offering it after a
 * reopen costs nothing — and persisting it per-browser would mean dismissing on a
 * laptop and seeing it again on a desktop.
 */
export function SlackChannelSuggestion({
  channelName,
  pending,
  onLink,
  onDismiss,
}: {
  /** Display-shaped, `#` included — the action returns it that way. */
  channelName: string;
  pending: boolean;
  onLink: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="min-w-0 truncate">
        Found <span className="font-medium">{channelName}</span>
      </span>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
        loading={pending}
        onClick={onLink}
      >
        Link
      </Button>
      <IconButton
        label="Dismiss suggestion"
        // Smaller than the standard icon button: this sits on a `text-xs` line
        // inside a field, not on a label row.
        className="size-6"
        onClick={onDismiss}
        disabled={pending}
      >
        <IconX />
      </IconButton>
    </div>
  );
}
