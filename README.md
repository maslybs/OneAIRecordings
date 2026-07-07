# OneAIRecordings

Self-hosted recorder for Google Meet with a small protected web panel, calendar sync and optional Cloudflare R2 storage.

## What works

| Area | Status |
| --- | --- |
| Google Meet recording | supported |
| Manual recording jobs | supported |
| Scheduler service | supported |
| Google Calendar sync | supported |
| Cloudflare R2 upload | supported |
| MP3 export after recording | supported |
| Protected web panel | supported |
| Zoom provider | scaffold only |

## Recording behavior

The recorder can join a Google Meet as a guest bot, set the bot name, optionally send a chat message when recording starts, play a short start beep, record video/audio, auto-stop when participant count drops below the configured threshold, then finalize/upload the result.

`playStartBeep` is a real runtime option. It is used by `src/providers/meet/ui.js`: when enabled, the recorder briefly enables the mic, plays the beep through PulseAudio, then mutes the mic again unless `muteMicAfterBeep` disables that behavior.

## Install

```bash
npm install
cp config/config.example.json config/config.json
mkdir -p logs recordings secrets profile
```

Do not commit runtime config, secrets, logs, browser profiles or recordings.

## CLI

```bash
node src/cli.js record --url=https://meet.google.com/xxx-yyyy-zzz --title="Demo" --duration=120
node src/cli.js api
node src/cli.js scheduler
node src/cli.js doctor
node src/cli.js auth:calendar
node src/cli.js auth:drive
node src/cli.js calendar:sync
node src/cli.js add-job
```

## Runtime paths

```bash
ONEAI_APP_DIR=/opt/oneai-recordings
ONEAI_CONFIG_PATH=/opt/oneai-recordings/config/config.json
ONEAI_STATE_PATH=/opt/oneai-recordings/config/state.json
```

## API

Start the API with:

```bash
node src/cli.js api
```

API access is protected by a private base path and API token from:

```txt
secrets/panel-api.json
```

Example request:

```bash
curl -X POST http://localhost:8787/<base-path>/record/start \
  -H 'content-type: application/json' \
  -H 'x-bot-api-key: <token>' \
  -d '{"meetUrl":"https://meet.google.com/xxx-yyyy-zzz","title":"Demo"}'
```

## Web panel

The browser opens the static Cloudflare Pages panel. The panel talks only to a Cloudflare Worker gateway. The Worker checks the panel password, creates an HttpOnly session cookie, and proxies authenticated requests to the recorder API with `BOT_API_KEY`.

Expected Worker secrets/bindings:

```txt
PANEL_PASSWORD
SESSION_SECRET
BOT_API_BASE
BOT_API_KEY
ALLOWED_ORIGINS
```

`panel/config.js` contains the local deploy-time gateway URL and is ignored by git. Commit only `panel/config.example.js`.

## Systemd

Example service files are in:

```txt
scripts/systemd/oneai-recordings-api.service
scripts/systemd/oneai-recordings-scheduler.service
```

They should run the current CLI entrypoints:

```ini
ExecStart=/usr/bin/node src/cli.js api
ExecStart=/usr/bin/node src/cli.js scheduler
```

## Project structure

```txt
src/
  audio/
  browser/
  calendar/
  diagnostics/
  jobs/
  providers/meet/
  recorder/
  runtime/
  server/
  storage/
  legacy/
panel/
workers/
scripts/
```

`src/legacy/` is kept only for reference/rollback. New work should use the current CLI/runtime modules.

## Security checklist

Do not commit:

```txt
secrets/
recordings/
logs/
profile/
config/config.json
config/state.json
panel/config.js
*.bak*
```

Secrets must live in local runtime files or Cloudflare Worker secrets, not in committed source code.
