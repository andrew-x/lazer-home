"use client";

import { IconTrash } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { deleteCompensationPlan } from "@/actions/performance/deleteCompensationPlan";
import type { CompensationPlanListRow } from "@/actions/performance/getCompensationPlans";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { IconButton } from "@/components/icon-button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatTimestamp } from "@/lib/format/format";
import { COMPENSATION_PLAN_STATUS_LABELS } from "@/lib/performance/compensation-plan";
import { NewPlanDialog } from "./new-plan-dialog";

export function PlansList({ plans }: { plans: CompensationPlanListRow[] }) {
  const router = useRouter();
  // The plan pending deletion, held here so the confirm dialog can name it.
  const [pendingDelete, setPendingDelete] =
    useState<CompensationPlanListRow | null>(null);

  const remove = useAction(deleteCompensationPlan, {
    onSuccess: () => {
      setPendingDelete(null);
      toast.success("Plan deleted.");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't delete that plan."),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <NewPlanDialog />
      </div>

      {plans.length === 0 ? (
        <EmptyState bordered>
          No compensation plans yet. Create one to start a review round.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead className="text-right">Staff</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created by</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell>
                    <Link
                      href={`/people/compensation-plans/${plan.id}`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {plan.name}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(plan.effectiveDate)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {plan.staffCount}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        plan.status === "COMMITTED" ? "secondary" : "outline"
                      }
                    >
                      {COMPENSATION_PLAN_STATUS_LABELS[plan.status]}
                    </Badge>
                    {plan.committedAt ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {formatTimestamp(plan.committedAt)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {plan.createdByName ?? "—"}
                  </TableCell>
                  <TableCell className="w-8">
                    {/* Committed plans are the record of what was decided, and
                        their ratings are already live — only drafts can go. */}
                    {plan.status === "DRAFT" ? (
                      <IconButton
                        label={`Delete ${plan.name}`}
                        size="icon"
                        onClick={() => setPendingDelete(plan)}
                      >
                        <IconTrash />
                      </IconButton>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={`Delete “${pendingDelete?.name}”?`}
        description="This discards the plan and every proposed rating, figure and note in it. It can't be undone."
        confirmLabel="Delete plan"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (pendingDelete) remove.execute({ planId: pendingDelete.id });
        }}
      />
    </div>
  );
}
