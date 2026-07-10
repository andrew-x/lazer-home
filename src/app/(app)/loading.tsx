import { Skeleton } from "@/components/ui/skeleton";

// Neutral, shape-agnostic fallback shown while any (app) route streams in —
// tables, kanban boards, and card grids all sit behind this, so it stays a
// header bar plus a few full-width bars rather than any one page's silhouette.
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
