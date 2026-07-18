/**
 * Synthetic data seed for the PSA platform.
 *
 *   bun run db:seed            # prompts before wiping the target DB
 *   bun run db:seed --yes      # skip the confirmation (CI / scripted use)
 *   bun run db:seed --allow-prod  # override the production-URL guard (careful!)
 *
 * Reads `DATABASE_URL` from the environment (Bun auto-loads `.env`), WIPES every
 * seedable table, then inserts a coherent, reproducible dataset across all
 * domains. See docs/superpowers/specs/2026-07-15-synthetic-seed-script-design.md
 * and the drift-guard note in AGENTS.md: this script imports the real Drizzle
 * tables and enum sources, so `bun run check` breaks if the data model changes
 * under it — keep it in sync when you touch the schema.
 */
import { createSeedDb, describeTarget, looksProduction } from "./seed/client";
import { seedCrm } from "./seed/crm";
import { seedEntries } from "./seed/entries";
import { seedFeedback } from "./seed/performance";
import { seedProjects } from "./seed/projects";
import { seedOpportunities } from "./seed/sales";
import { seedStaff } from "./seed/staff";
import { seedTimesheets } from "./seed/timesheets";
import { wipe } from "./seed/wipe";

async function main() {
  const args = new Set(process.argv.slice(2));
  const skipConfirm = args.has("--yes") || args.has("-y");
  const allowProd = args.has("--allow-prod");

  const { db, client, url } = createSeedDb();
  const target = describeTarget(url);

  try {
    if (looksProduction(url) && !allowProd) {
      console.error(
        `\n✋ Refusing to seed: "${target}" looks like production.\n` +
          "   Re-run with --allow-prod only if you are absolutely sure.\n",
      );
      process.exitCode = 1;
      return;
    }

    console.log(`\n🌱 Seeding: ${target}`);
    console.log("   This WIPES all seedable tables first.\n");

    if (!skipConfirm) {
      const answer = prompt("   Type 'y' to continue:");
      if (answer?.trim().toLowerCase() !== "y") {
        console.log("   Aborted.\n");
        return;
      }
    }

    console.time("seeded in");
    await wipe(db);

    const staff = await seedStaff(db);
    const { companies, contacts } = await seedCrm(db, staff);
    const opportunities = await seedOpportunities(
      db,
      companies,
      contacts,
      staff,
    );
    const projects = await seedProjects(db, companies, opportunities, staff);
    const timesheets = await seedTimesheets(db, staff, projects);
    const feedbackCount = await seedFeedback(db, staff);
    const entries = await seedEntries(db, contacts, opportunities, staff);

    console.log("\n✅ Done. Row counts:");
    console.table({
      staff: staff.length,
      companies: companies.length,
      contacts: contacts.length,
      opportunities: opportunities.length,
      projects: projects.length,
      timesheets: timesheets.timesheets,
      timeEntries: timesheets.entries,
      feedback: feedbackCount,
      contactEntries: entries.contactEntries,
      opportunityEntries: entries.opportunityEntries,
    });
    console.log(
      "\n   Sign in with Google as andrew@lazertechnologies.com (admin).\n",
    );
    console.timeEnd("seeded in");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("\n❌ Seed failed:", error);
  process.exitCode = 1;
});
