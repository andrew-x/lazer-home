"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
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
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="space-y-2">
        <p className="text-sm font-medium text-destructive">
          Something went wrong
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          An unexpected error occurred
        </h1>
        <p className="max-w-md text-muted-foreground">
          Try again, or head back home if the problem persists.
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
    </main>
  );
}
