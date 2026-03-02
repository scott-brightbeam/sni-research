#!/bin/bash
set -e
cd "$(dirname "$0")"

# 1. Build
./build.sh

# 2. Copy to Applications
APP_NAME="SNI Research.app"
DEST="/Applications/$APP_NAME"
echo "Installing to $DEST..."
rm -rf "$DEST"
cp -R "$APP_NAME" "$DEST"

# 3. Install LaunchAgent
PLIST_NAME="com.scott.sni-research.plist"
PLIST_DIR="$HOME/Library/LaunchAgents"
mkdir -p "$PLIST_DIR"

# Unload existing if present
launchctl unload "$PLIST_DIR/$PLIST_NAME" 2>/dev/null || true

cat > "$PLIST_DIR/$PLIST_NAME" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.scott.sni-research</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Applications/SNI Research.app/Contents/MacOS/SNIResearch</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/scott/Projects/sni-research-v2/app/app.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/scott/Projects/sni-research-v2/app/app-error.log</string>
</dict>
</plist>
PLIST

# 4. Load the LaunchAgent
launchctl load "$PLIST_DIR/$PLIST_NAME"

echo ""
echo "✓ SNI Research installed and running"
echo "  Menu bar: green dot = server active"
echo "  LaunchAgent: starts automatically at login"
echo ""
