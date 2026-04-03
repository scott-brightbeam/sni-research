#!/bin/bash
set -euo pipefail

# Pull cloud-side writes back to local machine via tar-over-SSH
# Usage: ./scripts/sync-from-cloud.sh

APP_NAME="${SNI_FLY_APP:-sni-research}"

echo "Pulling cloud-side writes from $APP_NAME..."

# Pull directories that team members write to on the cloud
fly ssh console -a "$APP_NAME" -C "tar czf - -C /app data/copilot/ data/audit/" \
  | tar xzf - -C .

echo "Pull complete: $(date)"
