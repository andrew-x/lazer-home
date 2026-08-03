---
description: Audit the Claude Code, Codex and opencode agent setups — inventory all three, verify they're in sync (the setup is deliberately duplicated), check against the latest vendor docs, and report drift + improvement recommendations. Read-only.
argument-hint: "[optional: an area to focus, e.g. \"rules\", \"hooks\", \"skills\", \"librarian\"]"
---

# Audit agent setups (Claude Code ↔ Codex ↔ opencode)

Verify that the three coding-agent runtimes configured in this repo are healthy and in
lockstep: **Claude Code** (`.claude/`), **Codex** (`.codex/` + `.agents/skills/` + the
nested `AGENTS.md` files), and **opencode** (`.opencode/` + `.agents/skills/` + the
nested `AGENTS.md` files). They mirror each other by **full duplication, not symlinks
or references** (see `AGENTS.md` → "Agent runtimes"), with one deliberate exception:
**skill bodies in `.agents/skills/` are shared by Codex and opencode**, since opencode
discovers that directory natively. Duplication drifts — this audit catches the drift,
checks every side against current vendor guidance, and recommends improvements.

This is a **read-only audit** — investigate and report; do **NOT** change any files
unless I explicitly ask you to.

Scope for this run: **$ARGUMENTS** (if empty, audit the whole setup).

## 1. Inventory all three setups

Read every instruction/agent file on each side and list what exists:

- **Shared:** `AGENTS.md` (root) + nested `src/AGENTS.md`, `src/actions/AGENTS.md`,
  `src/lib/db/AGENTS.md`; `CLAUDE.md` (should just import `@AGENTS.md`);
  `.agents/skills/*/SKILL.md` (shared by Codex **and** opencode).
- **Claude Code:** `.claude/settings.json` (+ `.claude/settings.local.json` if
  present), `.claude/agents/*.md`, `.claude/commands/*.md`, `.claude/rules/*.md`.
- **Codex:** `.codex/config.toml`, `.codex/rules/*.rules`, `.codex/hooks.json` +
  `.codex/hooks/*`, `.codex/agents/*.toml` (+ any `agents/openai.yaml`).
- **opencode:** `.opencode/opencode.jsonc`, `.opencode/agent/*.md`,
  `.opencode/command/*.md`, `.opencode/plugin/*.js`.

## 2. Consult the latest vendor guidance

These tools change fast and some behavior postdates your training — don't judge from
memory. Pull current docs first (prefer the Context7 MCP / official docs over memory):

- **Codex:** OpenAI Codex docs — config reference, rules, skills, subagents, hooks,
  and AGENTS.md discovery (learn.chatgpt.com / developers.openai.com). Note the
  installed version with `codex --version`.
- **Claude Code:** docs at code.claude.com/docs — memory/rules, sub-agents,
  skills & commands, hooks, settings.
- **opencode:** docs at opencode.ai/docs (config, agents, commands, permissions,
  skills, plugins, formatters, rules). The **authoritative** config contract is the
  published schema at <https://opencode.ai/config.json> plus opencode's own built-in
  `customize-opencode` skill — dump it with `opencode debug skill`. Note the installed
  version with `opencode --version`.
- **Agent Skills spec** for the `.agents/skills/` `SKILL.md` format.

## 3. Verify opencode empirically (don't just read the files)

opencode ships introspection commands, so **prove** its config resolves instead of
eyeballing it. It **validates strictly and refuses to start** on any invalid field, so
a config mistake is a hard startup failure, not a warning:

- `opencode debug config` — resolved config. Confirm `instructions`, `permission`
  (and that **insertion order** survived — last match wins), `command` and `agent`
  keys are all present. A non-JSON error here means the config is broken.
- `opencode debug agent librarian` — confirm the librarian resolves and its
  `edit` rules are `*: deny` + `docs/**: allow`.
- `opencode debug skill` — confirm the repo's `.agents/skills/*` are discovered.
- Plugin load: `opencode debug config --print-logs --log-level DEBUG 2>&1 | grep psa-hooks`
  must show no `failed to load plugin` error.

## 4. Parity checks (the core of this audit)

For each mirrored concern, confirm the sides say the same thing:

- **Rules ↔ nested AGENTS.md:** each `.claude/rules/*.md` has a faithful counterpart
  — `server-actions` → `src/actions/AGENTS.md`, `database` → `src/lib/db/AGENTS.md`,
  `forms`+`ui`+`nextjs` → `src/AGENTS.md`, and `permissions` **inlined** in the root
  `AGENTS.md`. Flag any content that drifted between a rule and its mirror. Confirm
  opencode's `instructions` array in `.opencode/opencode.jsonc` still lists all three
  nested files (it has no lazy path-glob loading, so a missing entry = a missed rule).
- **Librarian subagent:** `.claude/agents/librarian.md`, `.codex/agents/librarian.toml`
  and `.opencode/agent/librarian.md` must describe the same librarian (process,
  principles, standing environment facts). Codex and opencode must **duplicate the
  instructions inline** — flag it if either merely references the `.md`. Flag any
  divergence. (opencode additionally enforces docs-only editing via `permission.edit`;
  that's an intentional strengthening of the shared "only edit /docs" instruction, not
  drift.)
- **Commands ↔ skills:** every `.claude/commands/*.md` has a matching
  `.agents/skills/*/SKILL.md` **and** a matching `.opencode/command/*.md`, and
  vice-versa. Same intent; expected adaptations are fine (`$ARGUMENTS` → prose scoping,
  "the Agent tool" → Codex/opencode subagents, `AskUserQuestion` → ask-in-chat).
  The opencode commands are deliberately **thin delegations** to the shared skill —
  flag any that has grown a duplicated copy of the procedure (that's new drift
  surface), and check `agent:` still matches intent (`plan` for the read-only audits,
  `build` for the destructive `clean-decisions`).
- **Permissions:** `.claude/settings.json` `allow`/`ask` ↔ `.codex/rules/default.rules`
  `prefix_rule` entries ↔ `.opencode/opencode.jsonc` `permission.bash` should cover the
  same commands. Flag anything allowed on one side but not the others.
- **Hooks:** `.claude/settings.json` `hooks` ↔ `.codex/hooks.json` ↔
  `.opencode/plugin/psa-hooks.js` should fire equivalent behavior (prune `docs/plans`
  on session start; Biome format at end of turn). Flag behavior present on only some
  sides.

## 5. Correctness & vendor-alignment checks

- Discovery paths are correct per tool (skills at `.agents/skills/`, Codex subagents at
  `.codex/agents/*.toml`, opencode at `.opencode/{agent,command,plugin}/`, and Codex
  "rules" are command-permission **Starlark**, not instructions).
- Frontmatter/schema valid: skill `name`+`description`; Codex subagent
  `name`+`description`+`developer_instructions`; `config.toml` enables what's used.
  For opencode, only its allowed agent frontmatter fields are used and `color` is a
  **hex or semantic token** (`info`, not Claude Code's `blue` — the latter is rejected
  and blocks startup).
- Trigger descriptions are specific enough to auto-invoke, not so broad they misfire
  or overlap.
- Nested `AGENTS.md` sit at the right **common-ancestor** directory given Codex's
  cwd-based (root → cwd, once per session) loading; root `AGENTS.md` stays within
  Codex's ~32 KiB `project_doc_max_bytes` budget.
- Hooks enabled (`[features] hooks = true`), scripts executable, paths robust.
- **opencode plugin health:** it stays plain `.js` (a `.ts` plugin importing
  `@opencode-ai/plugin` would be type-checked by this repo's tsconfig and break
  `bun run check`), contains no `*/`-bearing glob inside a block comment (that
  terminates the comment and breaks plugin loading), and its hooks stay best-effort so
  they can never fail a session.
- No formatter conflict: opencode's built-in `biome` formatter is what should run
  (activated by `biome.json`); Prettier stays disabled so it can't fight Biome.
- **No dead duplicate skills:** `.opencode/skill/` must NOT contain copies of anything
  in `.agents/skills/`. Skill names must be unique across locations — on a collision
  opencode silently keeps the `.agents/skills/` copy and discards the other, so a
  duplicate is a never-read file that drifts. Flag any such copy for deletion, and
  don't recommend creating one.
- Nothing relies on a feature a newer tool version renamed or deprecated.

## 6. Improvement opportunities

Beyond parity, be a collaborator: recommend improvements — context efficiency, better
delegation, newly-shipped vendor features worth adopting, redundant or overbroad
triggers, anything that would make any of the setups better. Where one runtime can
enforce a shared instruction at the tool layer that the others can only state in
prose, say so.

## Output

- **🔴 Parity drift** — where the runtimes disagree (mirrored content that diverged,
  missing counterparts). Most important first; give every file path and the exact
  difference.
- **🟡 Correctness / staleness** — schema errors, wrong discovery paths, deprecated
  features, weak/overbroad triggers, budget risks.
- **🟢 Improvement recommendations** — concrete upgrades to any setup, with the why.
- **✅ Verified in sync** — what you checked and found correctly mirrored, including
  the empirical `opencode debug` results.
- **Consulted sources** — docs and versions you checked, with links or local paths.

End with a one-line verdict (**IN SYNC** / **DRIFTED**) and the top 3 things to fix.
**Do not modify any files** unless I explicitly ask. If I do ask you to fix drift,
mirror every change on **all three** runtimes and re-run this audit to confirm.
