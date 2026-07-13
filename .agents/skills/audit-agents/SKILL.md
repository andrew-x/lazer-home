---
name: audit-agents
description: Use when reviewing or changing the agent setup — AGENTS.md, nested AGENTS.md, skills, subagents, rules, hooks, or Codex/Claude Code config. Inventories both runtimes' setups, verifies they are in sync (the setup is deliberately duplicated), checks against current vendor docs, and reports parity drift, correctness issues, and improvement recommendations. Read-only.
---

# Audit agent setups (Claude Code ↔ Codex)

Verify that the two coding-agent runtimes configured in this repo are healthy and in
lockstep: **Codex** (`.codex/` + `.agents/skills/` + the nested `AGENTS.md` files) and
**Claude Code** (`.claude/`). They mirror each other by **full duplication, not
symlinks or references** (see `AGENTS.md` → "Agent runtimes"). Duplication drifts —
this audit catches the drift, checks both sides against current vendor guidance, and
recommends improvements.

This is a **read-only audit** — investigate and report; do **NOT** change any files
unless the user explicitly asks you to.

If the user named a focus area when invoking this skill (e.g. "rules", "hooks",
"skills", "librarian"), audit only that area; otherwise audit the whole setup.

## 1. Inventory both setups

Read every instruction/agent file on both sides and list what exists:

- **Shared:** `AGENTS.md` (root) + nested `src/AGENTS.md`, `src/actions/AGENTS.md`,
  `src/lib/db/AGENTS.md`; `CLAUDE.md` (should just import `@AGENTS.md`).
- **Codex:** `.codex/config.toml`, `.codex/rules/*.rules`, `.codex/hooks.json` +
  `.codex/hooks/*`, `.codex/agents/*.toml`, `.agents/skills/*/SKILL.md`
  (+ any `agents/openai.yaml`).
- **Claude Code:** `.claude/settings.json` (+ `.claude/settings.local.json` if
  present), `.claude/agents/*.md`, `.claude/commands/*.md`, `.claude/rules/*.md`.

## 2. Consult the latest vendor guidance

These tools change fast and some behavior may be newer than your training — don't
judge from memory. Pull current docs first:

- **Codex:** the OpenAI Codex docs — config reference, rules, skills, subagents,
  hooks, and AGENTS.md discovery. Use the `openaiDeveloperDocs` MCP server if it's
  available; otherwise fetch from learn.chatgpt.com / developers.openai.com. Note the
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
- **Librarian subagent:** `.codex/agents/librarian.toml` and
  `.claude/agents/librarian.md` must describe the same librarian (process,
  principles, standing environment facts). The Codex TOML must **duplicate the
  instructions inline** — flag it if it merely references the `.md`. Flag divergence.
- **Skills ↔ commands:** every `.agents/skills/*/SKILL.md` has a matching
  `.claude/commands/*.md` and vice-versa. Same intent; expected adaptations are fine
  (`$ARGUMENTS` → prose scoping, "the Agent tool" → Codex subagents,
  `AskUserQuestion` → ask-in-chat). Flag missing counterparts or substantive drift.
- **Permissions:** `.codex/rules/default.rules` `prefix_rule` entries ↔
  `.claude/settings.json` `allow`/`ask` should cover the same commands. Flag anything
  allowed on one side but not the other.
- **Hooks:** `.codex/hooks.json` ↔ `.claude/settings.json` `hooks` should fire
  equivalent behavior (prune `docs/plans` on SessionStart; Biome format on Stop).
  Flag events present on only one side.

## 4. Correctness & vendor-alignment checks

- Discovery paths are correct per tool (skills at `.agents/skills/`, subagents at
  `.codex/agents/*.toml`, and Codex "rules" are command-permission **Starlark**, not
  instructions).
- Frontmatter/schema valid: skill `name`+`description`; subagent
  `name`+`description`+`developer_instructions`; `config.toml` enables what's used
  (`[features] hooks`, `multi_agent`).
- Trigger descriptions are specific enough to auto-invoke, not so broad they misfire
  or overlap.
- Nested `AGENTS.md` sit at the right **common-ancestor** directory given Codex's
  cwd-based (root → cwd, once per session) loading; root `AGENTS.md` stays within the
  ~32 KiB `project_doc_max_bytes` budget.
- Hooks enabled, scripts executable, paths robust.
- Nothing relies on a feature a newer tool version renamed or deprecated.

## 5. Improvement opportunities

Beyond parity, be a collaborator: recommend improvements — context efficiency, better
delegation, newly-shipped vendor features worth adopting, redundant or overbroad
triggers, anything that would make either setup better.

## Output

Report:

- **🔴 Parity drift** — where the runtimes disagree (mirrored content that diverged,
  missing counterparts). Most important first; give both file paths and the exact
  difference.
- **🟡 Correctness / staleness** — schema errors, wrong discovery paths, deprecated
  features, weak/overbroad triggers, budget risks.
- **🟢 Improvement recommendations** — concrete upgrades to either setup, with the why.
- **✅ Verified in sync** — what you checked and found correctly mirrored.
- **Consulted sources** — docs and versions you checked, with links or local paths.

End with a one-line verdict (**IN SYNC** / **DRIFTED**) and the top 3 things to fix.
Stay **read-only** unless the user explicitly asks you to fix drift; if they do, mirror
every change on **both** runtimes and re-run this audit to confirm.
