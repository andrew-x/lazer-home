/// <reference types="bun-types" />

// Bun's ambient types (e.g. the `bun:test` module used in *.test.ts files).
// `@types/bun` isn't auto-discovered by tsc under this tsconfig, so we pull it
// in explicitly here — mirrors the role of next-env.d.ts for Next.js types.
