# Production Parity

The default runtime is now the structured production path.

## Default Entrypoints

These commands use the structured code, not `src/legacy/`:

```bash
node src/cli.js record
node src/cli.js api
node src/cli.js scheduler
node src/cli.js auth:calendar
node src/cli.js auth:drive
node src/cli.js calendar:sync
node src/cli.js add-job
node src/cli.js doctor
```

Process-manager entrypoints:

```bash
node src/record.js
node src/api-server.js
node src/scheduler-legacy.js
```

## Structured Locations

Production behavior is split across:

```txt
src/audio/
src/browser/
src/calendar/
src/diagnostics/
src/jobs/
src/providers/meet/
src/recorder/
src/runtime/
src/server/
src/storage/
```

## Legacy Backup

The old copied production files remain in:

```txt
src/legacy/
```

They are kept for comparison and rollback only. Explicit backup commands:

```bash
node src/cli.js legacy:record
node src/cli.js legacy:api
node src/cli.js legacy:scheduler
```

## Parity Checklist

The structured path contains the production behavior for:

```txt
Xvfb startup
PulseAudio setup
Chromium launch profile and flags
Google Meet guest name fill
microphone and camera controls
Ask to join / Join now flow
waiting / rejected / joined detection
Meet page debug logs and screenshots
UI cleanup
captions off
chat start and stop messages
start beep through virtual microphone
participant counting
auto-stop below participant threshold
maximum recording duration
segmented FFmpeg recording
MP4 finalization
MP3 creation
R2 upload
Google Drive upload
local cleanup
calendar OAuth refresh token persistence
calendar sync
manual jobs
API start and stop
```
