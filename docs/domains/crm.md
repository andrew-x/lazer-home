# Domain: CRM

**Status: proposed.** Manages the client relationship and the sales pipeline that feeds delivery.

## Purpose

Track who we sell to and what we're trying to win, so won work flows cleanly into Projects and Allocations.

## Key entities

- **Client** — a customer organisation.
- **Contact** — a person at a Client.
- **Opportunity** — a pipeline deal for a Client, moving through stages (e.g. lead → qualified → proposal → won/lost). A *won* Opportunity produces a Project.

## Key flows

- **Pipeline management** — create and progress Opportunities through stages.
- **Won → Project handoff** — winning an Opportunity creates the Project that delivery staffs and bills against. This is the seam between CRM and the rest of the system; keep the link explicit.

## Connects to

- **Allocations / Timesheets** via the Project a won Opportunity creates.
- See [../data-model.md](../data-model.md) and [../flows.md](../flows.md).

## Open questions

- Pipeline stages and probability/weighting model — TBD.
- Do we forecast revenue from the pipeline (value × probability)?
