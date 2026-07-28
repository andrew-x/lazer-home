"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { commitCompensationPlan } from "@/actions/performance/commitCompensationPlan";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/format/format";

/**
 * Confirm committing a plan.
 *
 * The copy is doing real work here: commit writes ratings but deliberately does
 * NOT change anyone's pay, and that asymmetry has to be unmistakable before an
 * irreversible action. Incomplete rows are surfaced as a warning rather than a
 * block — a plan can legitimately be committed with some conversations still
 * open.
 */
export function CommitPlanDialog({
  planId,
  planName,
  effectiveDate,
  staffCount,
  incompleteCount,
  open,
  onOpenChange,
}: {
  planId: string;
  planName: string;
  effectiveDate: string;
  staffCount: number;
  incompleteCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  const { execute, isPending, result } = useAction(commitCompensationPlan, {
    onSuccess: ({ data }) => {
      onOpenChange(false);
      toast.success(
        `${planName} committed — ${data?.ratingsWritten ?? 0} ratings recorded.`,
      );
      router.refresh();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Commit “{planName}”?</DialogTitle>
          <DialogDescription>
            This can't be undone, and the plan becomes read-only.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          <p>
            Each of the {staffCount} people in this plan will have their
            proposed rating recorded as their current rating, effective{" "}
            <span className="font-medium">{formatDate(effectiveDate)}</span>.
            People whose rating hasn't changed are skipped.
          </p>
          <p className="rounded-md border px-3 py-2 text-muted-foreground">
            Compensation is <span className="font-medium">not</span> changed.
            Rippling stays the system of record for pay — the planned figures
            remain a proposal, and this plan will flag anyone whose pay hasn't
            been updated there yet.
          </p>
          {incompleteCount > 0 ? (
            <p className="text-destructive">
              {incompleteCount === 1
                ? "1 person isn't marked complete."
                : `${incompleteCount} people aren't marked complete.`}{" "}
              You can still commit.
            </p>
          ) : null}
        </div>

        {result.serverError ? (
          <p className="text-sm text-destructive">{result.serverError}</p>
        ) : null}

        <DialogFooter>
          <DialogClose
            render={
              <Button type="button" variant="outline">
                Cancel
              </Button>
            }
          />
          <Button
            type="button"
            loading={isPending}
            onClick={() => execute({ planId })}
          >
            Commit plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
