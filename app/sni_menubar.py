#!/usr/bin/env python3
"""SNI Research — macOS menu bar app.

Manages the local ingest server (bun scripts/server.js) and shows
status in the menu bar. Green dot = running, red dot = stopped.
"""

import os
import signal
import subprocess
import urllib.request
import urllib.error
import rumps

# ─── Configuration ────────────────────────────────────────────────────────────

BUN_PATH = os.path.expanduser("~/.bun/bin/bun")
PROJECT_ROOT = os.path.expanduser("~/Projects/sni-research-v2")
SERVER_PORT = 3847
HEALTH_URL = f"http://localhost:{SERVER_PORT}/health"
LOG_PATH = os.path.join(PROJECT_ROOT, "app", "server.log")
ERROR_LOG_PATH = os.path.join(PROJECT_ROOT, "app", "server-error.log")

ICON_GREEN = "●"  # Server running
ICON_RED = "●"     # Server stopped

# ─── App ──────────────────────────────────────────────────────────────────────

class SNIResearchApp(rumps.App):
    def __init__(self):
        super().__init__("SNI", quit_button=None)
        self.server_process = None
        self.user_stopped = False

        # Menu items
        self.status_item = rumps.MenuItem("Starting server...")
        self.toggle_item = rumps.MenuItem("Stop Server", callback=self.toggle_server, key="s")

        self.menu = [
            self.status_item,
            None,  # separator
            self.toggle_item,
            None,
            rumps.MenuItem("Open Data Folder", callback=self.open_data_folder, key="d"),
            rumps.MenuItem("View Server Log", callback=self.view_log, key="l"),
            None,
            rumps.MenuItem("Quit SNI Research", callback=self.quit_app, key="q"),
        ]

        # Start server on launch
        self.start_server()

        # Health check timer (every 5 seconds)
        self.health_timer = rumps.Timer(self.check_health, 5)
        self.health_timer.start()

        # Initial health check after 2 seconds (let server boot)
        rumps.Timer(self.check_health, 2).start()

    # ─── Server Management ────────────────────────────────────────────────────

    def start_server(self):
        if self.server_process and self.server_process.poll() is None:
            return  # Already running

        self.user_stopped = False

        # Ensure log directory exists
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)

        # Build environment with bun in PATH
        env = os.environ.copy()
        bun_dir = os.path.dirname(BUN_PATH)
        env["PATH"] = f"{bun_dir}:{env.get('PATH', '/usr/local/bin:/usr/bin:/bin')}"

        try:
            log_out = open(LOG_PATH, "a")
            log_err = open(ERROR_LOG_PATH, "a")

            self.server_process = subprocess.Popen(
                [BUN_PATH, "scripts/server.js"],
                cwd=PROJECT_ROOT,
                env=env,
                stdout=log_out,
                stderr=log_err,
                preexec_fn=os.setsid,  # New process group for clean kill
            )
        except Exception as e:
            print(f"Failed to start server: {e}")
            self.update_status(False)

    def stop_server(self):
        self.user_stopped = True
        if self.server_process and self.server_process.poll() is None:
            try:
                # Send SIGTERM to process group
                os.killpg(os.getpgid(self.server_process.pid), signal.SIGTERM)
            except (ProcessLookupError, OSError):
                pass

    # ─── Health Check ─────────────────────────────────────────────────────────

    def check_health(self, _=None):
        try:
            req = urllib.request.Request(HEALTH_URL)
            with urllib.request.urlopen(req, timeout=2) as resp:
                is_up = resp.status == 200
        except Exception:
            is_up = False

        self.update_status(is_up)

        # Auto-restart if crashed (not user-stopped)
        if not is_up and not self.user_stopped:
            if self.server_process and self.server_process.poll() is not None:
                self.start_server()

    def update_status(self, is_up):
        if is_up:
            self.title = ICON_GREEN
            self.status_item.title = f"Server running on :{SERVER_PORT}"
            self.toggle_item.title = "Stop Server"
        else:
            self.title = ICON_RED
            self.status_item.title = "Server stopped"
            self.toggle_item.title = "Start Server"

    # ─── Menu Actions ─────────────────────────────────────────────────────────

    def toggle_server(self, _):
        if self.server_process and self.server_process.poll() is None:
            self.stop_server()
        else:
            self.start_server()

    def open_data_folder(self, _):
        data_dir = os.path.join(PROJECT_ROOT, "data", "verified")
        os.makedirs(data_dir, exist_ok=True)
        subprocess.Popen(["open", data_dir])

    def view_log(self, _):
        # Create log file if it doesn't exist
        if not os.path.exists(LOG_PATH):
            open(LOG_PATH, "w").close()
        subprocess.Popen(["open", "-a", "Console", LOG_PATH])

    def quit_app(self, _):
        self.stop_server()
        rumps.quit_application()


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    SNIResearchApp().run()
