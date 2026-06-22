"use client";

import { IconUserShield } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { promoteSelfToAdmin } from "@/actions/admin/promoteSelfToAdmin";
import { Button } from "@/components/ui/button";

/**
 * Local-only bootstrap button: grants the current user the `admin` role so they
 * can use the admin-API-gated tools (e.g. saving role/ban changes here). Rendered
 * by the page only when running locally and the user isn't already an admin.
 */
export function PromoteSelfButton() {
  const router = useRouter();
  const action = useAction(promoteSelfToAdmin, {
    onSuccess: () => {
      toast.success("You're now an admin.");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Failed to promote."),
  });

  return (
    <Button
      variant="outline"
      onClick={() => action.execute()}
      loading={action.isExecuting}
    >
      <IconUserShield className="size-4" />
      Promote myself to admin
    </Button>
  );
}
