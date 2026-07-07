# OneAIRecordings

Open-source self-hosted recorder for online meetings.

## Status

The default runtime uses structured production code. The old copied production files remain in `src/legacy/` only as a backup.

| Area | Status |
| --- | --- |
| Google Meet recording | supported |
| Calendar sync | supported |
| Manual jobs | supported |
| API panel endpoints | supported |
| Cloudflare R2 upload | supported |
| Google Drive upload | supported |
| Zoom provider | scaffold only |

## Install

```bash
npm install
cp config/config.example.json config/config.json
mkdir -p logs recordings secrets profile
```

Do not commit runtime config, secrets, logs or recordings.

## Run

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

Process-manager entrypoints:

```bash
node src/record.js --url=https://meet.google.com/xxx-yyyy-zzz --title="Demo" --duration=120
node src/api-server.js
node src/scheduler-legacy.js
```

Path configuration:

```bash
ONEAI_APP_DIR=/opt/oneai-recordings
ONEAI_CONFIG_PATH=/opt/oneai-recordings/config/config.json
ONEAI_STATE_PATH=/opt/oneai-recordings/config/state.json
```

## Structure

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
```

`src/legacy/` is a backup and comparison copy. Normal commands do not use it.

## API

```bash
node src/cli.js api
```

Start a recording:

```bash
curl -X POST http://localhost:8787/<base-path>/record/start \
  -H 'content-type: application/json' \
  -H 'x-bot-api-key: <token>' \
  -d '{"meetUrl":"https://meet.google.com/xxx-yyyy-zzz","title":"Demo"}'
```

The API base path and token come from:

```txt
secrets/panel-api.json
```

## Systemd

Examples are in:

```txt
scripts/systemd/oneai-recordings-api.service
scripts/systemd/oneai-recordings-scheduler.service
```

They should run:

```ini
ExecStart=/usr/bin/node src/cli.js api
ExecStart=/usr/bin/node src/cli.js scheduler
```

## Legacy Backup

Explicit old-code commands are still available:

```bash
node src/cli.js legacy:record
node src/cli.js legacy:api
node src/cli.js legacy:scheduler
```

Use them only for rollback or comparison.

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
