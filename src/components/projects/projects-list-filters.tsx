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
import { PROJECTS_PAGE_KEY } from "@/lib/projects/projects-list-sort";

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
    pageKey: PROJECTS_PAGE_KEY,
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
            buildListHref("/projects", PROJECTS_PAGE_KEY, params, {
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
              buildListHref("/projects", PROJECTS_PAGE_KEY, params, { dm: id }),
            )
          }
        />
      ) : null}

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          // Clears the *filters*, not the view: the status tab and the sort order
          // survive, because "clear filters" is a narrower promise than "go back to
          // /projects" and the tab you're on isn't something you filtered by.
          onClick={() =>
            router.replace(
              buildListHref("/projects", PROJECTS_PAGE_KEY, params, {
                q: null,
                lob: null,
                dm: null,
              }),
            )
          }
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
