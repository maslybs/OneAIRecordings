# Architecture

OneAIRecordings is split by runtime responsibility.

The default runtime is structured production code. `src/legacy/` is only a backup and comparison copy.

```txt
src/
  cli.js                  process entrypoint
  record.js               recorder entrypoint
  api-server.js           API entrypoint
  scheduler-legacy.js     scheduler compatibility entrypoint
  audio/                  PulseAudio setup and bot sound
  browser/                Xvfb and Chromium setup
  calendar/               Google Calendar auth and sync
  diagnostics/            environment checks
  jobs/                   manual jobs
  providers/meet/         Google Meet UI flow
  recorder/               FFmpeg, segments, MP4, MP3, cleanup
  runtime/                paths, config, logs, CLI args
  server/                 HTTP API
  storage/                R2 and Google Drive
  legacy/                 old production copy for rollback
```

## Recorder Flow

```txt
src/record.js
  -> src/browser/xvfb.js
  -> src/audio/pulse.js
  -> src/browser/chromium.js
  -> src/providers/meet/ui.js
  -> src/recorder/production-ffmpeg.js
  -> src/storage/r2-production.js
  -> src/storage/drive.js
```

## API Flow

```txt
src/api-server.js
  -> src/server/production-api.js
  -> src/calendar/google.js
  -> src/storage/r2-production.js
```

## Scheduler Flow

```txt
src/scheduler-legacy.js
  -> src/scheduler/production.js
  -> src/calendar/google.js
  -> src/record.js
```

## Legacy Backup

The `legacy:*` commands run the old copied files directly. They should be used only for rollback or behavior comparison.
