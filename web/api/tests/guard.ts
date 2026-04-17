// Safety preload for `bun test` run from the web/api directory. Sets
// SNI_TEST_MODE=1 before any test file loads so getDb() returns an
// in-memory client instead of production Turso.
//
// Two preloads are needed because web/api/ has its own package.json.
// When `cd web/api && bun test` runs, Bun treats web/api as the
// project root and stops walking upward — the root bunfig.toml at
// the repo root is never seen. This file, referenced from
// web/api/bunfig.toml, covers that path. The parallel preload at
// scripts/test-preload.ts covers tests invoked from the repo root.
//
// DO NOT REMOVE. The hard guard in web/api/lib/db.js
// (isRunningUnderBunTest) will throw if this preload silently fails
// and SNI_TEST_MODE stays unset. See the 2026-04-17 data-loss
// incident in the db.js comments for background.
process.env.SNI_TEST_MODE = '1'
