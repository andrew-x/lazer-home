/**
 * opencode lifecycle hooks — the analog of the Claude Code hooks in
 * .claude/settings.json (`hooks.SessionStart` / `hooks.Stop`) and the Codex hooks
 * in .codex/hooks.json + .codex/hooks/*.sh. See AGENTS.md ("Agent runtimes").
 *
 * opencode has no declarative hooks file; lifecycle work lives in a plugin.
 * Any .js/.ts file in .opencode/plugin/ is auto-discovered — no config entry needed.
 *
 * Two behaviours, mirroring the other two runtimes:
 *   1. SessionStart -> prune scratch plans older than two weeks. The plugin's own
 *      init body runs once when opencode starts, which is the natural equivalent.
 *   2. Stop -> `biome check --write .` at end of turn, on the `session.idle` event.
 *      (Per-file Biome formatting on write is already handled natively by
 *      opencode's built-in `biome` formatter, which biome.json activates. This
 *      whole-tree pass adds the safe lint fixes and import organizing that the
 *      Claude Code and Codex Stop hooks also apply.)
 *
 * Written in plain JavaScript on purpose: this repo's tsconfig type-checks every
 * TypeScript file in the tree, so a .ts plugin importing `@opencode-ai/plugin`
 * (not a dependency) would break `bun run check`. Plain JS keeps it green with no
 * new deps. Note: avoid writing a glob containing a star-slash in this block
 * comment — it terminates the comment early and breaks plugin loading.
 *
 * Both hooks are strictly best-effort — a hook must never break the session, so
 * each script swallows its own failures and exits 0, and the calls are wrapped.
 */

// docs/plans is scratch space (see AGENTS.md "Plans and specs"), not durable docs.
const PRUNE_PLANS = `
  plans_dir="$1/docs/plans"
  if [ -d "$plans_dir" ]; then
    find "$plans_dir" -type f -mtime +14 ! -name '.gitkeep' -delete 2>/dev/null || true
  fi
  exit 0
`;

// Runtime and formatter are Bun + Biome (see AGENTS.md "Conventions").
const FORMAT = `
  cd "$1" 2>/dev/null || exit 0
  bunx biome check --write . >/dev/null 2>&1 || true
  exit 0
`;

export default async ({ $, directory, worktree }) => {
  const root = worktree || directory;

  /** Run a bash script with the project root as $1. Never throws. */
  const run = async (script) => {
    try {
      await $`bash -c ${script} psa-hooks ${root}`;
    } catch {
      // Best-effort by design: swallow anything so the session is unaffected.
    }
  };

  // SessionStart equivalent — runs once at startup.
  await run(PRUNE_PLANS);

  return {
    event: async ({ event }) => {
      // Stop equivalent — the turn has finished and the session went idle.
      if (event?.type === "session.idle") {
        await run(FORMAT);
      }
    },
  };
};
