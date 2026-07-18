"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// Scoped to the /admin segment so a thrown read renders INSIDE the admin layout
// — its header stays put (mirrors admin/loading.tsx, which also keeps the
// layout). The root src/app/error.tsx is the full-screen fallback for anything
// above it. Note: this Next build's retry prop is `unstable_retry`, not `reset`
// (see .claude/rules/ui.md).
export default function AdminError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col items-center justify-center gap-6 py-24 text-center">
      <div className="space-y-2">
        <p className="text-sm font-medium text-destructive">
          Something went wrong
        </p>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          This tool couldn't load
        </h2>
        <p className="max-w-md text-muted-foreground">
          Try again, or head back to the app if the problem persists.
        </p>
      </div>
      <div className="flex gap-3">
        <Button type="button" onClick={() => unstable_retry()}>
          Try again
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            window.location.href = "/";
          }}
        >
          Go home
        </Button>
      </div>
    </div>
  );
}
