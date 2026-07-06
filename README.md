# OneAIRecordings

Open-source self-hosted recorder for online meetings.

The repository currently has two runtime modes:

1. **Legacy mode** — production-tested Google Meet recorder copied from the VPS production bot.
2. **Modular mode** — new open-source architecture, under active refactor.

Google Meet legacy mode is production-tested. Zoom provider is scaffold only.

## Current status

| Area | Status |
| --- | --- |
| Google Meet legacy mode | production-tested |
| Modular Google Meet provider | baseline implementation, under refactor |
| Zoom provider | scaffold only, not production-ready |
| Cloudflare R2 storage | supported |
| Google Drive upload | supported in legacy mode when OAuth secrets are configured |
| Calendar sync | supported in legacy mode when OAuth secrets are configured |

## Install

```bash
npm install
cp config/config.example.json config/config.json
mkdir -p logs recordings secrets profile
```

Do not commit runtime config, secrets, logs or recordings.

## Legacy mode

Legacy mode keeps the production bot logic isolated in:

```txt
src/legacy/
```

It is intentionally preserved close to production behavior first. Refactoring should happen gradually and only when behavior remains 1:1.

### Legacy commands

```bash
node src/cli.js legacy:record --url=https://meet.google.com/xxx-yyyy-zzz --title="Demo" --duration=120
node src/cli.js legacy:api
node src/cli.js legacy:scheduler
node src/cli.js legacy:doctor
```

Legacy path configuration:

```bash
ONEAI_APP_DIR=/opt/oneai-recordings
ONEAI_CONFIG_PATH=/opt/oneai-recordings/config/config.json
ONEAI_STATE_PATH=/opt/oneai-recordings/config/state.json
```

If these variables are not set, legacy mode uses the current working directory.

## Modular mode

Modular mode is the new open-source structure:

```bash
npm run record -- --provider=meet --url=https://meet.google.com/xxx-yyyy-zzz --title="Demo" --duration=120
npm run api
npm run scheduler
npm run doctor
```

This mode is intended as the clean architecture target. It should not replace legacy production behavior until each extracted module is verified.

## R2 setup

Create `secrets/r2.json` or provide equivalent environment variables supported by the storage layer.

Example `secrets/r2.json`:

```json
{
  "accountId": "cloudflare-account-id",
  "bucket": "meet-recordings",
  "accessKeyId": "r2-access-key-id",
  "secretAccessKey": "r2-secret-access-key",
  "prefix": "meet-recordings",
  "publicBaseUrl": "https://<account-id>.r2.cloudflarestorage.com"
}
```

## API

Legacy API:

```bash
node src/cli.js legacy:api
```

Modular API:

```bash
npm run api
```

Start a recording:

```bash
curl -X POST http://localhost:8787/record/start \
  -H 'content-type: application/json' \
  -d '{"provider":"meet","url":"https://meet.google.com/xxx-yyyy-zzz","title":"Demo"}'
```

Stop a recording:

```bash
curl -X POST http://localhost:8787/record/stop
```

## Systemd

Production-compatible legacy examples are in:

```txt
scripts/systemd/oneai-recordings-api.service
scripts/systemd/oneai-recordings-scheduler.service
```

They run:

```ini
ExecStart=/usr/bin/node src/cli.js legacy:api
ExecStart=/usr/bin/node src/cli.js legacy:scheduler
```

Set `WorkingDirectory` and `ONEAI_APP_DIR` to the deployment path on the server.

## Refactor plan

Refactor legacy logic gradually:

```txt
src/legacy/record.js
↓
src/browser/xvfb.js
src/browser/chromium.js
src/audio/pulse.js
src/providers/meet/join.js
src/providers/meet/ui.js
src/providers/meet/chat.js
src/providers/meet/participants.js
src/recorder/ffmpeg.js
src/recorder/finalize.js
src/recorder/mp3.js
src/storage/r2.js
```

Rule: after every extracted module, behavior must stay 1:1 with legacy mode.

## Project structure

```txt
src/
  cli.js
  config.js
  logger.js
  legacy/
  providers/
  recorder/
  storage/
  server/
  scheduler.js
```

## Security

Do not commit:

```txt
secrets/
recordings/
logs/
config/config.json
config/state.json
*.bak*
```

Use a dedicated Google account for the recorder in production and invite it to calendar events.
