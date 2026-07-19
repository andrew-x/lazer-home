import { IconCheck, IconLoader2 } from "@tabler/icons-react";
import type { SaveState } from "./use-response-autosave";

/** Subtle inline autosave status (never a toast), shared by the profile survey
 * editors. `label` lets a section-based survey say "This section saves…". */
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
export function aggregateSaveState(states: SaveState[]): SaveState {
  if (states.includes("error")) return "error";
  if (states.includes("saving")) return "saving";
  if (states.includes("saved")) return "saved";
  return "idle";
}
