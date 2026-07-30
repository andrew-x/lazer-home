"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import type { ExchangeRates } from "@/actions/staff/getExchangeRates";
import { toEnumValue } from "@/components/form/enum-select";
import { FilterLabel } from "@/components/form/filters";
import { FxRateNote } from "@/components/fx-rate-note";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Currency } from "@/lib/format/currency";
import {
  DISPLAY_CURRENCIES,
  type DisplayCurrency,
} from "@/lib/format/currency";

/**
 * The currency every margin figure in the projects list reads in.
 *
 * CAD rather than each project's own denomination (what a project's *detail* page
 * defaults to, via `resolveDisplayCurrency`): a list is for comparing, and cards in
 * five different currencies can't be compared. One currency for the whole list means
 * one conversion note, and the reader can switch the lot at once.
 */
const DEFAULT_DISPLAY_CURRENCY: DisplayCurrency = "CAD";

type ProjectsCurrencyValue = {
  displayCurrency: DisplayCurrency;
  setDisplayCurrency: (currency: DisplayCurrency) => void;
};

const ProjectsCurrencyContext = createContext<ProjectsCurrencyValue>({
  displayCurrency: DEFAULT_DISPLAY_CURRENCY,
  setDisplayCurrency: () => {},
});

/**
 * Holds the list's display currency.
 *
 * Context rather than a prop, and client state rather than a URL param: the toggle
 * sits in the filter bar while the cards it governs are spread across five
 * independently server-rendered sections, and the currency is a *display* preference
 * — putting it in the URL alongside the real filters would both conflate the two and
 * make flipping it a navigation. The figures for both currencies are already in the
 * payload (see `ProjectListItem.margin`), so switching is instant and refetches
 * nothing.
 *
 * A viewer without `projects.viewMargin` has no money on screen to convert, so the
 * page renders no toggle for them — the provider is harmless either way, since the
 * read is what withholds the figures.
 */
export function ProjectsCurrencyProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>(
    DEFAULT_DISPLAY_CURRENCY,
  );

  return (
    <ProjectsCurrencyContext.Provider
      value={{ displayCurrency, setDisplayCurrency }}
    >
      {children}
    </ProjectsCurrencyContext.Provider>
  );
}

/** The display currency for list money figures. */
export function useProjectsCurrency(): ProjectsCurrencyValue {
  return useContext(ProjectsCurrencyContext);
}

/**
 * The CAD/USD control for the list, with the exchange rates used stated beside it —
 * the same pairing as a project's budget panel, so the conversion caveat always sits
 * next to the control that causes it.
 */
export function ProjectsCurrencyToggle({
  rates,
  nativeCurrencies,
}: {
  rates: ExchangeRates;
  /** Currencies the list's figures were converted *from* (`nativeCurrencies`). */
  nativeCurrencies: Currency[];
}) {
  const { displayCurrency, setDisplayCurrency } = useProjectsCurrency();

  return (
    <div className="flex flex-col gap-1.5">
      <FilterLabel>Currency</FilterLabel>
      <div className="flex items-center gap-3">
        <ToggleGroup
          variant="outline"
          spacing={0}
          aria-label="Display currency"
          value={[displayCurrency]}
          onValueChange={(values: string[]) => {
            // Base UI emits an empty array when the active item is pressed again;
            // a display currency is never "none", so ignore that.
            const next = toEnumValue(DISPLAY_CURRENCIES, values[0] ?? null);
            if (next) setDisplayCurrency(next);
          }}
        >
          {DISPLAY_CURRENCIES.map((code) => (
            <ToggleGroupItem key={code} value={code} size="sm">
              {code}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FxRateNote
          rates={rates}
          from={nativeCurrencies.filter((code) => code !== displayCurrency)}
          to={displayCurrency}
        />
      </div>
    </div>
  );
}
