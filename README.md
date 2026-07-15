This is an internal **Professional Services Automation (PSA) platform** for a software consultancy, spanning CRM, allocations, timesheets, staff profiles, and performance management. Built on [Next.js](https://nextjs.org).

## Getting Started

The runtime and package manager is [Bun](https://bun.sh). Start the development server:

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Edit pages under `src/app`. The app auto-updates as you edit.

## Development

- `bun run dev` — start the dev server
- `bun run check` — pre-flight: Biome lint + `tsc --noEmit` + tests (run before pushing)
- `bun run build` — production build (also type-checks)
- `bun run db:seed` — populate the database with synthetic data (see below)

## Seeding synthetic data

`bun run db:seed` fills the database with a coherent, reproducible fake dataset
across every domain — staff (with a manager hierarchy, skills, and PTO), CRM
companies and contacts, opportunities across all pipeline stages, projects,
timesheets, and peer feedback. It reads `DATABASE_URL` from the environment (Bun
auto-loads `.env`) and seeds an admin account for `andrew@lazertechnologies.com`
so you can sign in to a fully-populated app.

**It wipes every seedable table first.** As a safeguard it refuses to run against
a production-looking URL and prompts for confirmation:

```bash
bun run db:seed              # prompts before wiping the target database
bun run db:seed --yes        # skip the confirmation (CI / scripted use)
bun run db:seed --allow-prod # override the production-URL guard (careful!)
```

The script (`scripts/seed/`) imports the real Drizzle schema and enum sources, so
`bun run check` fails if it drifts from the data model — **update `scripts/seed/`
after any schema change.**

See `AGENTS.md` for conventions and `docs/README.md` for architecture and domain documentation.
