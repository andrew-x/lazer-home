# 0002 — The pinned Next.js is modified; verify against bundled docs

**Status:** accepted · 2026-06-12

## Context

This repo pins a Next.js build with breaking changes vs. public releases. Models' training data describes a different Next.js, so writing code from memory risks using wrong or deprecated APIs and conventions.

## Decision

Before writing any Next.js code, read the relevant guide under `node_modules/next/dist/docs/` and follow it over prior assumptions. This is enforced two ways: a top-level note in `AGENTS.md`, and a path-scoped rule (`.claude/rules/nextjs.md`) that loads automatically when app code (`app/**`, `src/**`, `components/**`, `*.ts(x)`) is touched.

## Consequences

- Slightly more upfront reading before Next.js work — accepted, because guessing the API is more expensive.
- The path-scoped rule keeps the detailed guidance out of always-on context (progressive disclosure).
