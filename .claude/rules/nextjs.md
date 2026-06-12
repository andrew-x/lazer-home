---
paths:
  - "app/**"
  - "src/**"
  - "components/**"
  - "**/*.tsx"
  - "**/*.ts"
---

# Working with this (modified) Next.js

This repo pins a Next.js build with **breaking changes** vs. public releases. Your training data is likely wrong about its APIs, file conventions, and config.

**Before writing or editing any Next.js code:**
1. Read the relevant guide under `node_modules/next/dist/docs/` for the API you're about to use (routing, data fetching, config, etc.).
2. Heed any deprecation notices there over your prior assumptions.
3. If a public-Next.js pattern you "know" isn't confirmed by those docs, verify before using it.

For library/framework APIs generally, prefer the Context7 docs MCP over memory.
