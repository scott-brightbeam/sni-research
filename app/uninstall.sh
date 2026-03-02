#!/bin/bash
set -e

PLIST_NAME="com.scott.sni-research.plist"
PLIST_DIR="$HOME/Library/LaunchAgents"

echo "Uninstalling SNI Research..."

# Stop LaunchAgent
launchctl unload "$PLIST_DIR/$PLIST_NAME" 2>/dev/null || true
rm -f "$PLIST_DIR/$PLIST_NAME"

# Remove app
rm -rf "/Applications/SNI Research.app"

echo "✓ SNI Research uninstalled"
