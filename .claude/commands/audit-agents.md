---
description: Audit the Claude Code and Codex agent setups — inventory both, verify they're in sync (the setup is deliberately duplicated), check against the latest vendor docs, and report drift + improvement recommendations. Read-only.
argument-hint: "[optional: an area to focus, e.g. \"rules\", \"hooks\", \"skills\", \"librarian\"]"
---

# Audit agent setups (Claude Code ↔ Codex)

Verify that the two coding-agent runtimes configured in this repo are healthy and in
lockstep: **Claude Code** (`.claude/`) and **Codex** (`.codex/` + `.agents/skills/` +
the nested `AGENTS.md` files). They mirror each other by **full duplication, not
symlinks or references** (see `AGENTS.md` → "Agent runtimes"). Duplication drifts —
this audit catches the drift, checks both sides against current vendor guidance, and
recommends improvements.

This is a **read-only audit** — investigate and report; do **NOT** change any files
unless I explicitly ask you to.

Scope for this run: **$ARGUMENTS** (if empty, audit the whole setup).

## 1. Inventory both setups

Read every instruction/agent file on both sides and list what exists:

- **Shared:** `AGENTS.md` (root) + nested `src/AGENTS.md`, `src/actions/AGENTS.md`,
  `src/lib/db/AGENTS.md`; `CLAUDE.md` (should just import `@AGENTS.md`).
- **Claude Code:** `.claude/settings.json` (+ `.claude/settings.local.json` if
  present), `.claude/agents/*.md`, `.claude/commands/*.md`, `.claude/rules/*.md`.
- **Codex:** `.codex/config.toml`, `.codex/rules/*.rules`, `.codex/hooks.json` +
  `.codex/hooks/*`, `.codex/agents/*.toml`, `.agents/skills/*/SKILL.md`
  (+ any `agents/openai.yaml`).

## 2. Consult the latest vendor guidance

These tools change fast and some behavior postdates your training — don't judge from
memory. Pull current docs first (prefer the Context7 MCP / official docs over memory):

- **Codex:** OpenAI Codex docs — config reference, rules, skills, subagents, hooks,
  and AGENTS.md discovery (learn.chatgpt.com / developers.openai.com). Note the
  installed version with `codex --version`.
- **Claude Code:** docs at code.claude.com/docs — memory/rules, sub-agents,
  skills & commands, hooks, settings.
- **Agent Skills spec** for the `.agents/skills/` `SKILL.md` format.

## 3. Parity checks (the core of this audit)

For each mirrored concern, confirm the two sides say the same thing:

- **Rules ↔ nested AGENTS.md:** each `.claude/rules/*.md` has a faithful counterpart
  — `server-actions` → `src/actions/AGENTS.md`, `database` → `src/lib/db/AGENTS.md`,
  `forms`+`ui`+`nextjs` → `src/AGENTS.md`, and `permissions` **inlined** in the root
  `AGENTS.md`. Flag any content that drifted between a rule and its mirror.
- **Librarian subagent:** `.claude/agents/librarian.md` and
  `.codex/agents/librarian.toml` must describe the same librarian (process,
  principles, standing environment facts). Codex must **duplicate the instructions
  inline** — flag it if it merely references the `.md`. Flag any divergence.
- **Commands ↔ skills:** every `.claude/commands/*.md` has a matching
  `.agents/skills/*/SKILL.md` and vice-versa. Same intent; expected adaptations are
  fine (`$ARGUMENTS` → prose scoping, "the Agent tool" → Codex subagents,
  `AskUserQuestion` → ask-in-chat). Flag missing counterparts or substantive drift.
- **Permissions:** `.claude/settings.json` `allow`/`ask` ↔ `.codex/rules/default.rules`
  `prefix_rule` entries should cover the same commands. Flag anything allowed on one
  side but not the other.
- **Hooks:** `.claude/settings.json` `hooks` ↔ `.codex/hooks.json` should fire
  equivalent behavior (prune `docs/plans` on SessionStart; Biome format on Stop).
  Flag events present on only one side.

## 4. Correctness & vendor-alignment checks

- Discovery paths are correct per tool (skills at `.agents/skills/`, subagents at
  `.codex/agents/*.toml`, and Codex "rules" are command-permission **Starlark**, not
  instructions).
- Frontmatter/schema valid: skill `name`+`description`; subagent
  `name`+`description`+`developer_instructions`; `config.toml` enables what's used.
- Trigger descriptions are specific enough to auto-invoke, not so broad they misfire
  or overlap.
- Nested `AGENTS.md` sit at the right **common-ancestor** directory given Codex's
  cwd-based (root → cwd, once per session) loading; root `AGENTS.md` stays within
  Codex's ~32 KiB `project_doc_max_bytes` budget.
- Hooks enabled (`[features] hooks = true`), scripts executable, paths robust.
- Nothing relies on a feature a newer tool version renamed or deprecated.

## 5. Improvement opportunities

Beyond parity, be a collaborator: recommend improvements — context efficiency, better
delegation, newly-shipped vendor features worth adopting, redundant or overbroad
triggers, anything that would make either setup better.

## Output

- **🔴 Parity drift** — where the runtimes disagree (mirrored content that diverged,
  missing counterparts). Most important first; give both file paths and the exact
  difference.
- **🟡 Correctness / staleness** — schema errors, wrong discovery paths, deprecated
  features, weak/overbroad triggers, budget risks.
- **🟢 Improvement recommendations** — concrete upgrades to either setup, with the why.
- **✅ Verified in sync** — what you checked and found correctly mirrored.
- **Consulted sources** — docs and versions you checked, with links or local paths.

End with a one-line verdict (**IN SYNC** / **DRIFTED**) and the top 3 things to fix.
**Do not modify any files** unless I explicitly ask. If I do ask you to fix drift,
mirror every change on **both** runtimes and re-run this audit to confirm.
