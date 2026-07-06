import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import puppeteer from 'puppeteer-core';
import { APP_DIR, loadConfig, log, safeName } from './common.js';
import { uploadToDrive } from './drive.js';
import { uploadToR2 } from './storage-r2.js';

function arg(name, def = '') {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return r;
}

function makeBotDisplayName(cfg = {}) {
  const base = String(cfg.botNameBase || 'OneAIHUB Recorder').trim() || 'OneAIHUB Recorder';
  if (cfg.botNameRandomSuffix === false) return base;
  const digits = Math.max(1, Math.min(6, Number(cfg.botNameRandomDigits || 3)));
  const max = 10 ** digits;
  const suffix = String(Math.floor(Math.random() * max)).padStart(digits, '0');
  return `${base} ${suffix}`.slice(0, 60);
}

function ensureX(display) {
  const n = display.replace(':', '');
  const lock = `/tmp/.X${n}-lock`;
  if (fs.existsSync(lock)) return null;
  const p = spawn('Xvfb', [display, '-screen', '0', '1280x720x24', '-ac', '+extension', 'RANDR'], { detached: true, stdio: 'ignore' });
  p.unref();
  return p;
}
function ensurePulse() {
  fs.mkdirSync(process.env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 });
  // Start PulseAudio in the same runtime dir Snap Chromium can access: /run/user/0.
  spawnSync('pulseaudio', ['--daemonize=yes', '--exit-idle-time=-1'], {
    encoding: 'utf8',
    env: { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR }
  });
  // Remove previous null sinks from older runs to avoid meet_sink.2/3/4 confusion.
  const mods = spawnSync('pactl', ['list', 'short', 'modules'], { encoding: 'utf8', env: process.env });
  for (const line of (mods.stdout || '').split('\n')) {
    if (line.includes('module-null-sink') || line.includes('module-remap-source')) {
      const id = line.trim().split(/\s+/)[0];
      if (id) spawnSync('pactl', ['unload-module', id], { encoding: 'utf8', env: process.env });
    }
  }
  spawnSync('pactl', ['load-module', 'module-null-sink', 'sink_name=meet_sink', 'sink_properties=device.description=MeetSink'], { encoding: 'utf8', env: process.env });
  spawnSync('pactl', ['load-module', 'module-null-sink', 'sink_name=bot_mic_sink', 'sink_properties=device.description=BotVirtualMic'], { encoding: 'utf8', env: process.env });
  // Expose the bot mic as a real-looking PulseAudio input, not only as a sink monitor.
  // Chrome/Meet often ignores raw monitor sources and shows "Mic not found".
  spawnSync('pactl', [
    'load-module', 'module-remap-source',
    'master=bot_mic_sink.monitor',
    'source_name=bot_mic',
    'source_properties=device.description=BotMic'
  ], { encoding: 'utf8', env: process.env });
  spawnSync('pactl', ['set-default-sink', 'meet_sink'], { encoding: 'utf8', env: process.env });
  spawnSync('pactl', ['set-default-source', 'bot_mic'], { encoding: 'utf8', env: process.env });
}

function startFfmpeg({ resolution, fps, display, cfg, outFile }) {
  const segmentSeconds = Number(cfg.segmentSeconds || 60);
  const segmented = cfg.segmentedRecording !== false;
  const ffmpegLog = path.join(APP_DIR, 'logs/ffmpeg.log');

  if (segmented) {
    const base = outFile.replace(/\.mp4$/i, '');
    const segmentDir = `${base}.segments`;
    fs.mkdirSync(segmentDir, { recursive: true });
    const segmentPattern = path.join(segmentDir, 'segment-%05d.mkv');
    const ffmpegArgs = [
      '-y',
      '-thread_queue_size', String(cfg.ffmpegThreadQueueSize || 4096),
      '-f', 'x11grab', '-video_size', resolution, '-framerate', fps, '-i', display,
      '-thread_queue_size', String(cfg.ffmpegThreadQueueSize || 4096),
      '-f', 'pulse', '-i', 'meet_sink.monitor',
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'libx264', '-preset', cfg.videoPreset || 'ultrafast', '-b:v', cfg.videoBitrate || '1000k', '-pix_fmt', 'yuv420p',
      '-vsync', 'cfr',
      // Keep audio lossless in temporary segments. Final MP4 encodes it once to AAC.
      // aresample async smooths small PulseAudio timestamp gaps without meaningful CPU cost.
      '-af', 'aresample=async=1000:first_pts=0',
      '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', String(cfg.audioChannels || 2),
      '-f', 'segment', '-segment_time', String(segmentSeconds), '-reset_timestamps', '1',
      '-segment_format', 'matroska', segmentPattern
    ];
    log('FFmpeg segmented recording starting after successful join', JSON.stringify({ resolution, fps, videoBitrate: cfg.videoBitrate || '1000k', audioBitrate: cfg.audioBitrate || '128k', segmentSeconds, segmentDir, finalOutFile: outFile }));
    const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    ffmpeg.stderr.on('data', d => fs.appendFileSync(ffmpegLog, d));
    ffmpeg.segmentDir = segmentDir;
    ffmpeg.finalOutFile = outFile;
    ffmpeg.segmented = true;
    return ffmpeg;
  }

  const ffmpegArgs = [
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
  const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  ffmpeg.stderr.on('data', d => fs.appendFileSync(ffmpegLog, d));
  ffmpeg.segmented = false;
  return ffmpeg;
}

function finalizeSegmentsToMp4(ffmpeg, cfg) {
  if (!ffmpeg?.segmented || !ffmpeg.segmentDir || !ffmpeg.finalOutFile) return null;
  const files = fs.readdirSync(ffmpeg.segmentDir)
    .filter(f => /^segment-\d+\.mkv$/.test(f))
    .sort()
    .map(f => path.join(ffmpeg.segmentDir, f));
  log('Segments found', String(files.length), ffmpeg.segmentDir);
  if (!files.length) return null;
  const listFile = path.join(ffmpeg.segmentDir, 'segments.txt');
  fs.writeFileSync(listFile, files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
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


function getMediaDurationSeconds(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const n = Number((r.stdout || '').trim());
  return Number.isFinite(n) ? n : null;
}

function createMp3FromMp4(mp4Path, cfg = {}) {
  if (!mp4Path || !fs.existsSync(mp4Path)) {
    log('MP3 creation skipped: MP4 missing', mp4Path || '');
    return null;
  }
  const mp3Path = mp4Path.replace(/\.mp4$/i, '.mp3');
  const bitrate = String(cfg.mp3Bitrate || '128k');
  const args = [
    '-y',
    '-i', mp4Path,
    '-vn',
    '-map', '0:a:0',
    '-c:a', 'libmp3lame',
    '-b:a', bitrate,
    '-ar', '44100',
    '-ac', '2',
    mp3Path
  ];
  log('MP3 creation starting', JSON.stringify({ mp4Path, mp3Path, bitrate }));
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  fs.appendFileSync(path.join(APP_DIR, 'logs/ffmpeg.log'), `
CREATE_MP3_EXIT=${r.status}
${r.stdout || ''}
${r.stderr || ''}
`);
  if (r.status !== 0 || !fs.existsSync(mp3Path) || fs.statSync(mp3Path).size <= 0) {
    log('MP3 creation failed', mp3Path, r.stderr ? r.stderr.slice(-500) : '');
    return null;
  }
  const stat = fs.statSync(mp3Path);
  const durationSeconds = getMediaDurationSeconds(mp3Path);
  log('MP3 file', mp3Path, `${stat.size} bytes`, durationSeconds !== null ? `duration=${durationSeconds.toFixed(3)}s` : 'duration=unknown');
  return mp3Path;
}

function cleanupPreviousLocalRecordings(keepPaths = []) {
  const recordingsDir = path.join(APP_DIR, 'recordings');
  if (!fs.existsSync(recordingsDir)) return;
  const keep = new Set(keepPaths.filter(Boolean).map(p => path.resolve(p)));
  const keepSegmentDirs = new Set(
    Array.from(keep)
      .filter(p => /\.mp4$/i.test(p))
      .map(p => path.resolve(p.replace(/\.mp4$/i, '.segments')))
  );
  let deleted = 0;
  for (const name of fs.readdirSync(recordingsDir)) {
    const full = path.join(recordingsDir, name);
    const resolved = path.resolve(full);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isFile() && /\.(mp4|mp3)$/i.test(name)) {
      if (keep.has(resolved)) continue;
      fs.unlinkSync(full);
      deleted += 1;
      log('Old local recording deleted after R2 upload', full);
    } else if (st.isDirectory() && name.endsWith('.segments')) {
      if (keepSegmentDirs.has(resolved)) continue;
      fs.rmSync(full, { recursive: true, force: true });
      deleted += 1;
      log('Old local segment directory deleted after R2 upload', full);
    }
  }
  log('Old local recordings cleanup done', `deleted=${deleted}`, `kept=${keep.size}`);
}

async function probeAudioStatus() {
  const info = run('pactl', ['info'], { encoding: 'utf8', env: process.env });
  const sinks = run('pactl', ['list', 'short', 'sinks'], { encoding: 'utf8', env: process.env });
  const sources = run('pactl', ['list', 'short', 'sources'], { encoding: 'utf8', env: process.env });
  const inputs = run('pactl', ['list', 'short', 'sink-inputs'], { encoding: 'utf8', env: process.env });
  log('Audio status', JSON.stringify({ info: info.stdout?.trim(), sinks: sinks.stdout?.trim(), sources: sources.stdout?.trim(), sinkInputs: inputs.stdout?.trim() }));
}


async function clickButtonByText(page, patterns, timeoutMs = 45000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const result = await page.evaluate((patterns) => {
      const vis = el => {
        const r = el.getBoundingClientRect();
        const st = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
      };
      const pats = patterns.map(p => new RegExp(p, 'i'));
      const els = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(vis);
      const scored = els.map(el => {
        const label = `${el.innerText || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.replace(/\s+/g, ' ').trim();
        const matchIndex = pats.findIndex(p => p.test(label));
        return { el, label, matchIndex };
      }).filter(x => x.matchIndex >= 0).sort((a,b) => a.matchIndex - b.matchIndex || a.label.length - b.label.length);
      const target = scored[0]?.el;
      if (!target) return null;
      target.scrollIntoView({ block: 'center', inline: 'center' });
      target.click();
      return scored[0].label;
    }, patterns).catch(e => `ERROR:${String(e)}`);
    if (result) return result;
    await sleep(1000);
  }
  return null;
}


async function pageDebug(page, label) {
  const data = await page.evaluate(() => ({
    href: location.href,
    title: document.title,
    body: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1800),
    buttons: Array.from(document.querySelectorAll('button, div[role="button"]')).map(el => ({
      text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      aria: el.getAttribute('aria-label') || '',
      title: el.getAttribute('title') || ''
    })).filter(x => x.text || x.aria || x.title).slice(0, 60),
    inputs: Array.from(document.querySelectorAll('input, textarea')).map(el => ({
      tag: el.tagName,
      type: el.type || '',
      value: el.value || '',
      placeholder: el.placeholder || '',
      aria: el.getAttribute('aria-label') || '',
      maxLength: el.maxLength || null
    })).slice(0, 20)
  })).catch(e => ({ error: String(e) }));
  log(`PAGE_DEBUG_${label}`, JSON.stringify(data));
  await page.screenshot({ path: path.join(APP_DIR, 'logs', `${label}.png`), fullPage: false }).catch(() => {});
}


async function fillGuestName(page, name) {
  return await page.evaluate((name) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const candidates = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]')).filter(visible);
    const scored = candidates.map(el => {
      const text = `${el.placeholder || ''} ${el.getAttribute('aria-label') || ''} ${el.name || ''} ${el.id || ''}`.toLowerCase();
      let score = 0;
      if (/name|your name|ім.?я|имя/.test(text)) score += 10;
      if (el.maxLength === 60) score += 5;
      if ((el.tagName === 'INPUT' && (!el.type || el.type === 'text')) || el.tagName === 'TEXTAREA') score += 2;
      return { el, score };
    }).sort((a,b) => b.score - a.score);
    const el = scored[0]?.el;
    if (!el) return { ok: false };
    el.focus();
    if (el.isContentEditable) {
      el.textContent = name;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: name }));
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter ? setter.call(el, name) : (el.value = name);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { ok: true, tag: el.tagName, placeholder: el.placeholder || '', aria: el.getAttribute('aria-label') || '', value: el.value || el.textContent || '' };
  }, name).catch(e => ({ ok: false, error: String(e) }));
}


async function setMicEnabled(page, enabled) {
  const patterns = enabled
    ? ['turn on microphone', 'увімкнути мікрофон', 'включить микрофон']
    : ['turn off microphone', 'вимкнути мікрофон', 'отключить микрофон'];
  const clicked = await clickButtonByText(page, patterns, 3000).catch(() => null);
  log(enabled ? 'Mic enable attempt:' : 'Mic disable attempt:', clicked || 'not-needed-or-not-found');
  await sleep(500);
  return clicked;
}

function playBeep(cfg) {
  const duration = Math.max(0.2, Number(cfg.beepDurationMs || 800) / 1000);
  const frequency = String(Number(cfg.beepFrequency || 880));
  const volume = String(Number(cfg.beepVolume || 0.25));
  const expr = `sine=frequency=${frequency}:duration=${duration}`;
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', expr, '-filter:a', `volume=${volume}`, '-f', 'pulse', 'bot_mic_sink'], {
    encoding: 'utf8',
    env: process.env
  });
  log('Beep played', JSON.stringify({ status: r.status, duration, frequency, stderr: (r.stderr || '').slice(0, 500) }));
  return r.status === 0;
}

async function sendChatMessage(page, message) {
  if (!message) return false;
  const opened = await clickButtonByText(page, ['chat with everyone', 'чат з усіма', 'чат со всеми', '^\\s*chat\\s*$'], 5000).catch(() => null);
  log('Chat open attempt:', opened || 'not-found-or-already-open');
  await sleep(1200);
  const focused = await page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 20 && r.height > 10 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const fields = Array.from(document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]')).filter(visible);
    const scored = fields.map((el) => {
      const label = `${el.placeholder || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('role') || ''}`.toLowerCase();
      let score = 0;
      if (/message|send|chat|повідом|сообщ/.test(label)) score += 10;
      if (el.isContentEditable) score += 3;
      if (el.tagName === 'TEXTAREA') score += 2;
      const r = el.getBoundingClientRect();
      score += Math.min(3, r.bottom / Math.max(1, window.innerHeight));
      return { el, score };
    }).sort((a, b) => b.score - a.score);
    const el = scored[0]?.el;
    if (!el) return false;
    el.focus();
    return true;
  }).catch(() => false);
  if (!focused) {
    log('Chat message failed: input not found');
    await closeMeetSidePanels(page, 'chat-input-not-found').catch(() => null);
    return false;
  }
  await page.keyboard.type(message, { delay: 10 }).catch(() => null);
  await sleep(200);
  await page.keyboard.press('Enter').catch(() => null);
  await sleep(900);
  log('Chat message sent attempt:', message);
  await closeMeetSidePanels(page, 'after-chat-message').catch(e => log('Chat close failed:', String(e)));
  return true;
}


async function closeMeetSidePanels(page, label = 'close-panels') {
  const result = await page.evaluate(() => {
    const clicked = [];
    const visible = el => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const textOf = el => `${el.innerText || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.replace(/\s+/g, ' ').trim();
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(visible);

    // Prefer explicit close buttons inside right-side Meet panels.
    for (const el of buttons) {
      const label = textOf(el);
      const rect = el.getBoundingClientRect();
      const parent = textOf(el.closest('[role="dialog"], aside, [aria-label], div') || el);
      const looksLikeClose = /^(close|dismiss|закрити|сховати)$/i.test(label) || /^close/i.test(label);
      const isCaptionButton = /caption|subtitles|субтитр/i.test(parent + ' ' + label);
      const isRightPanel = rect.left > window.innerWidth * 0.45;
      const isMeetPanel = /chat|everyone|message|people|participants|activities|meeting details|повідомл|чат|учасник|люди|деталі/i.test(parent + ' ' + label);
      if (looksLikeClose && !isCaptionButton && (isRightPanel || isMeetPanel)) {
        try { el.click(); clicked.push(`side-panel:${label || 'close'}`); } catch {}
      }
    }

    // Fallback: if chat/people buttons are active, clicking them toggles the side panel off.
    for (const el of buttons) {
      const label = textOf(el);
      const pressed = el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-expanded') === 'true';
      const isPanelToggle = /chat with everyone|chat$|people|show everyone|participants|чат|учасники/i.test(label);
      if (pressed && isPanelToggle) {
        try { el.click(); clicked.push(`toggle-off:${label}`); } catch {}
      }
    }
    return clicked;
  }).catch(e => [`ERROR:${String(e)}`]);
  await page.keyboard.press('Escape').catch(() => null);
  await sleep(300);
  await page.keyboard.press('Escape').catch(() => null);
  await page.mouse.move(1279, 1).catch(() => null);
  await sleep(1200);
  log('Meet side panels close', label, JSON.stringify(result));
}

async function ensureCaptionsOff(page, label = 'captions-off') {
  const result = await page.evaluate(() => {
    const clicked = [];
    const visible = el => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const textOf = el => `${el.innerText || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.replace(/\s+/g, ' ').trim();
    for (const el of Array.from(document.querySelectorAll('button, div[role="button"]')).filter(visible)) {
      const label = textOf(el);
      // Only click when captions are currently enabled. Do not click "Turn on captions".
      if (/turn off captions|вимкнути субтитри|выключить субтитры/i.test(label)) {
        try { el.click(); clicked.push(label); } catch {}
      }
    }
    return clicked;
  }).catch(e => [`ERROR:${String(e)}`]);
  if (result.length) await sleep(500);
  log('Meet captions off check', label, JSON.stringify(result));
}

async function cleanupMeetUi(page, label = 'cleanup') {
  const result = await page.evaluate(() => {
    const clicked = [];
    const hidden = [];
    const visible = el => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const textOf = el => `${el.innerText || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.replace(/\s+/g, ' ').trim();
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(visible);

    // Close transient Meet warnings/popups like Camera not found, Microphone warning, Got it banners.
    for (const el of buttons) {
      const label = textOf(el);
      const parent = textOf(el.closest('[role="dialog"], [role="alert"], [aria-live], div') || el);
      const isClose = /^(close|dismiss|got it|закрити|зрозуміло)$/i.test(label) || /close$/i.test(label);
      const relevant = /camera|microphone|mic|browser|automation|not found|error|warning|камера|мікрофон|браузер|помилка/i.test(parent + ' ' + label);
      if (isClose && relevant) {
        try { el.click(); clicked.push(label || 'close'); } catch {}
      }
    }

    // Hide browser/Meet cosmetic overlays that are not useful meeting content.
    for (const el of Array.from(document.querySelectorAll('[role="alert"], [aria-live], .infobar, .notification'))) {
      const label = textOf(el);
      if (/camera|microphone|mic|browser|automation|not found|error|warning|камера|мікрофон|браузер|помилка/i.test(label)) {
        try { el.style.display = 'none'; hidden.push(label.slice(0, 80)); } catch {}
      }
    }
    return { clicked, hidden };
  }).catch(e => ({ error: String(e) }));
  await ensureCaptionsOff(page, `${label}:captions`).catch(() => null);
  await closeMeetSidePanels(page, `${label}:side-panels`).catch(() => null);
  await page.keyboard.press('Escape').catch(() => null);
  await page.mouse.move(1279, 1).catch(() => null);
  await sleep(1200);
  log('Meet UI cleanup', label, JSON.stringify(result));
}
async function notifyRecordingStart(page, cfg) {
  if (cfg.sendChatOnRecordingStart !== false) {
    await sendChatMessage(page, cfg.recordingStartMessage || 'Запис зустрічі розпочато!').catch(e => log('Start chat failed:', String(e)));
  }
  if (cfg.playStartBeep !== false) {
    await setMicEnabled(page, true).catch(() => null);
    await sleep(300);
    playBeep(cfg);
    await sleep(300);
    if (cfg.muteMicAfterBeep !== false) await setMicEnabled(page, false).catch(() => null);
  }
}

async function notifyRecordingStop(page, cfg) {
  if (cfg.sendChatOnRecordingStop) {
    await sendChatMessage(page, cfg.recordingStopMessage || 'Запис зустрічі закінчено!').catch(e => log('Stop chat failed:', String(e)));
  }
}

async function prepareMeet(page, botName, joinWaitMs = 600000) {
  await sleep(9000);
  await pageDebug(page, 'before-join');

  const fill = await fillGuestName(page, botName);
  log('Guest name fill:', JSON.stringify(fill));
  await sleep(1000);
  await pageDebug(page, 'after-name');

  // Only toggle if Google exposes explicit "turn off" actions. Avoid broad "microphone" matching.
  const mic = await clickButtonByText(page, ['turn off microphone', 'вимкнути мікрофон', 'отключить микрофон'], 2500).catch(()=>null);
  if (mic) log('Mic toggle:', mic);
  const cam = await clickButtonByText(page, ['turn off camera', 'вимкнути камеру', 'отключить камеру'], 2500).catch(()=>null);
  if (cam) log('Camera toggle:', cam);

  const clicked = await clickButtonByText(page, [
    '^\\s*join now\\s*$', 'join now',
    '^\\s*ask to join\\s*$', 'ask to join',
    '^\\s*join meeting\\s*$', 'join meeting',
    '^\\s*join\\s*$',
    'приєднатися зараз', 'приєднатися', 'долучитися', 'попросити приєднатися',
    'присоединиться сейчас', 'присоединиться', 'просить присоединиться'
  ], 60000);
  log('Join/Ask button:', clicked || 'not found');

  if (!clicked) {
    await pageDebug(page, 'join-button-not-found');
    return { ok: false, reason: 'join-button-not-found' };
  }

  const joined = await waitUntilJoined(page, joinWaitMs, 3000);
  if (!joined.ok) {
    log('Join failed:', JSON.stringify(joined));
    await pageDebug(page, 'join-failed');
    return joined;
  }

  await page.keyboard.press('F11').catch(()=>{});
  await page.evaluate(() => document.documentElement.requestFullscreen?.().catch?.(()=>{})).catch(()=>{});
  await sleep(1000);
  await cleanupMeetUi(page, 'after-join-before-debug');
  await pageDebug(page, 'after-join-click');
  return { ok: true, clicked, joined };
}


async function isInMeeting(page) {
  return await page.evaluate(() => {
    const body = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const labels = Array.from(document.querySelectorAll('button, div[role="button"], [aria-label]')).map(el => {
      return `${el.innerText || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.replace(/\s+/g, ' ').trim();
    }).join(' | ');
    const hay = `${body} | ${labels}`;

    // Important: Google shows Leave call + mic controls even while still waiting for host approval.
    // That is NOT a successful join yet.
    const waiting = /Please wait until a meeting host brings you into the call|Asking to join|You'll join when someone lets you in|Waiting to be admitted|Попросити приєднатися|Очікування|Просить присоединиться|Ожидание/i.test(hay);
    const rejected = /You can't join this video call|You were denied|denied your request|not allowed to join|can't join|Ви не можете приєднатися|відхилено|нельзя присоединиться|запрос отклонен/i.test(hay);
    const joinedSignals = /Meeting details|Chat with everyone|Meeting tools|You have joined the call|This call is open to anyone|Деталі зустрічі|Чат з усіма|Інструменти зустрічі|Сведения о встрече|Чат со всеми/i.test(hay);
    const joined = !waiting && !rejected && joinedSignals;
    return { joined, rejected, waiting, body: body.slice(0, 900) };
  }).catch(e => ({ joined: false, rejected: false, waiting: false, error: String(e) }));
}

async function waitUntilJoined(page, timeoutMs = 600000, checkMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const state = await isInMeeting(page);
    log('Join state:', JSON.stringify(state));
    if (state.joined) return { ok: true, state };
    if (state.rejected) return { ok: false, reason: 'rejected-or-not-allowed', state };
    await sleep(checkMs);
  }
  const state = await isInMeeting(page);
  return { ok: false, reason: 'join-timeout', state };
}

async function getParticipantCount(page) {
  return await page.evaluate(() => {
    const vis = el => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const items = Array.from(document.querySelectorAll('button, div[role="button"], [aria-label]')).filter(vis).map(el => {
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      const aria = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      const title = (el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
      const label = `${text} ${aria} ${title}`.trim();
      const r = el.getBoundingClientRect();
      return { text, aria, title, label, x:r.x, y:r.y, w:r.width, h:r.height };
    });

    // Preferred: Meet often exposes a small visible numeric people-count button after joining.
    const numericButtons = items
      .filter(x => /^\d{1,3}$/.test(x.text) && x.w > 10 && x.h > 10)
      .map(x => ({ n: Number(x.text), x }));
    if (numericButtons.length) {
      // Usually top-left/top-bar participant count. Prefer small counts near top bar.
      numericButtons.sort((a,b) => (a.x.y - b.x.y) || (a.n - b.n));
      return numericButtons[0].n;
    }

    // Fallback: parse labels like "2 participants", "Show everyone (2)", etc.
    const patterns = [
      /(\d{1,3})\s+(?:people|participants?|учасник|учасники|учасників|участник|участника|участников)/i,
      /(?:people|participants?|учасник|учасники|учасників|участник|участника|участников).*?(\d{1,3})/i,
      /\((\d{1,3})\)/
    ];
    for (const item of items) {
      for (const p of patterns) {
        const m = item.label.match(p);
        if (m) return Number(m[1]);
      }
    }

    // Fallback: count visible participant tiles with participant names. Less reliable.
    const body = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const m = body.match(/Meeting details\s+(\d{1,3})\s+Press Down Arrow/i);
    if (m) return Number(m[1]);
    return null;
  }).catch(() => null);
}

async function waitForStopCondition(page, durationMs, minParticipants = 2, belowMs = 30000, checkMs = 5000) {
  const started = Date.now();
  let belowSince = null;
  while (Date.now() - started < durationMs) {
    const count = await getParticipantCount(page);
    log('Participant count:', count === null ? 'unknown' : String(count));
    if (typeof count === 'number' && count < minParticipants) {
      if (!belowSince) belowSince = Date.now();
      const belowFor = Date.now() - belowSince;
      log(`Participant count below ${minParticipants} for ${Math.round(belowFor / 1000)}s`);
      if (belowFor >= belowMs) {
        log(`Auto-stop: participant count < ${minParticipants} for ${Math.round(belowMs / 1000)}s`);
        return 'participants-below-threshold';
      }
    } else {
      belowSince = null;
    }
    const left = durationMs - (Date.now() - started);
    await sleep(Math.min(checkMs, Math.max(0, left)));
  }
  return 'duration-ended';
}

const cfg = loadConfig();
const meetUrl = arg('url');
const durationMinutes = Number(arg('duration', '60'));
const title = arg('title', 'meeting');
if (!meetUrl) { console.error('Missing --url'); process.exit(1); }

const display = cfg.display || ':99';
const resolution = cfg.resolution || '1280x720';
const fps = String(cfg.fps || 15);
const outDir = path.join(APP_DIR, 'recordings');
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outFile = path.join(outDir, `${stamp}-${safeName(title)}.mp4`);

process.env.DISPLAY = display;
process.env.PULSE_SINK = 'meet_sink';
process.env.PULSE_SOURCE = 'bot_mic';
const audioRuntimeDir = cfg.audioRuntimeDir || '/run/user/0';
process.env.XDG_RUNTIME_DIR = audioRuntimeDir;
fs.mkdirSync(process.env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 });
process.env.PULSE_SERVER = `unix:${process.env.XDG_RUNTIME_DIR}/pulse/native`;

log('Recorder starting', meetUrl, `duration=${durationMinutes}m`, `output=${outFile}`);
ensureX(display);
await sleep(1500);
ensurePulse();

const profileDir = cfg.guestProfileDir || path.join('/tmp', `meet-recorder-profile-${Date.now()}`);
if (!cfg.guestProfileDir) fs.rmSync(profileDir, { recursive: true, force: true });
fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });

const browser = await puppeteer.launch({
  executablePath: cfg.chromeExecutable || '/snap/bin/chromium',
  headless: false,
  userDataDir: profileDir,
  defaultViewport: null,
  // Puppeteer's default --enable-automation shows Chrome's "browser is controlled" infobar.
  // Removing it keeps the captured Xvfb frame cleaner.
  ignoreDefaultArgs: ['--enable-automation'],
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--disable-notifications', '--autoplay-policy=no-user-gesture-required',
    '--no-first-run', '--no-default-browser-check', '--disable-popup-blocking', '--test-type',
    '--window-size=1280,720', '--start-maximized', '--kiosk',
    '--use-fake-ui-for-media-stream',
    ...(cfg.useFakeMediaDevice ? ['--use-fake-device-for-media-stream'] : []),
    '--disable-infobars', '--disable-blink-features=AutomationControlled',
    '--lang=en-US,en'
  ],
  env: { ...process.env, DISPLAY: display, PULSE_SINK: 'meet_sink', PULSE_SOURCE: 'bot_mic', PULSE_SERVER: process.env.PULSE_SERVER, LANG: 'en_US.UTF-8', LANGUAGE: 'en_US:en' }
});

const page = await browser.newPage();
await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});
page.setDefaultTimeout(30000);
await page.goto(meetUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
const joinWaitMs = Number(cfg.joinWaitMinutes ?? 10) * 60 * 1000;
const botDisplayName = makeBotDisplayName(cfg);
log('Bot display name', botDisplayName);
const joinResult = await prepareMeet(page, botDisplayName, joinWaitMs);
if (!joinResult.ok) {
  log('Recorder exit without recording: join was not successful', JSON.stringify(joinResult));
  await browser.close().catch(()=>{});
  process.exit(2);
}
await setMicEnabled(page, false).catch(() => null);
await notifyRecordingStart(page, cfg).catch(e => log('Recording start notification failed:', String(e)));
await cleanupMeetUi(page, 'before-ffmpeg-start');
await probeAudioStatus();
const ffmpeg = startFfmpeg({ resolution, fps, display, cfg, outFile });

const maxAfterJoinMinutes = Number(cfg.maxRecordingMinutesAfterJoin || cfg.maxRecordingMinutes || 0);
const effectiveDurationMinutes = maxAfterJoinMinutes > 0 ? maxAfterJoinMinutes : durationMinutes;
const ms = Math.max(1, effectiveDurationMinutes) * 60 * 1000;
const minParticipants = Number(cfg.minParticipants ?? 2);
const autoStopBelowParticipantsSeconds = Number(cfg.autoStopBelowParticipantsSeconds ?? 30);
log('Recording active', JSON.stringify({ effectiveDurationMinutes, cliDurationMinutes: durationMinutes, maxAfterJoinMinutes, minParticipants, autoStopBelowParticipantsSeconds }));
const participantCheckMs = Number(cfg.participantCheckMs ?? 1000);
const stopReason = await waitForStopCondition(page, ms, minParticipants, autoStopBelowParticipantsSeconds * 1000, participantCheckMs);
log('Recording stopping', `reason=${stopReason}`);
await notifyRecordingStop(page, cfg).catch(e => log('Recording stop notification failed:', String(e)));

await browser.close().catch(()=>{});
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

  const r2Uploaded = await uploadToR2(outFile, cfg, metadata).catch(e => {
    log('R2 upload failed:', e?.message || String(e));
    return null;
  });
  const mp3R2Uploaded = mp3File && cfg.uploadMp3ToR2 !== false ? await uploadToR2(mp3File, cfg, { ...metadata, mediaType: 'audio' }).catch(e => {
    log('R2 MP3 upload failed:', e?.message || String(e));
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
