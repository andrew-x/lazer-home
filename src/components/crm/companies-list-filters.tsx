"use client";

import { IconSearch } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { ALL, FilterLabel, SelectFilter } from "@/components/form/filters";
import { LocationFilterControl } from "@/components/form/location-filter-control";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  buildListHref,
  firstParam,
  type SearchParams,
} from "@/lib/core/list-href";
import {
  COMPANY_STATUS_LABELS,
  COMPANY_STATUS_TAGS,
} from "@/lib/crm/company-status";

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

  const currentQuery = firstParam(params.q);
  const currentStatus = firstParam(params.status) || ALL;
  const currentCity = firstParam(params.city) || null;
  const currentNearby = firstParam(params.nearby) === "1";

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
      buildListHref("/companies", "companiesPage", params, { q: next || null }),
    );
  }, [debouncedSearch, search, currentQuery, params, router]);

  const hasFilters =
    currentQuery !== "" ||
    currentStatus !== ALL ||
    currentCity !== null ||
    currentNearby;

  return (
    <div className="flex flex-col gap-3">
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
              buildListHref("/companies", "companiesPage", params, {
                status: value === ALL ? null : value,
              }),
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

      <LocationFilterControl
        city={currentCity}
        nearby={currentNearby}
        onCityChange={(label) =>
          router.replace(
            buildListHref("/companies", "companiesPage", params, {
              city: label,
              // Clearing the city drops "nearby" too — it means nothing alone.
              ...(label ? {} : { nearby: null }),
            }),
          )
        }
        onNearbyChange={(checked) =>
          router.replace(
            buildListHref("/companies", "companiesPage", params, {
              nearby: checked ? "1" : null,
            }),
          )
        }
      />
    </div>
  );
}
