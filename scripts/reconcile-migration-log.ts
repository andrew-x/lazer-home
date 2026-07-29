/**
 * One-off reconciliation of `drizzle.__drizzle_migrations` with reality.
 *
 * Several worktrees share this database. A sibling applied the equivalent of
 * `0016_violet_whistler` before main squashed it, so the schema it creates
 * (`project_billing_type`, `projects.billing_type/budget_amount/budget_currency`)
 * is already present, but recorded under a different hash. drizzle-kit therefore
 * re-runs 0016, fails on `CREATE TYPE` for an existing type, and never reaches
 * the migration after it.
 *
 * This records 0016 as applied — which it verifiably is — so `db:migrate` resumes
 * from the right point. It asserts the schema is really there first, and refuses to
 * write twice. Delete this file once run.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/db";

const HASH = "d8a43b02f1fc161b6e6482d34b2d3cd6655cd4ebe6622632b6178edb350effb1";
/** 0016's own `when` from `drizzle/meta/_journal.json`. */
const WHEN = "1785351496413";

const typeExists = await db.execute(
  sql`select 1 from pg_type where typname = 'project_billing_type'`,
);
const columnExists = await db.execute(
  sql`select 1 from information_schema.columns
      where table_name = 'projects' and column_name = 'budget_amount'`,
);

if (
  (typeExists as unknown[]).length === 0 ||
  (columnExists as unknown[]).length === 0
) {
  console.error(
    "REFUSING: 0016's schema is NOT present — it must be applied, not recorded.",
  );
  process.exit(1);
}

const existing = await db.execute(
  sql`select 1 from drizzle.__drizzle_migrations where hash = ${HASH}`,
);

if ((existing as unknown[]).length > 0) {
  console.log("Already recorded — no write made.");
  process.exit(0);
}

await db.execute(
  sql`insert into drizzle.__drizzle_migrations (hash, created_at)
      values (${HASH}, ${WHEN})`,
);
console.log("Recorded 0016_violet_whistler as applied.");
process.exit(0);
