// Safety preload for `bun test` run from the repo root. Sets
// SNI_TEST_MODE=1 before any test file loads so getDb() returns an
// in-memory client instead of production Turso.
//
// DO NOT REMOVE. The hard guard in web/api/lib/db.js (isRunningUnderBunTest)
// will throw if this preload silently fails and SNI_TEST_MODE stays
// unset. See also web/api/tests/guard.ts, the parallel preload for when
// tests are invoked from `cd web/api && bun test`.
//
// Root cause of the 2026-04-17 data-loss incident: this preload existed
// but was referenced with a bare relative path in bunfig.toml, which
// Bun silently failed to resolve. The `./` prefix in the bunfig is
// required.
process.env.SNI_TEST_MODE = '1'
