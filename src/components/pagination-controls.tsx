import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type SearchParams = Record<string, string | string[] | undefined>;

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
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === paramKey) continue; // replaced below
    if (typeof value === "string") {
      sp.append(key, value);
    } else if (Array.isArray(value)) {
      for (const v of value) sp.append(key, v);
    }
  }
  sp.set(paramKey, String(page));
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
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
  const hasPrev = page > 1;
  const hasNext = page < pageCount;

  return (
    <div className="flex items-center justify-between gap-4 border-t px-2 py-2">
      <p className="text-sm text-muted-foreground">
        Page {page} of {pageCount}
      </p>
      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Button
            variant="outline"
            size="sm"
            render={
              <Link href={buildHref(basePath, params, paramKey, page - 1)} />
            }
          >
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
                  render={
                    <Link
                      href={buildHref(basePath, params, paramKey, slot.page)}
                    />
                  }
                >
                  {slot.page}
                </Button>
              ),
            )}
          </div>
        ) : null}

        {hasNext ? (
          <Button
            variant="outline"
            size="sm"
            render={
              <Link href={buildHref(basePath, params, paramKey, page + 1)} />
            }
          >
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
