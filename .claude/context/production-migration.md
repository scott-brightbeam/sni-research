# Production migration checklist

Move the SNI codebase from the current dev machine (MacBook Pro, `/Users/scott/Projects/sni-research-v2`) to a production machine. This document is the complete checklist — if you're reading it cold, you should be able to migrate in a single sitting.

**The target production machine must run macOS** (launchd, AppleScript for iMessage, `~/Desktop/Podcast Transcripts/` convention). A Linux prod machine would require rewriting the scheduler layer and the notify path.

**Two repos move together:**
1. `sni-research-v2` — the main codebase (GitHub: `scott-brightbeam/sni-research`)
2. `~/Projects/Claude/HomeBrew/podcasts/` — the Python podcast transcription pipeline (NOT on GitHub as of 2026-04-22; first two files were committed to `~/Projects/Claude/` git this week)

---

## 1. Prerequisites on the new machine

Install before touching anything else:

| Tool | Version | Install |
|------|---------|---------|
| Bun | 1.3.9 | `curl -fsSL https://bun.sh/install \| bash` (pin via `bun upgrade --canary` if needed) |
| Node | v22.17.1 | Volta or nvm — used by subscription scripts only |
| Python | 3.13 | `brew install python@3.13` — used by the podcast pipeline |
| ffmpeg | latest | `brew install ffmpeg` (required by `transcript_whisper.py`) |
| yt-dlp | latest | `brew install yt-dlp` (required by `transcript_youtube.py`) |
| Git | 2.53+ | `brew install git` |
| Fly CLI | latest | `curl -L https://fly.io/install.sh \| sh` |
| gh CLI | latest | `brew install gh` |
| Homebrew (Apple Silicon) | — | `/opt/homebrew/bin` is the hardcoded ffmpeg/ffprobe path in `transcript_whisper.py` — Intel Macs use `/usr/local/bin` and the code falls back automatically |

---

## 2. Clone the repos

```bash
# Main repo
mkdir -p ~/Projects
cd ~/Projects
git clone https://github.com/scott-brightbeam/sni-research.git sni-research-v2
cd sni-research-v2

# Podcast pipeline — bring your own (not yet on GitHub as a standalone)
mkdir -p ~/Projects/Claude/HomeBrew
# Rsync from the old machine:
#   rsync -avz old-mac:~/Projects/Claude/HomeBrew/podcasts/ ~/Projects/Claude/HomeBrew/podcasts/
# OR restore from backup. The repo at ~/Projects/Claude/ tracks only the scripts/
# committed this week; config.json, feeds.json, episodes-log.json are untracked.
```

---

## 3. Activate the pre-push hook (NEW CLONE REQUIREMENT)

```bash
cd ~/Projects/sni-research-v2
git config core.hooksPath scripts/git-hooks
```

Without this, `git push origin master` won't trigger `fly deploy`. GitHub and Fly will drift.

Verify:
```bash
git config core.hooksPath  # should print: scripts/git-hooks
ls -l scripts/git-hooks/pre-push  # should be executable
```

---

## 4. Secrets & environment

### `.env` file (main repo)

Copy from the old machine (`scp old-mac:~/Projects/sni-research-v2/.env .env`) or recreate. Required keys:

| Key | Source / notes |
|-----|----------------|
| `BRAVE_API_KEY` | https://brave.com/search/api/ dashboard |
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys — used by Whisper, GPT critique, evaluation |
| `GOOGLE_AI_API_KEY` | https://aistudio.google.com/apikey — Gemini critique + Google Search grounding |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys — still used by `scripts/editorial-draft.js` and the Fly web app |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Existing Zaphod bot; ask Scott for credentials |
| `AINEWSHUB_EMAIL` + `AINEWSHUB_PASSWORD` | Scott's AI NewsHub premium account |
| `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` | `turso db show sni-research --url` and `turso db tokens create sni-research` |

Optional keys (have sensible defaults but set if you want them):

| Key | Purpose |
|-----|---------|
| `SNI_NOTIFY_RECIPIENT` | iMessage handle for `scripts/notify.js` |
| `SNI_EDITORIAL_DIR` | Override `data/editorial/` path (rarely needed) |
| `SNI_ROOT` | Override project root detection (rarely needed) |
| `SNI_SESSION_SECRET` | Cookie signing for the authenticated web session (required if Fly auth is enabled) |
| `SNI_CREDENTIAL_FILE` + `SNI_CREDENTIAL_KEY` | Encrypted credential vault for subscription scripts (HBR, Economist cookies etc.). `SNI_CREDENTIAL_KEY` is hex-encoded and PBKDF2-derived. |

### Podcast pipeline config (`~/Projects/Claude/HomeBrew/podcasts/config.json`)

Separate from the main `.env`. Contains:
```json
{
  "openaiApiKey": "sk-..."
}
```
Copy from old machine.

### Fly credentials

The Fly token lives in `~/.fly/` — NOT in `.env`, NOT in GitHub Secrets. Two options on the new machine:

```bash
# Option A: re-authenticate (preferred — fresh token)
fly auth login

# Option B: copy the token file from the old machine
scp -r old-mac:~/.fly ~/.fly
chmod 600 ~/.fly/config.yml
```

Verify:
```bash
fly status --app sni-research
```

---

## 5. Data migration

Everything under `data/` and `output/` is gitignored. Pick one:

### Option A: Pull from Turso (partial — articles + editorial state only)

This gets the _queried_ state back but not the raw article bodies, transcripts, chat history, or drafts. OK for read-only browsing, not OK for resuming editorial work.

```bash
# Start fresh data dirs
mkdir -p data/verified data/podcasts data/editorial output logs

# The web API reads from Turso directly — you don't need data/ files locally
# to serve the dashboard. But you DO need them to run pipeline scripts.
```

### Option B: Rsync from the old machine (preferred — complete)

```bash
rsync -avz --progress old-mac:~/Projects/sni-research-v2/data/ ./data/
rsync -avz --progress old-mac:~/Projects/sni-research-v2/output/ ./output/
rsync -avz --progress old-mac:~/Projects/sni-research-v2/logs/ ./logs/
rsync -avz --progress 'old-mac:~/Desktop/Podcast Transcripts/' ~/Desktop/Podcast\ Transcripts/
```

Expected sizes (approx 2026-04-22): `data/` ~3GB, `output/` ~50MB, `~/Desktop/Podcast Transcripts/` ~500MB.

### Option C: Fresh start (only if acceptable)

Start with empty `data/`, let the daily pipeline rebuild from scratch over the next week. You'll lose historical `state.json` (analysisIndex, themeRegistry, postBacklog, editorialAudits).

---

## 6. Install dependencies

```bash
# Main repo — two package.json files
cd ~/Projects/sni-research-v2

# Root bun install is optional — only if root scripts need deps
bun install

# Web API deps (required for web/api/server.js and for tests)
cd web/api && bun install && cd ../..

# Web app deps
cd web/app && bun install && cd ../..

# Podcast pipeline — Python deps
cd ~/Projects/Claude/HomeBrew/podcasts
# Typically just stdlib + ffmpeg/yt-dlp binaries; no pip install required
# If that changes, a requirements.txt needs to be created at that time
```

---

## 7. Verify everything runs locally

```bash
cd ~/Projects/sni-research-v2

# 1. Tests pass
SNI_TEST_MODE=1 bun test
# Expect: ~885 pass, ~19 skip, 0 fail (19 skips are integration tests
# that skip when no server / fixtures are present — normal)

# 2. Frontend build clean
cd web/app && bun run build && cd ../..
# Expect: 0 errors

# 3. Start the API server
bun --watch web/api/server.js &
# Visit http://localhost:3900/api/health — should return 200

# 4. Start the Vite dev server
cd web/app && bun run dev
# Visit http://localhost:5173 — full UI

# 5. Pipeline dry-run
bun scripts/pipeline.js --mode daily --dry-run
```

If any of these fail, fix before proceeding.

---

## 8. Install launchd jobs

All launchd plists reference absolute paths. They need rewriting for the new user's `$HOME`.

```bash
# The plists currently live at ~/Library/LaunchAgents/ on the old machine
# They reference /Users/scott/ and /Users/scott/.bun/bin/bun — both need updating.

# The plists are NOT in the repo. Copy from the old machine then rewrite paths:
rsync -av old-mac:~/Library/LaunchAgents/com.sni.* ~/Library/LaunchAgents/
rsync -av old-mac:~/Library/LaunchAgents/com.scott.podcast-pipeline.plist ~/Library/LaunchAgents/

# Rewrite paths (change /Users/scott to $HOME equivalent)
cd ~/Library/LaunchAgents
NEW_USER=$(whoami)
for f in com.sni.*.plist com.scott.podcast-pipeline.plist; do
  sed -i '' "s|/Users/scott|/Users/$NEW_USER|g" "$f"
done

# Load them
for f in com.sni.*.plist com.scott.podcast-pipeline.plist; do
  launchctl unload "$f" 2>/dev/null || true
  launchctl load "$f"
done

# Verify
launchctl list | grep -E "sni|podcast"
```

**All launchd jobs (by frequency):**

| Plist | Schedule | Script |
|-------|----------|--------|
| `com.sni.ainewshub.plist` | 03:30 daily | `scripts/ainewshub-fetch.js` |
| `com.sni.fetch.plist` | 04:00 daily | `scripts/fetch.js` |
| `com.sni.alerts-post-fetch.plist` | 04:45 daily | `scripts/pipeline-alerts.js` |
| `com.sni.sync-to-cloud.plist` | 07:40, 13:00, 22:00 | `scripts/sync-to-turso.js` |
| `com.sni.alerts-post-satellite.plist` | 08:00 daily | `scripts/pipeline-alerts.js` |
| `com.sni.pipeline.plist` | Thursday 13:00 | `scripts/pipeline.js` (full Thursday run) |
| `com.scott.podcast-pipeline.plist` | 22:00, 23:00, 00:00, 02:00, 04:00, 06:00 | `~/Projects/Claude/HomeBrew/podcasts/scripts/run_pipeline.py` |
| `com.sni.podcast-import.plist.disabled` | — | Keep disabled; replaced by the Claude Code `podcast-import-daily` task |

---

## 9. Register Claude Code scheduled tasks

The SKILL.md files at `~/.claude/scheduled-tasks/*/SKILL.md` define the tasks. The scheduler itself is an MCP-backed service — its state is NOT in the repo.

```bash
# Copy SKILL.md files from the old machine
rsync -av old-mac:~/.claude/scheduled-tasks/ ~/.claude/scheduled-tasks/

# Then register each task with the scheduler via Claude Code. Open a Claude
# Code session and ask:
#   "List my scheduled tasks"   (see what's registered)
#   "Schedule editorial-analyse-daily to run at 07:30 daily"   (per task)
```

**Tasks to register:**

| Task | Suggested schedule |
|------|--------------------|
| `podcast-import-daily` | 07:00 daily |
| `editorial-analyse-daily` | 07:30 daily |
| `editorial-audit-upstream-daily` | 08:00 daily *(register after 2 manual `/editorial-audit-upstream` runs look clean)* |
| `editorial-discover` | 09:00 daily |
| `editorial-headlines` | 10:30 daily |
| `editorial-geographic-sweep` | 11:00 daily |
| `editorial-wednesday-sweep` | Wednesday 20:00 |
| `editorial-quality-digest` | Sunday or Monday (weekly) |
| `vocabulary-fingerprint-refresh` | Sunday (weekly) |
| `pipeline-weekly-newsletter` | Thursday 14:00 |
| `editorial-critique-revise` | On-demand (no schedule) |
| `bug-triage` | On-demand (no schedule) |

---

## 10. Fly deployment

The Fly app is `sni-research` in region `lhr`. Configuration lives at `fly.toml` in the repo root.

```bash
# Verify the app exists and your token works
fly status --app sni-research

# First deploy from the new machine (after activating the pre-push hook,
# this happens automatically on push — but you can force one manually):
fly deploy --remote-only

# Writing-preferences.md is gitignored but shipped to the Fly volume
# separately. After first deploy, sync it:
fly ssh console --app sni-research -C "sh -c 'rm /app/data/editorial/writing-preferences.md && echo removed'"

# Then SFTP upload
fly ssh sftp shell --app sni-research <<'EOF'
put data/editorial/writing-preferences.md /app/data/editorial/writing-preferences.md
EOF
```

Fly secrets (set via `fly secrets set` if not already present):
- `ANTHROPIC_API_KEY`
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
- `SNI_SESSION_SECRET` (if auth enabled)

Verify:
```bash
fly secrets list --app sni-research
curl -fsS https://sni-research.fly.dev/api/health
```

---

## 11. Hard-coded paths that need attention on production

Grep for `/Users/scott` and `~/Desktop` and `~/Projects/Claude`:

| Path | Where | Change required? |
|------|-------|------------------|
| `~/Desktop/Podcast Transcripts/` | Hardcoded in podcast pipeline (`run_pipeline.py:make_transcript_md`, `retranscribe.py`) and in `.claude/commands/editorial-analyse.md` | The new user's `$HOME/Desktop` must contain this dir, OR the pipeline must be updated to use a configurable path |
| `~/Projects/Claude/HomeBrew/podcasts/` | Referenced in `CLAUDE.md` and a few skill docs | The new machine must host it at the same path, OR the references must be updated |
| `/Users/scott/.bun/bin/bun` | Absolute path in every launchd plist's ProgramArguments | Step 8 above rewrites this |
| `/Users/scott/Projects/sni-research-v2` | Absolute WorkingDirectory in every launchd plist | Step 8 above rewrites this |
| `/Users/scott/.fly/bin:$PATH` | In some launchd plists that invoke `fly` | Step 8 above rewrites this (but check manually — the `:` in PATH can trip `sed`) |

There are NO hardcoded paths in the main Bun/Node/React code beyond what's listed above. All other paths use `import.meta.dir` + `resolve()` relative to the file location.

---

## 12. Credentials for subscription scripts

`scripts/lib/credential-store.js` implements an AES-256-GCM encrypted vault for subscription-source cookies (HBR, Economist, Endpoints News, etc.).

If the old machine has `~/Projects/sni-research-v2/.credentials.enc` or `$SNI_CREDENTIAL_FILE`, copy it. You also need `SNI_CREDENTIAL_KEY` (hex string) from the old machine's environment — without the key, the vault can't be decrypted.

```bash
# Copy the vault file if present
scp old-mac:~/Projects/sni-research-v2/.credentials.enc .credentials.enc

# Ensure SNI_CREDENTIAL_KEY is set in .env
```

If the key is lost: re-enter the cookies by running the subscription fetch scripts interactively.

---

## 13. Health check

Before cutting over cron on the old machine, verify the new machine's pipeline independently:

```bash
# 1. Dry-run the main pipeline
bun scripts/pipeline.js --mode daily --dry-run

# 2. Run sync-to-turso manually
SNI_TEST_MODE=0 bun scripts/sync-to-turso.js

# 3. Check articles in Turso are fresh
SNI_TEST_MODE=0 bun -e "
  import { getDb } from './web/api/lib/db.js'
  const db = getDb()
  const r = await db.execute('SELECT MAX(date_published) AS latest FROM articles')
  console.log('Latest article date:', r.rows[0].latest)
"

# 4. Trigger one Claude Code scheduled task manually
#    (open a Claude Code session, run /editorial-analyse)

# 5. Fire one Whisper transcription on a new episode (if any in the feed)
cd ~/Projects/Claude/HomeBrew/podcasts
python3 -m scripts.run_pipeline

# 6. Git push a trivial doc change and watch the hook deploy to Fly
cd ~/Projects/sni-research-v2
echo "" >> CLAUDE.md
git add CLAUDE.md
git commit -m "chore: verify pre-push deploy hook on new machine"
git push  # should trigger fly deploy, then push to GitHub

# 7. Live health check
curl -fsS https://sni-research.fly.dev/api/health
```

---

## 14. Cut over

Only after every step above passes:

```bash
# On the OLD machine — stop and disable launchd jobs
for f in ~/Library/LaunchAgents/com.sni.*.plist ~/Library/LaunchAgents/com.scott.podcast-pipeline.plist; do
  launchctl unload "$f"
done

# Rename them so they can't be re-loaded accidentally
for f in ~/Library/LaunchAgents/com.sni.*.plist ~/Library/LaunchAgents/com.scott.podcast-pipeline.plist; do
  mv "$f" "${f}.migrated"
done

# Unregister Claude Code scheduled tasks (via Claude Code: "unschedule X")
```

Monitor the first 48 hours of the new machine's pipeline runs. Watch `data/editorial/activity.json` for errors and the Telegram alerts channel.

---

## 15. Rollback plan

If something breaks on the new machine:

1. Re-enable the old machine's launchd jobs (rename `.migrated` back to `.plist`, `launchctl load`)
2. Re-register Claude Code scheduled tasks on the old machine
3. The Fly deployment stays pointing at whatever commit was last pushed — no rollback needed there
4. Data that was written to Turso during the new machine's runs is idempotent (upserts), so nothing gets corrupted; the old machine's pipeline will resume from whatever state it last saw

---

## 16. Appendix: file inventory to back up BEFORE migration

These files are gitignored or live outside the repo. Lose them and you lose history.

| Path | Size | Purpose | Recoverable? |
|------|------|---------|--------------|
| `.env` | ~1KB | API keys | No — must re-provision all keys |
| `.credentials.enc` + `SNI_CREDENTIAL_KEY` | <10KB | Subscription cookies | Partial — cookies can be re-captured but takes time |
| `data/editorial/state.json` | ~1.4MB | analysisIndex, themeRegistry, postBacklog, editorialAudits, decisions — canonical editorial memory | Partial — some in Turso, but the file is the source of truth |
| `data/editorial/writing-preferences.md` | ~18KB | Scott's writing rules | Yes — can be reconstructed from git history of an older version + memory |
| `data/editorial/vocabulary-fingerprint.json` | ~10KB | Canon vocabulary signature | Yes — regenerate via `/vocabulary-fingerprint-refresh` |
| `data/editorial/activity.json` | ~50KB | Pipeline activity log | No — logs are append-only, lost if deleted |
| `data/editorial/drafts/` | varies | Newsletter drafts | Partial — may be in Turso `published_posts` |
| `data/verified/` | ~3GB | Scored articles | Partial — last 7 days in Turso; older than 7 days only on disk |
| `data/podcasts/` | ~300MB | Episode digests + manifest | Partial — in Turso |
| `data/copilot/` | ~50MB | Chat threads + pins | No — local only |
| `~/Desktop/Podcast Transcripts/*.md` | ~500MB | Raw transcripts | Partial — `analysis_entries.transcript` in Turso has most of them, but re-transcribing from audio is slow and costs Whisper |
| `~/Projects/Claude/HomeBrew/podcasts/episodes-log.json` | ~5MB | Per-episode metadata + status | No — lost history means the pipeline won't know what's already been delivered |
| `~/Library/LaunchAgents/com.sni.*.plist` | <50KB total | launchd job definitions | Yes — step 8 above rewrites them |
| `~/Library/LaunchAgents/com.scott.podcast-pipeline.plist` | <5KB | Podcast pipeline launchd | Yes |
| `~/.claude/scheduled-tasks/*/SKILL.md` | <50KB total | Claude Code task definitions | Yes — in repo under `.claude/commands/` indirectly (the SKILL.md files just invoke slash commands) |
| `~/.fly/config.yml` | <1KB | Fly token | Yes — `fly auth login` regenerates |

**Back up everything in the table before touching the old machine's cron.**
