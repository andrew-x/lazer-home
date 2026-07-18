# 0029 — External FX rates (frankfurter.dev), USD-cross-rate conversion, never-throw fallback

**Status:** accepted · 2026-07-16

## Context

The performance analytics dashboard (`/performance`) shows compensation
aggregates with a **CAD / USD display toggle**, but compensation is stored on
`staff_employment` in **each person's own currency** across the five `CURRENCY`
values (`CAD`/`USD`/`GBP`/`EUR`/`AED`). To compare or average across people we
must normalize every amount to one display currency, which needs live-ish FX
rates. This is the **first live external HTTP call in the codebase** — everything
prior reads only our own Postgres — so it also sets the pattern for future
outbound API calls.

Constraints that shaped it: the number should be roughly current (rates move at
most daily), we don't want to introduce a paid API / API-key / new env var for a
nice-to-have, and the dashboard must **never fail to render** just because an
external service is down.

## Decision

- **Source:** `frankfurter.dev` (`GET /v1/latest?base=USD`) — a free, keyless FX
  API backed by ECB reference rates. No new env var, no auth. Wrapped in the
  server-only read `src/actions/staff/getExchangeRates.ts` (actions layer owns all
  external I/O too, not just DB — ADR 0010's spirit).
- **USD-based rate table + cross-rate conversion.** Rates are carried as
  `1 USD → currency` (frankfurter's `?base=USD` shape). The pure, client-importable
  helper `src/lib/fx.ts` exposes `convert(amount, from, to, usdRates)` which
  cross-rates through USD (`from → USD → to`), short-circuiting equal currencies.
  Pure so the read, the client dashboard (recomputing on every filter/currency
  change), and the unit tests all share one conversion path.
- **AED is pegged, not fetched.** Frankfurter quotes 30 currencies but **not AED**;
  the dirham is fixed at `1 USD = 3.6725 AED` (since 1997). We carry `AED_PER_USD`
  in `fx.ts` and splice it (plus `USD: 1`, which frankfurter omits as the base)
  into the live table.
- **Never throws; degrades to a stale fallback.** On any network/parse failure —
  or a partial table missing a currency we support — `getExchangeRates` logs and
  returns the hardcoded `FALLBACK_USD_RATES` with `stale: true` and
  `asOf: "unavailable"`. The dashboard renders regardless and shows a "rates
  unavailable — approximate fallback" note. A partial live table is rejected
  wholesale rather than shipped (a missing rate would silently corrupt one
  currency's conversion).
- **Cached 12h via Next `fetch` revalidation** (`next: { revalidate }`), not
  `unstable_cache` — rates change at most once per business day, so we don't hit
  the API per request. (Verify the revalidation API against
  `node_modules/next/dist/docs/` — this is the modified Next build.)

## Consequences

- **First external dependency at request time.** If frankfurter is slow it adds
  latency to the (cached, 12h) first render; if it's down the dashboard still
  works on approximate numbers. No hard failure surface added.
- **Fallback rates drift.** `FALLBACK_USD_RATES` is a hardcoded approximation;
  the `stale` flag is the only signal it's in use. Refresh it occasionally.
- **Conversion is pure and unit-tested** (`fx.test.ts`) — no DB, client-safe, so
  the same math runs server- and client-side.
- **`formatMoney` gained an optional `Intl.NumberFormatOptions` arg** (backward
  compatible) so the dashboard can show whole-dollar aggregates
  (`maximumFractionDigits: 0`).
- **Pattern for future outbound calls:** wrap in a server-only action, cache via
  Next fetch revalidation, never throw to the UI, keep any pure transform in a
  `src/lib` helper.

## Alternatives considered

- **A paid/keyed FX API** — rejected: needs an env var + secret management for a
  supplementary feature; frankfurter's free ECB rates are accurate enough for
  internal comp comparisons.
- **Persisting rates in a table (daily cron)** — rejected as over-engineering for
  one dashboard; Next fetch caching gives the same freshness with no schema or
  job. Revisit if more features need FX.
- **Server-side-only conversion (pre-aggregate per currency)** — rejected: the
  client toggles currency and filters live, so shipping raw per-person amounts +
  a rate table and recomputing in the pure helper is simpler and keeps identity
  off the wire (the read is already anonymized).
- **Hardcoding all rates** — rejected: comp figures would silently go stale; the
  hardcoded table is kept only as the failure fallback, flagged `stale`.
