#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, loadConfig, log, makeBotDisplayName, parseCliArg, safeName, sleep } from './runtime/common.js';
import { ensureX } from './browser/xvfb.js';
import { configurePulseEnvironment, ensurePulse, probeAudioStatus } from './audio/pulse.js';
import { launchMeetBrowser } from './browser/chromium.js';
import { cleanupMeetUi, notifyRecordingStart, notifyRecordingStop, prepareMeet, setMicEnabled, waitForStopCondition } from './providers/meet/ui.js';
import { cleanupPreviousLocalRecordings, createMp3FromMp4, finalizeSegmentsToMp4, getMediaDurationSeconds, startFfmpeg } from './recorder/production-ffmpeg.js';
import { uploadToR2 } from './storage/r2-production.js';
import { uploadToDrive } from './storage/drive.js';

const cfg = loadConfig();
const meetUrl = parseCliArg('url');
const durationMinutes = Number(parseCliArg('duration', '60'));
const title = parseCliArg('title', 'meeting');

if (!meetUrl) {
  console.error('Missing --url');
  process.exit(1);
}

const display = cfg.display || ':99';
const resolution = cfg.resolution || '1280x720';
const fps = String(cfg.fps || 15);
const outDir = path.join(APP_DIR, 'recordings');
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outFile = path.join(outDir, `${stamp}-${safeName(title)}.mp4`);

configurePulseEnvironment(cfg, display);
log('Recorder starting', meetUrl, `duration=${durationMinutes}m`, `output=${outFile}`);
ensureX(display);
await sleep(1500);
ensurePulse();

const { browser, page } = await launchMeetBrowser(cfg, display);
await page.goto(meetUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

const joinWaitMs = Number(cfg.joinWaitMinutes ?? 10) * 60 * 1000;
const botDisplayName = makeBotDisplayName(cfg);
log('Bot display name', botDisplayName);
const joinResult = await prepareMeet(page, botDisplayName, joinWaitMs);
if (!joinResult.ok) {
  log('Recorder exit without recording: join was not successful', JSON.stringify(joinResult));
  await browser.close().catch(() => {});
  process.exit(2);
}

await setMicEnabled(page, false).catch(() => null);
await notifyRecordingStart(page, cfg).catch(error => log('Recording start notification failed:', String(error)));
await cleanupMeetUi(page, 'before-ffmpeg-start');
await probeAudioStatus();

const ffmpeg = startFfmpeg({ resolution, fps, display, cfg, outFile });

const maxAfterJoinMinutes = Number(cfg.maxRecordingMinutesAfterJoin || cfg.maxRecordingMinutes || 0);
const effectiveDurationMinutes = maxAfterJoinMinutes > 0 ? maxAfterJoinMinutes : durationMinutes;
const durationMs = Math.max(1, effectiveDurationMinutes) * 60 * 1000;
const minParticipants = Number(cfg.minParticipants ?? 2);
const autoStopBelowParticipantsSeconds = Number(cfg.autoStopBelowParticipantsSeconds ?? 30);
const participantCheckMs = Number(cfg.participantCheckMs ?? 1000);
log('Recording active', JSON.stringify({ effectiveDurationMinutes, cliDurationMinutes: durationMinutes, maxAfterJoinMinutes, minParticipants, autoStopBelowParticipantsSeconds }));

const stopReason = await waitForStopCondition(page, durationMs, minParticipants, autoStopBelowParticipantsSeconds * 1000, participantCheckMs);
log('Recording stopping', `reason=${stopReason}`);
await notifyRecordingStop(page, cfg).catch(error => log('Recording stop notification failed:', String(error)));

await browser.close().catch(() => {});
ffmpeg.kill('SIGINT');
await new Promise(resolve => ffmpeg.once('exit', resolve));
finalizeSegmentsToMp4(ffmpeg, cfg);

let stat = fs.existsSync(outFile) ? fs.statSync(outFile) : null;
const durationSeconds = stat ? getMediaDurationSeconds(outFile) : null;
log('Recording file', outFile, stat ? `${stat.size} bytes` : 'missing', durationSeconds !== null ? `duration=${durationSeconds.toFixed(3)}s` : 'duration=unknown');

const minRecordingSecondsToKeep = Number(cfg.minRecordingSecondsToKeep ?? 5);
if (stat && stat.size > 0 && durationSeconds !== null && durationSeconds < minRecordingSecondsToKeep) {
  fs.unlinkSync(outFile);
  stat = null;
  log('Recording file deleted: shorter than minimum duration', `duration=${durationSeconds.toFixed(3)}s`, `min=${minRecordingSecondsToKeep}s`);
}

if (stat && stat.size > 0) {
  const recordedAt = new Date().toISOString();
  const meetCode = (meetUrl.match(/meet\.google\.com\/([^/?#]+)/)?.[1] || '');
  const metadata = { title, meetCode, recordedAt };
  const mp3File = cfg.createMp3AfterRecording === false ? null : createMp3FromMp4(outFile, cfg);
  const r2Uploaded = await uploadToR2(outFile, cfg, metadata).catch(error => {
    log('R2 upload failed:', error?.message || String(error));
    return null;
  });
  const mp3R2Uploaded = mp3File && cfg.uploadMp3ToR2 !== false ? await uploadToR2(mp3File, cfg, { ...metadata, mediaType: 'audio' }).catch(error => {
    log('R2 MP3 upload failed:', error?.message || String(error));
    return null;
  }) : null;
  const driveUploaded = await uploadToDrive(outFile, cfg.driveFolderId || '');

  const mp3UploadOk = !mp3File || cfg.uploadMp3ToR2 === false || Boolean(mp3R2Uploaded);
  const canCleanupPrevious = Boolean(r2Uploaded) && mp3UploadOk;
  if (canCleanupPrevious && cfg.cleanupPreviousLocalRecordingsAfterR2Upload !== false) {
    cleanupPreviousLocalRecordings([outFile, mp3File]);
  }

  if ((r2Uploaded || driveUploaded) && cfg.cleanupLocalAfterUpload && fs.existsSync(outFile)) fs.unlinkSync(outFile);
  if (mp3File && mp3R2Uploaded && cfg.cleanupLocalAfterUpload && fs.existsSync(mp3File)) fs.unlinkSync(mp3File);
}

log('Recorder done');
