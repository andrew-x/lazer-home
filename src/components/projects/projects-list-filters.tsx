"use client";

import { IconSearch } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import type { DeliveryManagerOption } from "@/actions/projects/getProjectsList";
import {
  ALL,
  FilterLabel,
  SearchableSelectFilter,
  SelectFilter,
} from "@/components/form/filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  buildListHref,
  firstParam,
  type SearchParams,
} from "@/lib/core/list-href";
import {
  LINE_OF_BUSINESS,
  LINE_OF_BUSINESS_LABELS,
} from "@/lib/crm/line-of-business";

/**
 * The projects list filter bar: name/company search (debounced) and a
 * line-of-business select. State lives in the URL — each control navigates via
 * `router.replace`, so the server page re-fetches and the back button restores
 * prior filters. Reads its current values from the `params` the page already
 * parsed (no `useSearchParams`, so no Suspense boundary needed). Mirrors
 * `OpportunitiesListFilters`.
 */
export function ProjectsListFilters({
  params,
  deliveryManagers,
}: {
  params: SearchParams;
  deliveryManagers: DeliveryManagerOption[];
}) {
  const router = useRouter();
  const searchId = useId();

  const currentQuery = firstParam(params.q);
  const currentLob = firstParam(params.lob) || ALL;
  // Resolve to a known option id (else null) so the client and server agree on
  // whether a delivery-manager filter is active even for a stale `dm` param.
  const currentDeliveryManagerId =
    deliveryManagers.find((option) => option.id === firstParam(params.dm))
      ?.id ?? null;

  const [search, setSearch] = useState(currentQuery);
  const debouncedSearch = useDebouncedValue(search, 300);

  // Keep the input in sync when the URL query changes from outside (Clear/back).
  useEffect(() => {
    setSearch(currentQuery);
  }, [currentQuery]);

  // Debounce search → URL: navigate once typing settles and only when the
  // trimmed value differs from what's already in the URL.
  useEffect(() => {
    if (debouncedSearch !== search) return;
    const next = debouncedSearch.trim();
    if (next === currentQuery) return;
    router.replace(
      buildListHref("/projects", "projectsPage", params, { q: next || null }),
    );
  }, [debouncedSearch, search, currentQuery, params, router]);

  const hasFilters =
    currentQuery !== "" ||
    currentLob !== ALL ||
    currentDeliveryManagerId !== null;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-56 flex-1 flex-col gap-1.5">
        <FilterLabel htmlFor={searchId}>Search</FilterLabel>
        <div className="relative">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={searchId}
            type="search"
            placeholder="Search by project or company name…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <SelectFilter
        label="Line of business"
        value={currentLob}
        options={LINE_OF_BUSINESS}
        labels={LINE_OF_BUSINESS_LABELS}
        onChange={(value) =>
          router.replace(
            buildListHref("/projects", "projectsPage", params, {
              lob: value === ALL ? null : value,
            }),
          )
        }
      />

      {deliveryManagers.length > 0 ? (
        <SearchableSelectFilter
          label="Delivery manager"
          value={currentDeliveryManagerId}
          options={deliveryManagers}
          placeholder="All"
          onChange={(id) =>
            router.replace(
              buildListHref("/projects", "projectsPage", params, { dm: id }),
            )
          }
        />
      ) : null}

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.replace("/projects")}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
