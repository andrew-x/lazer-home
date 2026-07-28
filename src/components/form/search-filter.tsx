"use client";

import { IconSearch } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { FilterLabel } from "@/components/form/filters";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  buildListHref,
  firstParam,
  type SearchParams,
} from "@/lib/core/list-href";

/**
 * The URL-backed text search shared by every list filter bar (companies,
 * contacts, opportunities, projects). Owns the local input state and pushes the
 * settled value into the `q` param, so a bar only has to render
 * {@link SearchFilter} with what this returns.
 *
 * `currentQuery` is the value in the URL — bars use it for their `hasFilters`
 * check (whether to offer "Clear filters").
 */
export function useUrlSearchFilter({
  basePath,
  pageKey,
  params,
}: {
  /** The list route the search navigates within, e.g. `/contacts`. */
  basePath: string;
  /** The page param to drop on a search change (a new search resets to page 1). */
  pageKey: string;
  params: SearchParams;
}): {
  search: string;
  setSearch: (next: string) => void;
  currentQuery: string;
} {
  const router = useRouter();
  const currentQuery = firstParam(params.q);

  const [search, setSearch] = useState(currentQuery);
  const debouncedSearch = useDebouncedValue(search, 300);

  // Keep the input in sync when the URL query changes from outside (e.g. the
  // Clear button or a back-navigation).
  useEffect(() => {
    setSearch(currentQuery);
  }, [currentQuery]);

  // Debounce search → URL: navigate once typing settles, and only when the
  // trimmed value actually differs from what's already in the URL. Waiting for
  // the debounced value to catch up to `search` skips the transient window right
  // after an external sync (Clear/back), where `search` was just reset but the
  // debounced shadow still holds the old text.
  useEffect(() => {
    if (debouncedSearch !== search) return;
    const next = debouncedSearch.trim();
    if (next === currentQuery) return;
    router.replace(
      buildListHref(basePath, pageKey, params, { q: next || null }),
    );
  }, [
    debouncedSearch,
    search,
    currentQuery,
    params,
    router,
    basePath,
    pageKey,
  ]);

  return { search, setSearch, currentQuery };
}

/**
 * The labelled search box itself — a magnifier-prefixed input that flexes to
 * fill the filter row. Pair with {@link useUrlSearchFilter}, which owns the
 * debounce and the navigation.
 */
export function SearchFilter({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  const searchId = useId();
  return (
    <div className="flex min-w-56 flex-1 flex-col gap-1.5">
      <FilterLabel htmlFor={searchId}>Search</FilterLabel>
      <div className="relative">
        <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={searchId}
          type="search"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="pl-9"
        />
      </div>
    </div>
  );
}
