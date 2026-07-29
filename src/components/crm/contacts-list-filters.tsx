"use client";

import { useRouter } from "next/navigation";
import { useId } from "react";
import { LocationFilterControl } from "@/components/form/location-filter-control";
import {
  SearchFilter,
  useUrlSearchFilter,
} from "@/components/form/search-filter";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  buildListHref,
  firstParam,
  type SearchParams,
} from "@/lib/core/list-href";

/**
 * The contacts list filter bar: a name search (debounced), an "Include inactive"
 * toggle, and a location filter (city + "search nearby"), on one wrapping row.
 * State lives in the URL — each control navigates via `router.replace`, so the
 * server page re-fetches the filtered page and the back button restores prior
 * filters. Reads its current values from the `params` the page already parsed (no
 * `useSearchParams`, so no Suspense boundary needed).
 *
 * "Include inactive" is the odd one out: every other control *narrows* the list,
 * this one widens it. It's a plain switch rather than a `TriStateFilter` because
 * nobody wants "inactive only", and the param is absent by default (like `nearby=1`)
 * so the clean URL is the clean state.
 */
export function ContactsListFilters({ params }: { params: SearchParams }) {
  const router = useRouter();
  const inactiveId = useId();

  const currentCity = firstParam(params.city) || null;
  const currentNearby = firstParam(params.nearby) === "1";
  const currentInactive = firstParam(params.inactive) === "1";

  const { search, setSearch, currentQuery } = useUrlSearchFilter({
    basePath: "/contacts",
    pageKey: "contactsPage",
    params,
  });

  const hasFilters =
    currentQuery !== "" ||
    currentCity !== null ||
    currentNearby ||
    currentInactive;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <SearchFilter
        value={search}
        onChange={setSearch}
        placeholder="Search by name…"
      />

      <div className="flex h-9 items-center gap-2 text-sm">
        <Switch
          id={inactiveId}
          checked={currentInactive}
          onCheckedChange={(checked) =>
            router.replace(
              buildListHref("/contacts", "contactsPage", params, {
                inactive: checked ? "1" : null,
              }),
            )
          }
        />
        <label htmlFor={inactiveId}>Include inactive</label>
      </div>

      <LocationFilterControl
        city={currentCity}
        nearby={currentNearby}
        onCityChange={(label) =>
          router.replace(
            buildListHref("/contacts", "contactsPage", params, {
              city: label,
              // Clearing the city drops "nearby" too — it means nothing alone.
              ...(label ? {} : { nearby: null }),
            }),
          )
        }
        onNearbyChange={(checked) =>
          router.replace(
            buildListHref("/contacts", "contactsPage", params, {
              nearby: checked ? "1" : null,
            }),
          )
        }
      />

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.replace("/contacts")}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
