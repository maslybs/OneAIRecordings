import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { APP_DIR, log } from '../runtime/common.js';

export function startFfmpeg({ resolution, fps, display, cfg, outFile }) {
  const segmentSeconds = Number(cfg.segmentSeconds || 60);
  const segmented = cfg.segmentedRecording !== false;
  const ffmpegLog = path.join(APP_DIR, 'logs/ffmpeg.log');

  if (segmented) {
    const base = outFile.replace(/\.mp4$/i, '');
    const segmentDir = `${base}.segments`;
    fs.mkdirSync(segmentDir, { recursive: true });
    const segmentPattern = path.join(segmentDir, 'segment-%05d.mkv');
    const args = [
      '-y',
      '-thread_queue_size', String(cfg.ffmpegThreadQueueSize || 4096),
      '-f', 'x11grab', '-video_size', resolution, '-framerate', fps, '-i', display,
      '-thread_queue_size', String(cfg.ffmpegThreadQueueSize || 4096),
      '-f', 'pulse', '-i', 'meet_sink.monitor',
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'libx264', '-preset', cfg.videoPreset || 'ultrafast', '-b:v', cfg.videoBitrate || '1000k', '-pix_fmt', 'yuv420p',
      '-vsync', 'cfr',
      '-af', 'aresample=async=1000:first_pts=0',
      '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', String(cfg.audioChannels || 2),
      '-f', 'segment', '-segment_time', String(segmentSeconds), '-reset_timestamps', '1',
      '-segment_format', 'matroska', segmentPattern
    ];
    log('FFmpeg segmented recording starting after successful join', JSON.stringify({ resolution, fps, videoBitrate: cfg.videoBitrate || '1000k', audioBitrate: cfg.audioBitrate || '128k', segmentSeconds, segmentDir, finalOutFile: outFile }));
    const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    ffmpeg.stderr.on('data', data => fs.appendFileSync(ffmpegLog, data));
    ffmpeg.segmentDir = segmentDir;
    ffmpeg.finalOutFile = outFile;
    ffmpeg.segmented = true;
    return ffmpeg;
  }

  const args = [
    '-y',
    '-thread_queue_size', String(cfg.ffmpegThreadQueueSize || 4096),
    '-f', 'x11grab', '-video_size', resolution, '-framerate', fps, '-i', display,
    '-thread_queue_size', String(cfg.ffmpegThreadQueueSize || 4096),
    '-f', 'pulse', '-i', 'meet_sink.monitor',
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', cfg.videoPreset || 'ultrafast', '-b:v', cfg.videoBitrate || '1000k', '-pix_fmt', 'yuv420p',
    '-vsync', 'cfr',
    '-af', 'aresample=async=1000:first_pts=0',
    '-c:a', 'aac', '-b:a', cfg.audioBitrate || '192k', '-ar', '48000', '-ac', String(cfg.audioChannels || 2),
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof', outFile
  ];
  log('FFmpeg fragmented MP4 starting after successful join', JSON.stringify({ resolution, fps, videoBitrate: cfg.videoBitrate || '1000k', audioBitrate: cfg.audioBitrate || '128k', outFile }));
  const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  ffmpeg.stderr.on('data', data => fs.appendFileSync(ffmpegLog, data));
  ffmpeg.segmented = false;
  return ffmpeg;
}

export function finalizeSegmentsToMp4(ffmpeg, cfg) {
  if (!ffmpeg?.segmented || !ffmpeg.segmentDir || !ffmpeg.finalOutFile) return null;
  const files = fs.readdirSync(ffmpeg.segmentDir)
    .filter(file => /^segment-\d+\.mkv$/.test(file))
    .sort()
    .map(file => path.join(ffmpeg.segmentDir, file));
  log('Segments found', String(files.length), ffmpeg.segmentDir);
  if (!files.length) return null;
  const listFile = path.join(ffmpeg.segmentDir, 'segments.txt');
  fs.writeFileSync(listFile, files.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  const concat = spawnSync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', cfg.audioBitrate || '192k', '-ar', '48000', '-ac', String(cfg.audioChannels || 2),
    '-movflags', '+faststart', ffmpeg.finalOutFile
  ], { encoding: 'utf8' });
  fs.appendFileSync(path.join(APP_DIR, 'logs/ffmpeg.log'), `\nFINALIZE_CONCAT_EXIT=${concat.status}\n${concat.stdout || ''}\n${concat.stderr || ''}\n`);
  if (concat.status !== 0) {
    log('Final MP4 concat failed; segments are preserved', ffmpeg.segmentDir);
    return null;
  }
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'default=nw=1', ffmpeg.finalOutFile], { encoding: 'utf8' });
  fs.appendFileSync(path.join(APP_DIR, 'logs/ffmpeg.log'), `\nFINAL_MP4_FFPROBE_EXIT=${probe.status}\n${probe.stdout || ''}\n${probe.stderr || ''}\n`);
  if (probe.status !== 0 || !fs.existsSync(ffmpeg.finalOutFile) || fs.statSync(ffmpeg.finalOutFile).size <= 0) {
    log('Final MP4 validation failed; segments are preserved', ffmpeg.segmentDir);
    return null;
  }
  if (!cfg.keepSegmentsAfterFinalize) {
    fs.rmSync(ffmpeg.segmentDir, { recursive: true, force: true });
    log('Segments deleted after successful MP4 finalize', ffmpeg.segmentDir);
  } else {
    log('Segments preserved by config', ffmpeg.segmentDir);
  }
  return ffmpeg.finalOutFile;
}

export function getMediaDurationSeconds(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const value = Number((result.stdout || '').trim());
  return Number.isFinite(value) ? value : null;
}

export function createMp3FromMp4(mp4Path, cfg = {}) {
  if (!mp4Path || !fs.existsSync(mp4Path)) {
    log('MP3 creation skipped: MP4 missing', mp4Path || '');
    return null;
  }
  const mp3Path = mp4Path.replace(/\.mp4$/i, '.mp3');
  const bitrate = String(cfg.mp3Bitrate || '128k');
  const result = spawnSync('ffmpeg', [
    '-y',
    '-i', mp4Path,
    '-vn',
    '-map', '0:a:0',
    '-c:a', 'libmp3lame',
    '-b:a', bitrate,
    '-ar', '44100',
    '-ac', '2',
    mp3Path
  ], { encoding: 'utf8' });
  fs.appendFileSync(path.join(APP_DIR, 'logs/ffmpeg.log'), `\nCREATE_MP3_EXIT=${result.status}\n${result.stdout || ''}\n${result.stderr || ''}\n`);
  if (result.status !== 0 || !fs.existsSync(mp3Path) || fs.statSync(mp3Path).size <= 0) {
    log('MP3 creation failed', mp3Path, result.stderr ? result.stderr.slice(-500) : '');
    return null;
  }
  const stat = fs.statSync(mp3Path);
  const durationSeconds = getMediaDurationSeconds(mp3Path);
  log('MP3 file', mp3Path, `${stat.size} bytes`, durationSeconds !== null ? `duration=${durationSeconds.toFixed(3)}s` : 'duration=unknown');
  return mp3Path;
}

export function cleanupPreviousLocalRecordings(keepPaths = []) {
  const recordingsDir = path.join(APP_DIR, 'recordings');
  if (!fs.existsSync(recordingsDir)) return;
  const keep = new Set(keepPaths.filter(Boolean).map(file => path.resolve(file)));
  const keepSegmentDirs = new Set(
    Array.from(keep)
      .filter(file => /\.mp4$/i.test(file))
      .map(file => path.resolve(file.replace(/\.mp4$/i, '.segments')))
  );
  let deleted = 0;
  for (const name of fs.readdirSync(recordingsDir)) {
    const full = path.join(recordingsDir, name);
    const resolved = path.resolve(full);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isFile() && /\.(mp4|mp3)$/i.test(name)) {
      if (keep.has(resolved)) continue;
      fs.unlinkSync(full);
      deleted += 1;
      log('Old local recording deleted after R2 upload', full);
    } else if (stat.isDirectory() && name.endsWith('.segments')) {
      if (keepSegmentDirs.has(resolved)) continue;
      fs.rmSync(full, { recursive: true, force: true });
      deleted += 1;
      log('Old local segment directory deleted after R2 upload', full);
    }
  }
  log('Old local recordings cleanup done', `deleted=${deleted}`, `kept=${keep.size}`);
}
