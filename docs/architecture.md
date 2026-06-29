# Architecture

OneAIRecordings is intentionally split into small replaceable units.

```txt
src/
  cli.js                process entrypoint
  config.js             config loading and defaulting
  logger.js             file + stdout logger
  providers/            meeting-specific UI logic
  recorder/             FFmpeg display/audio recording
  storage/              upload targets
  server/               HTTP API
  scheduler.js          simple scheduled jobs runner
```

## Provider boundary

A provider knows how to join and control one meeting platform. It does not know how to encode video, upload to R2 or schedule jobs.

Required methods:

```js
await provider.start();
await provider.join({ url, displayName, joinWaitMs });
await provider.beforeRecording();
await provider.getParticipantCount();
await provider.close();
```

## Recorder boundary

The recorder owns FFmpeg and file lifecycle:

1. start temporary MKV segments;
2. stop FFmpeg via `SIGINT`;
3. concatenate segments into MP4;
4. validate with ffprobe;
5. create MP3;
6. remove segments only after successful finalization.

## Why segmented recording

Long recordings are safer when written as short segments. If finalization fails, the raw segments remain recoverable.

## Zoom support

Zoom should be added as a provider, not by changing recorder/storage code. Two possible approaches:

1. browser-based Zoom join flow, fastest MVP;
2. Zoom Meeting SDK, cleaner but more integration work.
