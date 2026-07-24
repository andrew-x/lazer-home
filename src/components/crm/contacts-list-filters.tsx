"use client";

import { useRouter } from "next/navigation";
import { LocationFilterControl } from "@/components/form/location-filter-control";
import { Button } from "@/components/ui/button";

type SearchParams = Record<string, string | string[] | undefined>;

/** First string value of a param (mirrors how the page reads them). */
function str(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * Build a `/contacts` href from the current params with `updates` applied (a
 * `null`/empty value drops the key), always resetting `contactsPage` so a filter
 * change returns to page 1. Preserves everything else. Mirrors the companies list
 * filters' `hrefWith`.
 */
function hrefWith(
  params: SearchParams,
  updates: Record<string, string | null>,
) {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "contactsPage" || key in updates) continue;
    if (typeof value === "string") sp.append(key, value);
    else if (Array.isArray(value)) for (const v of value) sp.append(key, v);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value !== null && value !== "") sp.set(key, value);
  }
  const qs = sp.toString();
  return qs ? `/contacts?${qs}` : "/contacts";
}

/**
 * The contacts list filter bar: a single location filter (city + "search
 * nearby"). State lives in the URL — the control navigates via `router.replace`,
 * so the server page re-fetches the filtered page and the back button restores
 * prior filters. Reads its current values from the `params` the page already
 * parsed (no `useSearchParams`, so no Suspense boundary needed).
 */
export function ContactsListFilters({ params }: { params: SearchParams }) {
  const router = useRouter();

  const currentCity = str(params.city) || null;
  const currentNearby = str(params.nearby) === "1";

  return (
    <div className="flex flex-wrap items-end gap-3">
      <LocationFilterControl
        fullWidth
        city={currentCity}
        nearby={currentNearby}
        onCityChange={(label) =>
          router.replace(
            hrefWith(params, {
              city: label,
              // Clearing the city drops "nearby" too — it means nothing alone.
              ...(label ? {} : { nearby: null }),
            }),
          )
        }
        onNearbyChange={(checked) =>
          router.replace(hrefWith(params, { nearby: checked ? "1" : null }))
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
