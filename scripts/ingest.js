/**
 * ingest.js - CLI tool for manual article ingestion
 *
 * Usage:
 *   bun scripts/ingest.js <url>
 *   bun scripts/ingest.js <url> --sector insurance
 */

import { ingestArticle } from './server.js';

const argv = process.argv.slice(2);
let url = null;
let sectorOverride = undefined;

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--sector') {
    sectorOverride = argv[++i];
  } else if (!argv[i].startsWith('--')) {
    url = argv[i];
  }
}

if (!url) {
  console.error('Usage: bun scripts/ingest.js <url> [--sector <sector>]');
  console.error('Sectors: general, biopharma, medtech, manufacturing, insurance');
  process.exit(1);
}

const result = await ingestArticle({ url, sectorOverride });
console.log(JSON.stringify(result, null, 2));
process.exit(result.error ? 1 : 0);
