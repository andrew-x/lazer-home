#!/usr/bin/env bash
# SessionStart hook — mirrors the Claude Code SessionStart hook in
# .claude/settings.json: prune scratch plans older than two weeks.
# docs/plans is scratch space (see AGENTS.md "Plans and specs"), not durable docs.
set -u

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
plans_dir="$repo_root/docs/plans"

if [ -d "$plans_dir" ]; then
  find "$plans_dir" -type f -mtime +14 ! -name '.gitkeep' -delete 2>/dev/null || true
fi
