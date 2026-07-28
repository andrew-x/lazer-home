"use client";

import { useRouter } from "next/navigation";
import type { DeliveryManagerOption } from "@/actions/projects/getProjectsList";
import {
  ALL,
  SearchableSelectFilter,
  SelectFilter,
} from "@/components/form/filters";
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

  const currentLob = firstParam(params.lob) || ALL;
  // Resolve to a known option id (else null) so the client and server agree on
  // whether a delivery-manager filter is active even for a stale `dm` param.
  const currentDeliveryManagerId =
    deliveryManagers.find((option) => option.id === firstParam(params.dm))
      ?.id ?? null;

  const { search, setSearch, currentQuery } = useUrlSearchFilter({
    basePath: "/projects",
    pageKey: "projectsPage",
    params,
  });

  const hasFilters =
    currentQuery !== "" ||
    currentLob !== ALL ||
    currentDeliveryManagerId !== null;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <SearchFilter
        value={search}
        onChange={setSearch}
        placeholder="Search by project or company name…"
      />

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
