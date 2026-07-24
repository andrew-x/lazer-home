"use client";

import { IconSearch } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { ALL, FilterLabel, SelectFilter } from "@/components/form/filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  COMPANY_STATUS_LABELS,
  COMPANY_STATUS_TAGS,
} from "@/lib/crm/company-status";

type SearchParams = Record<string, string | string[] | undefined>;

/** First string value of a param (mirrors how the page reads them). */
function str(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * Build a `/companies` href from the current params with `updates` applied (a
 * `null`/empty value drops the key), always resetting `companiesPage` so a
 * filter change returns to page 1. Preserves everything else. Mirrors
 * `pagination-controls`' buildHref and the opportunities list filters.
 */
function hrefWith(
  params: SearchParams,
  updates: Record<string, string | null>,
) {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "companiesPage" || key in updates) continue;
    if (typeof value === "string") sp.append(key, value);
    else if (Array.isArray(value)) for (const v of value) sp.append(key, v);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value !== null && value !== "") sp.set(key, value);
  }
  const qs = sp.toString();
  return qs ? `/companies?${qs}` : "/companies";
}

/**
 * The companies list filter bar: name search (debounced) and a single status
 * select (Partner / Client / Prospect / All). State lives in the URL — each
 * control navigates via `router.replace`, so the server page re-fetches the
 * filtered page and the back button restores prior filters. Reads its current
 * values from the `params` the page already parsed (no `useSearchParams`, so no
 * Suspense boundary needed).
 */
export function CompaniesListFilters({ params }: { params: SearchParams }) {
  const router = useRouter();
  const searchId = useId();

  const currentQuery = str(params.q);
  const currentStatus = str(params.status) || ALL;

  const [search, setSearch] = useState(currentQuery);

  // Keep the input in sync when the URL query changes from outside (e.g. the
  // Clear button or a back-navigation).
  useEffect(() => {
    setSearch(currentQuery);
  }, [currentQuery]);

  // Debounce search → URL: only navigate once typing settles, and only when the
  // trimmed value actually differs from what's already in the URL.
  useEffect(() => {
    const next = search.trim();
    if (next === currentQuery) return;
    const timer = setTimeout(() => {
      router.replace(hrefWith(params, { q: next || null }));
    }, 300);
    return () => clearTimeout(timer);
  }, [search, currentQuery, params, router]);

  const hasFilters = currentQuery !== "" || currentStatus !== ALL;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-56 flex-1 flex-col gap-1.5">
        <FilterLabel htmlFor={searchId}>Search</FilterLabel>
        <div className="relative">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={searchId}
            type="search"
            placeholder="Search by company name…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <SelectFilter
        label="Status"
        value={currentStatus}
        options={COMPANY_STATUS_TAGS}
        labels={COMPANY_STATUS_LABELS}
        onChange={(value) =>
          router.replace(
            hrefWith(params, { status: value === ALL ? null : value }),
          )
        }
      />

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.replace("/companies")}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
