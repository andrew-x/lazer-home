"use client";

import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { deleteSelfEvaluation } from "@/actions/performance/deleteSelfEvaluation";
import type {
  SelfEvaluationRow,
  StaffSelfEvaluationsView,
} from "@/actions/performance/getStaffSelfEvaluations";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { SelfEvaluationForm } from "@/components/performance/self-evaluation-form";
import { SelfEvaluationRecord } from "@/components/performance/self-evaluation-record";
import { Button } from "@/components/ui/button";

/**
 * The **Self-evaluations** tab: a person's own periodic reflections, newest first.
 *
 * Rendered on `/profile`, `/staff/[id]`, and inside the compensation-plan profile
 * drawer. What each viewer may see and do is decided server-side
 * (`getStaffSelfEvaluations`); this component only renders the affordances it was
 * told about — never its own permission logic.
 *
 * `readOnly` is the one exception, and it is a **host display constraint, not a
 * permission**: the drawer sets it so that a viewer who happens to be looking at
 * their own profile there doesn't get a seven-textarea form inside a sheet layered
 * over a mid-edit plan editor. It narrows nothing the server allows — writing is
 * still gated by `authorizeSelfEvaluationMutate`, and "Open full profile" is the way
 * to actually do it.
 *
 * `onChanged` lets a client-fetched host (the drawer) re-load. Server-rendered pages
 * get `revalidatePath` from the actions plus the `router.refresh()` below.
 */
export function SelfEvaluationPanel({
  staffName,
  view,
  onChanged,
  readOnly = false,
}: {
  staffName: string;
  view: StaffSelfEvaluationsView;
  onChanged?: () => void;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SelfEvaluationRow | null>(null);

  function afterChange() {
    if (onChanged) onChanged();
    else router.refresh();
  }

  const remove = useAction(deleteSelfEvaluation, {
    onSuccess: () => {
      toast.success("Self-evaluation deleted.");
      setDeleting(null);
      afterChange();
    },
    onError: ({ error }) => {
      toast.error(error.serverError ?? "Couldn't delete that self-evaluation.");
    },
  });

  const canCreate = view.canCreate && !readOnly;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {view.isSelf
            ? "Your own periodic reflections on how the last while has gone. Managers who can see your evaluations can read these."
            : `Self-evaluations ${staffName} has written about their own work.`}
        </p>
        {canCreate && !composing ? (
          <Button
            size="sm"
            className="shrink-0"
            onClick={() => setComposing(true)}
          >
            <IconPlus />
            Start a self-evaluation
          </Button>
        ) : null}
      </div>

      {composing ? (
        <div className="rounded-md border p-4">
          <SelfEvaluationForm
            mode="create"
            onSaved={() => {
              setComposing(false);
              afterChange();
            }}
            onCancel={() => setComposing(false)}
          />
        </div>
      ) : null}

      {view.evaluations.length === 0 && !composing ? (
        <EmptyState bordered>
          {view.isSelf
            ? "You haven't written a self-evaluation yet."
            : `${staffName} hasn't written a self-evaluation yet.`}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {view.evaluations.map((evaluation) => (
            <li key={evaluation.id} className="rounded-md border p-4">
              {editingId === evaluation.id ? (
                <SelfEvaluationForm
                  evaluation={evaluation}
                  onSaved={() => {
                    setEditingId(null);
                    afterChange();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <SelfEvaluationRecord
                  evaluation={evaluation}
                  actions={
                    evaluation.canManage && !readOnly ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingId(evaluation.id)}
                        >
                          <IconPencil />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleting(evaluation)}
                        >
                          <IconTrash />
                          Delete
                        </Button>
                      </>
                    ) : undefined
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete this self-evaluation?"
        description="Managers who can see your self-evaluations will lose access to this one. It can't be recovered."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.execute({ evaluationId: deleting.id });
        }}
      />
    </div>
  );
}
