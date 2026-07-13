#!/usr/bin/env bash
# Stop hook — mirrors the Claude Code Stop hook in .claude/settings.json:
# auto-format the tree with Biome when the turn ends. Best-effort; never fails the turn.
set -u

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root" 2>/dev/null || exit 0

bunx biome check --write . >/dev/null 2>&1 || true
