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

See `AGENTS.md` for conventions and `docs/README.md` for architecture and domain documentation.
