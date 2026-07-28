"use client";

import { useRouter } from "next/navigation";
import { ALL, SelectFilter } from "@/components/form/filters";
import { LocationFilterControl } from "@/components/form/location-filter-control";
import {
  SearchFilter,
  useUrlSearchFilter,
} from "@/components/form/search-filter";
import { Button } from "@/components/ui/button";
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

  const currentStatus = firstParam(params.status) || ALL;
  const currentCity = firstParam(params.city) || null;
  const currentNearby = firstParam(params.nearby) === "1";

  const { search, setSearch, currentQuery } = useUrlSearchFilter({
    basePath: "/companies",
    pageKey: "companiesPage",
    params,
  });

  const hasFilters =
    currentQuery !== "" ||
    currentStatus !== ALL ||
    currentCity !== null ||
    currentNearby;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <SearchFilter
          value={search}
          onChange={setSearch}
          placeholder="Search by company name…"
        />

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
        fullWidth
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
