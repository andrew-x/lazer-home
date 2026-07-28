import { IconCheck, IconLoader2 } from "@tabler/icons-react";
import type { SaveState } from "@/hooks/use-autosave-queue";

/**
 * Subtle inline autosave status — never a toast. Shared by every save-on-edit
 * surface (the profile survey editors, the compensation-plan editor), so the
 * wording and iconography of "your work is being kept" stay identical wherever
 * autosave appears. `label` carries the idle-state copy, which is the only part
 * that differs per surface.
 */
export function SaveIndicator({
  state,
  label = "Your answers save automatically.",
}: {
  state: SaveState;
  label?: string;
}) {
  if (state === "idle") {
    return <p className="text-xs text-muted-foreground">{label}</p>;
  }
  if (state === "saving") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <IconLoader2 className="size-3.5 animate-spin" />
        Saving…
      </p>
    );
  }
  if (state === "error") {
    return (
      <p className="text-xs text-destructive">
        Couldn't save — check your connection; we'll retry as you edit.
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <IconCheck className="size-3.5 text-primary" />
      Saved
    </p>
  );
}

/** Collapse several fields' save states into one indicator for a section. */
export function aggregateSaveState(states: readonly SaveState[]): SaveState {
  if (states.includes("error")) return "error";
  if (states.includes("saving")) return "saving";
  if (states.includes("saved")) return "saved";
  return "idle";
}
