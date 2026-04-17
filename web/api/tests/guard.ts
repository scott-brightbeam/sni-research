// Safety preload for `cd web/api && bun test`. Sets SNI_TEST_MODE=1 so
// getDb() returns an in-memory client instead of production Turso.
// Pair-enforced by the isRunningUnderBunTest guard in web/api/lib/db.js.
// DO NOT REMOVE without understanding the 2026-04-17 data-loss incident.
process.env.SNI_TEST_MODE = '1'
