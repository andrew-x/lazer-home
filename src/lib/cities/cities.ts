import { SEARCH_LIMIT } from "@/lib/core/search";
import worldCities from "./world-cities.json";

/**
 * The static world-cities dataset + the pure lookups over it. Location is stored
 * as a free-text `"City, CC"` label (e.g. `"Toronto, CA"`) chosen from this list,
 * not a foreign key — see docs/data-model.md.
 *
 * The dataset ships as a column-oriented JSON (parallel arrays keyed by column,
 * `label[i] === "city_ascii, iso2"`) and is parsed once at module load, so the
 * derived row index below is effectively a singleton. `world-cities.json` is a
 * small US/CA sample for dev; swap in the full dataset at the same path — nothing
 * here assumes a size.
 *
 * IMPORTANT: import this only from the `searchCities` action or the seed script —
 * NEVER from a client component, which would bundle the whole dataset to the
 * browser. (It deliberately has no `import "server-only"` guard because the Bun
 * seed script imports it, and `server-only` throws outside a React-server build.)
 */

type CityColumns = {
  count: number;
  label: string[];
  city: string[];
  city_alt: string[];
  country: string[];
  country_code: string[];
  lat: number[];
  lng: number[];
};

const data = worldCities as CityColumns;

/**
 * Row-oriented, pre-lowercased index built once at module load: each search only
 * scans the prepared `haystack` (ascii name + diacritic name + label) rather than
 * re-lowercasing on every keystroke.
 */
const index = data.label.map((label, i) => ({
  label,
  countryCode: data.country_code[i],
  lat: data.lat[i],
  lng: data.lng[i],
  haystack: `${data.city[i]} ${data.city_alt[i]} ${label}`.toLowerCase(),
}));

const byLabel = new Map(index.map((city) => [city.label, city]));

/** Default "nearby" radius (km): a single day-trip / airport catchment — pulls in
 * adjacent metros (Ottawa–Gatineau, NYC–Newark) without spanning regions. */
export const NEARBY_RADIUS_KM = 100;

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance (km) between two lat/lng points (haversine). */
function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(h));
}

/**
 * Type-ahead search over the static city list, shaped for the entity comboboxes:
 * a blank query returns nothing; otherwise a case-insensitive substring match on
 * the city/label, capped at `SEARCH_LIMIT`. `id` and `name` are both the label —
 * the label is what we store as the location and what uniquely identifies a city.
 */
export function searchCities(query: string): { id: string; name: string }[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];

  const matches: { id: string; name: string }[] = [];
  for (const city of index) {
    if (city.haystack.includes(q)) {
      matches.push({ id: city.label, name: city.label });
      if (matches.length >= SEARCH_LIMIT) break;
    }
  }
  return matches;
}

/**
 * City labels within `radiusKm` great-circle distance of `label` (inclusive of
 * `label` itself), for the "search nearby" location filter — the rough ballpark
 * that if you fly into one city you can reasonably meet people in the others.
 * Returns just `[label]` when the label is unknown (e.g. a stale filter param, or
 * a label absent from the current dataset), so the filter degrades to an exact
 * match rather than matching nothing.
 */
export function citiesNear(
  label: string,
  radiusKm: number = NEARBY_RADIUS_KM,
): string[] {
  const origin = byLabel.get(label);
  if (!origin) return [label];

  return index
    .filter(
      (city) =>
        haversineKm(origin.lat, origin.lng, city.lat, city.lng) <= radiusKm,
    )
    .map((city) => city.label);
}

/**
 * All city labels whose ISO2 country code is in `codes` (e.g. `["US", "CA"]`).
 * Used by the seed to draw realistic, valid locations that match what the picker
 * would offer.
 */
export function cityLabelsForCountries(codes: string[]): string[] {
  const wanted = new Set(codes);
  return index
    .filter((city) => wanted.has(city.countryCode))
    .map((city) => city.label);
}
