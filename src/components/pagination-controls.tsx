import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import Link from "next/link";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { buildListHref, type SearchParams } from "@/lib/core/list-href";

/**
 * Builds a `basePath` href that changes only `paramKey` to `page`, preserving
 * every other current query param (so multiple tables paginate independently).
 */
function buildHref(
  basePath: string,
  params: SearchParams,
  paramKey: string,
  page: number,
): string {
  return buildListHref(basePath, paramKey, params, {
    [paramKey]: String(page),
  });
}

const ELLIPSIS = "…";

/** One slot in the pagination strip: a page link, or an ellipsis gap marker. */
type PageSlot =
  | { kind: "page"; page: number }
  | { kind: "ellipsis"; key: string };

/**
 * The windowed list of slots to render: always the first and last page, a ±1
 * window around the current page, and an ellipsis marker wherever there's a gap.
 * Small ranges (≤7 pages) show every page with no ellipsis. Each ellipsis keys
 * off the page it follows, so the list has stable React keys.
 */
function pageWindow(page: number, pageCount: number): PageSlot[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => ({
      kind: "page" as const,
      page: i + 1,
    }));
  }
  const wanted = [1, pageCount, page, page - 1, page + 1]
    .filter((p) => p >= 1 && p <= pageCount)
    .sort((a, b) => a - b);

  const result: PageSlot[] = [];
  let prev = 0;
  for (const p of wanted) {
    if (p === prev) continue; // de-dupe overlapping window edges
    if (p - prev > 1) result.push({ kind: "ellipsis", key: `gap-${prev}` });
    result.push({ kind: "page", page: p });
    prev = p;
  }
  return result;
}

/**
 * How one page button navigates: `render` for a real link, `onClick` for an
 * in-memory table. Spread straight onto a `Button`.
 */
type SlotProps = Pick<ComponentProps<typeof Button>, "render" | "onClick">;

/**
 * Server-paginated lists: every page is a link, so the current page lives in the
 * URL and is shareable. The default.
 */
export function PaginationControls({
  basePath,
  params,
  paramKey,
  page,
  pageCount,
}: {
  basePath: string;
  params: SearchParams;
  paramKey: string;
  page: number;
  pageCount: number;
}) {
  return (
    <PaginationStrip
      page={page}
      pageCount={pageCount}
      slotProps={(target) => ({
        render: <Link href={buildHref(basePath, params, paramKey, target)} />,
      })}
    />
  );
}

/**
 * Client-paginated tables: the page is component state and paging never touches
 * the URL. Use this when the rows are **already** in the client — routing the
 * page through the URL would re-run the server component and refetch everything
 * just to slice an array (the utilization report's two per-person tables).
 */
export function ClientPaginationControls({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <PaginationStrip
      page={page}
      pageCount={pageCount}
      slotProps={(target) => ({ onClick: () => onPageChange(target) })}
    />
  );
}

/** The shared control strip, agnostic about how a page button navigates. */
function PaginationStrip({
  page,
  pageCount,
  slotProps,
}: {
  page: number;
  pageCount: number;
  slotProps: (target: number) => SlotProps;
}) {
  const hasPrev = page > 1;
  const hasNext = page < pageCount;

  return (
    <div className="flex items-center justify-between gap-4 border-t px-2 py-2">
      <p className="text-sm text-muted-foreground">
        Page {page} of {pageCount}
      </p>
      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Button variant="outline" size="sm" {...slotProps(page - 1)}>
            <IconChevronLeft />
            Previous
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <IconChevronLeft />
            Previous
          </Button>
        )}

        {/* Numbered page links — hidden on the narrowest viewports where the
            Prev/Next pair and the "Page X of Y" caption already suffice. */}
        {pageCount > 1 ? (
          <div className="hidden items-center gap-1 sm:flex">
            {pageWindow(page, pageCount).map((slot) =>
              slot.kind === "ellipsis" ? (
                <span
                  key={slot.key}
                  className="px-1 text-sm text-muted-foreground"
                >
                  {ELLIPSIS}
                </span>
              ) : slot.page === page ? (
                <Button
                  key={slot.page}
                  variant="default"
                  size="sm"
                  className="min-w-9"
                  aria-current="page"
                >
                  {slot.page}
                </Button>
              ) : (
                <Button
                  key={slot.page}
                  variant="outline"
                  size="sm"
                  className="min-w-9"
                  {...slotProps(slot.page)}
                >
                  {slot.page}
                </Button>
              ),
            )}
          </div>
        ) : null}

        {hasNext ? (
          <Button variant="outline" size="sm" {...slotProps(page + 1)}>
            Next
            <IconChevronRight />
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
            <IconChevronRight />
          </Button>
        )}
      </div>
    </div>
  );
}
