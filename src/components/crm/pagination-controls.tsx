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
      <div className="flex gap-2">
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
