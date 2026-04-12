/**
 * Bun test preload: sets SNI_TEST_MODE=1 before any test file runs.
 *
 * This prevents editorial-analyse tests from spawning real pipeline
 * scripts that hit the Anthropic API ($85+ per accidental run).
 *
 * Loaded automatically via bunfig.toml [test].preload.
 */
process.env.SNI_TEST_MODE = '1'
