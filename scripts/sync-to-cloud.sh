#!/bin/bash
set -euo pipefail

# Push local data to Fly.io cloud server via tar-over-SSH
# Usage: ./scripts/sync-to-cloud.sh

APP_NAME="${SNI_FLY_APP:-sni-research}"

echo "Syncing local data to $APP_NAME..."

# Push data directories (write-once content from pipeline)
tar czf - \
  --exclude='*.tmp' --exclude='*.bak' --exclude='*.lock' \
  --exclude='backups/' \
  data/verified/ \
  data/editorial/ \
  data/podcasts/ \
  config/ \
  output/ \
  | fly ssh console -a "$APP_NAME" -C "tar xzf - -C /app"

echo "Sync complete: $(date)"
