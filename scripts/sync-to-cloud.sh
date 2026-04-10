#!/bin/bash
set -euo pipefail

# Push local data to Fly.io cloud server.
#
# Approach: tar locally, upload via fly ssh sftp (reliable for binary blobs),
# then run a remote command to extract. The earlier `tar | fly ssh console -C`
# pipe stalls on large transfers because Fly's SSH wrapper buffers stdin.
#
# Usage: ./scripts/sync-to-cloud.sh

APP_NAME="${SNI_FLY_APP:-sni-research}"
TARBALL="/tmp/sni-sync-$$.tar.gz"
REMOTE_TARBALL="/tmp/sni-sync.tar.gz"

cleanup() {
  rm -f "$TARBALL"
}
trap cleanup EXIT

echo "[1/4] Creating tarball: $TARBALL"
tar czf "$TARBALL" \
  --exclude='*.tmp' --exclude='*.bak' --exclude='*.lock' \
  --exclude='backups/' \
  data/verified/ \
  data/editorial/ \
  data/podcasts/ \
  config/ \
  output/

SIZE=$(du -h "$TARBALL" | awk '{print $1}')
echo "[1/4] Tarball ready: $SIZE"

echo "[2/4] Uploading to $APP_NAME via SFTP..."
# fly ssh sftp shell expects commands on stdin
echo "put $TARBALL $REMOTE_TARBALL" | fly ssh sftp shell -a "$APP_NAME"

echo "[3/4] Extracting on remote..."
fly ssh console -a "$APP_NAME" -C "sh -c 'tar xzf $REMOTE_TARBALL -C /app && rm $REMOTE_TARBALL'"

echo "[4/4] Verifying remote /app/data..."
fly ssh console -a "$APP_NAME" -C "sh -c 'du -sh /app/data/verified /app/data/editorial /app/data/podcasts /app/output 2>/dev/null'"

echo "Sync complete: $(date)"
