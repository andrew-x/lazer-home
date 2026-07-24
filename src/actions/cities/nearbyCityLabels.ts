"use server";

import { z } from "zod";
import { citiesNear } from "@/lib/cities/cities";
import { secureActionClient } from "@/lib/core/action";

/**
 * The city labels within the "nearby" radius of a given city label (see
 * `citiesNear`) — the bridge the staff directory's client-side location filter
 * uses to resolve "search nearby", since the world-cities dataset must stay on
 * the server and never bundle to the browser. Companies/contacts don't need this:
 * their list reads run server-side and call `citiesNear` directly.
 *
 * RBAC: auth-gated by `secureActionClient` but intentionally NO capability gate —
 * like `searchCities`, it exposes only static, public world-cities reference data.
 */
export const nearbyCityLabels = secureActionClient
  .metadata({ action: "nearby-city-labels" })
  .inputSchema(z.object({ city: z.string().min(1) }))
  .action(({ parsedInput: { city } }) => Promise.resolve(citiesNear(city)));
