import { Skeleton } from "@/components/ui/skeleton";

// Neutral, shape-agnostic fallback shown while any /admin route streams in —
// the tools (staff/PTO upload, bulk-edit, manage users) all sit behind this, so
// it stays a header bar plus a few full-width bars rather than any one tool's
// silhouette. Renders inside the admin layout's <main>, below its header.
export default function Loading() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="flex flex-col gap-3">
        {["a", "b", "c", "d"].map((key) => (
          <Skeleton key={key} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
