import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { buildListHref, type SearchParams } from "@/lib/core/list-href";
import { cn } from "@/lib/core/utils";

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

/** Shared geometry for every slot in the strip: a 24px-tall, square-ish cell. */
const CELL = "h-6 min-w-6 rounded-sm px-1.5 text-xs tabular-nums";
const QUIET = "text-muted-foreground hover:text-foreground";

/**
 * A step control (Prev/Next). Renders as a link when the step exists, and as a
 * disabled button otherwise so the strip's width never shifts between pages.
 */
function StepButton({
  href,
  children,
}: {
  href: string | undefined;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className={cn(CELL, "gap-0.5 px-1", QUIET)}
      disabled={href === undefined}
      {...(href !== undefined ? { render: <Link href={href} /> } : {})}
    >
      {children}
    </Button>
  );
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
  // Nothing to page through — don't spend a bar on two dead arrows.
  if (pageCount <= 1) return null;

  const href = (p: number) => buildHref(basePath, params, paramKey, p);

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-4 border-t px-2.5 py-1.5"
    >
      <p className="text-xs text-muted-foreground tabular-nums">
        Page {page} of {pageCount}
      </p>
      <div className="flex items-center gap-1">
        <StepButton href={page > 1 ? href(page - 1) : undefined}>
          <IconChevronLeft />
          Prev
        </StepButton>

        {/* Numbered page links — hidden on the narrowest viewports where the
            Prev/Next pair and the "Page X of Y" caption already suffice. */}
        <div className="hidden items-center gap-0.5 sm:flex">
          {pageWindow(page, pageCount).map((slot) =>
            slot.kind === "ellipsis" ? (
              <span
                key={slot.key}
                aria-hidden
                className="px-0.5 text-xs text-muted-foreground select-none"
              >
                {ELLIPSIS}
              </span>
            ) : slot.page === page ? (
              <Button
                key={slot.page}
                variant="default"
                size="xs"
                className={CELL}
                aria-current="page"
              >
                {slot.page}
              </Button>
            ) : (
              <Button
                key={slot.page}
                variant="ghost"
                size="xs"
                className={cn(CELL, QUIET)}
                render={<Link href={href(slot.page)} />}
              >
                {slot.page}
              </Button>
            ),
          )}
        </div>

        <StepButton href={page < pageCount ? href(page + 1) : undefined}>
          Next
          <IconChevronRight />
        </StepButton>
      </div>
    </nav>
  );
}
