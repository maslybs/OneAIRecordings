# OneAIRecordings

Open-source self-hosted recorder for online meetings.

The current production-tested provider is **Google Meet**. The project is structured so that other providers, such as Zoom, can be added without rewriting the FFmpeg/audio/storage pipeline.

## What it does

- joins a meeting in Chromium via Puppeteer;
- records Xvfb display and PulseAudio output with FFmpeg;
- writes temporary MKV segments during recording;
- finalizes a valid MP4 after stop;
- optionally creates an MP3;
- uploads MP4/MP3 to Cloudflare R2;
- exposes an HTTP API with `record/start` and `record/stop`;
- can run from scheduler or CLI.

## Current provider status

| Provider | Status |
| --- | --- |
| Google Meet | baseline implementation |
| Zoom | provider scaffold, not production-ready |

## Install

```bash
npm install
cp config/config.example.json config/config.json
mkdir -p logs recordings secrets profile
```

Create `secrets/r2.json`:

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

## Run one recording

```bash
npm run record -- \
  --provider=meet \
  --url=https://meet.google.com/xxx-yyyy-zzz \
  --title="Demo" \
  --duration=120
```

## API

```bash
npm run api
```

Start:

```bash
curl -X POST http://localhost:8787/record/start \
  -H 'content-type: application/json' \
  -d '{"provider":"meet","url":"https://meet.google.com/xxx-yyyy-zzz","title":"Demo"}'
```

Stop:

```bash
curl -X POST http://localhost:8787/record/stop
```

## Recommended small VPS settings

For 2 vCPU / 4 GB RAM:

```json
{
  "resolution": "1280x720",
  "fps": 15,
  "videoBitrate": "2000k",
  "audioBitrate": "192k",
  "maxRecordingMinutesAfterJoin": 120,
  "segmentedRecording": true
}
```

Avoid 1080p/30fps on small VPS instances unless you test CPU load, dropped frames, audio sync and disk headroom.

## Project structure

```txt
src/
  cli.js
  config.js
  logger.js
  providers/
    meet.js
    zoom.js
  recorder/
    ffmpeg.js
    session.js
  storage/
    r2.js
  server/
    api.js
  scheduler.js
```

## Security

Do not commit:

```txt
secrets/
recordings/
logs/
config/config.json
```

Use a dedicated Google account for the recorder in production and invite it to calendar events.
