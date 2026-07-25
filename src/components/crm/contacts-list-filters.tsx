"use client";

import { useRouter } from "next/navigation";
import { LocationFilterControl } from "@/components/form/location-filter-control";
import { Button } from "@/components/ui/button";
import {
  buildListHref,
  firstParam,
  type SearchParams,
} from "@/lib/core/list-href";

/**
 * The contacts list filter bar: a single location filter (city + "search
 * nearby"). State lives in the URL — the control navigates via `router.replace`,
 * so the server page re-fetches the filtered page and the back button restores
 * prior filters. Reads its current values from the `params` the page already
 * parsed (no `useSearchParams`, so no Suspense boundary needed).
 */
export function ContactsListFilters({ params }: { params: SearchParams }) {
  const router = useRouter();

  const currentCity = firstParam(params.city) || null;
  const currentNearby = firstParam(params.nearby) === "1";

  return (
    <div className="flex flex-wrap items-end gap-3">
      <LocationFilterControl
        fullWidth
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

      {currentCity !== null || currentNearby ? (
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
