"use client";

import { IconCheck, IconPencil, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { IconButton } from "@/components/icon-button";
import { Input } from "@/components/ui/input";
import { useProjectInlineSave } from "./use-project-inline-save";

/**
 * The project's name, rendered as the sidebar's heading but editable in place
 * (confirm/cancel) — the same treatment as the opportunity drawer's
 * `HeaderNameField`. Deliberately *not* an `InlineEditField`: that would swap the
 * `<h2>` for a label/value pair and lose the page's heading.
 *
 * Gated by the caller on `canEdit` (`projects.edit`); read-only viewers get the plain
 * heading with no pencil.
 */
export function ProjectNameField({
  projectId,
  name,
  canEdit,
}: {
  projectId: string;
  name: string;
  canEdit: boolean;
}) {
  const save = useProjectInlineSave(projectId);
  const [draft, setDraft] = useState(name);

  if (!canEdit) {
    return (
      <h2 className="font-heading text-lg font-semibold tracking-tight">
        {name}
      </h2>
    );
  }

  if (save.editing) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Project name"
            aria-invalid={Boolean(save.error)}
            autoFocus
          />
          <IconButton
            label="Save project name"
            onClick={() => save.commit({ field: "name", name: draft })}
            loading={save.isPending}
          >
            <IconCheck />
          </IconButton>
          <IconButton
            label="Cancel editing project name"
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
      <h2 className="font-heading text-lg font-semibold tracking-tight">
        {name}
      </h2>
      <IconButton
        label="Edit project name"
        onClick={() => {
          setDraft(name);
          save.open();
        }}
      >
        <IconPencil />
      </IconButton>
    </div>
  );
}
