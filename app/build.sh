#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "Setting up SNI Research..."

# 1. Create/update Python venv
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

echo "Installing dependencies..."
venv/bin/pip install -q rumps 2>&1 | grep -v "already satisfied" || true

# 2. Create .app bundle
APP_NAME="SNI Research.app"
rm -rf "$APP_NAME"
mkdir -p "$APP_NAME/Contents/MacOS"
mkdir -p "$APP_NAME/Contents/Resources"

# 3. Write launcher script (absolute paths since .app is copied to /Applications)
APP_DIR="$(pwd)"
cat > "$APP_NAME/Contents/MacOS/SNIResearch" << LAUNCHER
#!/bin/bash
exec "$APP_DIR/venv/bin/python3" "$APP_DIR/sni_menubar.py"
LAUNCHER
chmod +x "$APP_NAME/Contents/MacOS/SNIResearch"

# 4. Write Info.plist (LSUIElement=true hides from Dock)
cat > "$APP_NAME/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>SNIResearch</string>
    <key>CFBundleIdentifier</key>
    <string>com.scott.sni-research</string>
    <key>CFBundleName</key>
    <string>SNI Research</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>14.0</string>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
PLIST

echo "✓ Built: $APP_NAME"
