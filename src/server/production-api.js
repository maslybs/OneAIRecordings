import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { APP_DIR, CONFIG_PATH, STATE_PATH, readJson, safeName, writeJson } from '../runtime/common.js';
import { hasCalendarAuth, syncCalendarJobs } from '../calendar/google.js';
import { hasR2Config } from '../storage/r2-production.js';

const API_SECRET_PATH = path.join(APP_DIR, 'secrets/panel-api.json');
const R2_SECRET_PATH = path.join(APP_DIR, 'secrets/r2.json');
const CAL_CLIENT_PATH = path.join(APP_DIR, 'secrets/google-calendar-oauth-client.json');
const CAL_TOKEN_PATH = path.join(APP_DIR, 'secrets/google-calendar-token.json');

function readApiSecret() {
  const secret = readJson(API_SECRET_PATH, {});
  if (!secret.token || !secret.basePath) throw new Error(`Missing ${API_SECRET_PATH}`);
  return secret;
}

const apiSecret = readApiSecret();
const LISTEN_HOST = process.env.BOT_API_HOST || '0.0.0.0';
const LISTEN_PORT = Number(process.env.BOT_API_PORT || 8787);
const MAX_BODY = 2 * 1024 * 1024;

function send(res, status, data, headers = {}) {
  const body = data === null || data === undefined ? '' : JSON.stringify(data, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function safeConfig(cfg) {
  const copy = JSON.parse(JSON.stringify(cfg || {}));
  if (copy.r2) {
    if (copy.r2.accessKeyId) copy.r2.accessKeyId = '***configured***';
    if (copy.r2.secretAccessKey) copy.r2.secretAccessKey = '***configured***';
  }
  return copy;
}

function allowedConfigPatch(input) {
  const cfg = readJson(CONFIG_PATH, {});
  const allowedTop = new Set([
    'timezone', 'botName', 'botNameBase', 'botNameRandomSuffix', 'botNameRandomDigits',
    'resolution', 'fps', 'videoBitrate', 'audioBitrate', 'audioChannels', 'fullscreen',
    'minParticipants', 'autoStopBelowParticipantsSeconds', 'participantCheckMs', 'minRecordingSecondsToKeep',
    'joinWaitMinutes', 'sendChatOnRecordingStart', 'recordingStartMessage', 'sendChatOnRecordingStop', 'recordingStopMessage',
    'playStartBeep', 'storage', 'cleanupLocalAfterUpload', 'calendar', 'r2'
  ]);
  for (const [key, value] of Object.entries(input || {})) {
    if (!allowedTop.has(key)) continue;
    if (key === 'r2') {
      cfg.r2 = { ...(cfg.r2 || {}), ...Object.fromEntries(Object.entries(value || {}).filter(([r2Key]) => ['bucket', 'prefix', 'publicBaseUrl'].includes(r2Key))) };
      continue;
    }
    if (key === 'calendar') {
      cfg.calendar = { ...(cfg.calendar || {}), ...Object.fromEntries(Object.entries(value || {}).filter(([calendarKey]) => [
        'enabled', 'calendarId', 'requireMarker', 'marker', 'lookaheadHours', 'lookbackMinutes', 'startEarlySeconds', 'endBufferMinutes', 'maxResults'
      ].includes(calendarKey))) };
      continue;
    }
    cfg[key] = value;
  }
  writeJson(CONFIG_PATH, cfg);
  return cfg;
}

function procList() {
  const out = spawnSync('ps', ['-eo', 'pid,ppid,user,etime,cmd'], { encoding: 'utf8' }).stdout || '';
  return out.split('\n').filter(line => /src\/record\.js|src\/scheduler\/production\.js|ffmpeg -y|\/snap\/chromium\/|Xvfb :99|pulseaudio/.test(line) && !/grep/.test(line));
}

function serviceStatus() {
  const active = spawnSync('systemctl', ['is-active', 'meet-recorder-scheduler.service'], { encoding: 'utf8' });
  const enabled = spawnSync('systemctl', ['is-enabled', 'meet-recorder-scheduler.service'], { encoding: 'utf8' });
  return { active: (active.stdout || active.stderr || '').trim(), enabled: (enabled.stdout || enabled.stderr || '').trim() };
}

function isRecorderActive() {
  return procList().some(line => /src\/record\.js/.test(line));
}

function latestRecordings(limit = 20) {
  const dir = path.join(APP_DIR, 'recordings');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(file => file.endsWith('.mp4'))
    .map(file => {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      return { file, path: full, size: stat.size, mtime: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime))
    .slice(0, limit);
}

function tail(file, lines = 120) {
  const full = path.join(APP_DIR, file);
  if (!fs.existsSync(full)) return '';
  return spawnSync('tail', ['-n', String(lines), full], { encoding: 'utf8' }).stdout || '';
}

function startRecording({ meetUrl, durationMinutes = 120, title = '' }) {
  if (!/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(String(meetUrl || ''))) {
    const error = new Error('Invalid Google Meet URL');
    error.status = 400;
    throw error;
  }
  if (isRecorderActive()) {
    const error = new Error('Recorder already active');
    error.status = 409;
    throw error;
  }
  const cleanTitle = safeName(title || meetUrl.split('/').pop() || 'manual');
  const logFile = path.join(APP_DIR, 'logs', `api-run-${Date.now()}-${cleanTitle}.log`);
  const child = spawn('/usr/bin/node', ['src/record.js', `--url=${meetUrl}`, `--duration=${Number(durationMinutes) || 120}`, `--title=${cleanTitle}`], {
    cwd: APP_DIR,
    detached: true,
    stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
    env: { ...process.env, NODE_ENV: 'production' }
  });
  child.unref();
  return { pid: child.pid, logFile };
}

function systemctl(args) {
  const result = spawnSync('systemctl', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    const error = new Error((result.stderr || result.stdout || '').trim() || `systemctl ${args.join(' ')} failed`);
    error.status = 500;
    throw error;
  }
  return { ok: true, stdout: result.stdout.trim() };
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const error = new Error('Body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON');
    error.status = 400;
    throw error;
  }
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (!url.pathname.startsWith(apiSecret.basePath + '/')) return send(res, 404, { ok: false, error: 'not_found' });
  const token = req.headers['x-bot-api-key'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (token !== apiSecret.token) return send(res, 401, { ok: false, error: 'unauthorized' });
  const p = url.pathname.slice(apiSecret.basePath.length) || '/';

  if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true, time: new Date().toISOString(), service: serviceStatus() });
  if (req.method === 'GET' && p === '/status') {
    const cfg = readJson(CONFIG_PATH, {});
    return send(res, 200, {
      ok: true,
      service: serviceStatus(),
      procs: procList(),
      recorderActive: isRecorderActive(),
      auth: {
        calendar: hasCalendarAuth(),
        calendarClient: fs.existsSync(CAL_CLIENT_PATH),
        calendarToken: fs.existsSync(CAL_TOKEN_PATH),
        r2: hasR2Config(cfg),
        r2Secret: fs.existsSync(R2_SECRET_PATH)
      },
      config: safeConfig(cfg),
      jobsCount: (cfg.jobs || []).length,
      state: readJson(STATE_PATH, {}),
      recordings: latestRecordings(20),
      logs: { bot: tail('logs/bot.log', 80), ffmpeg: tail('logs/ffmpeg.log', 80) }
    });
  }
  if (req.method === 'GET' && p === '/config') return send(res, 200, { ok: true, config: safeConfig(readJson(CONFIG_PATH, {})) });
  if (req.method === 'PUT' && p === '/config') {
    const body = await readBody(req);
    return send(res, 200, { ok: true, config: safeConfig(allowedConfigPatch(body.config || body)) });
  }
  if (req.method === 'POST' && p === '/secrets/r2') {
    const body = await readBody(req);
    for (const key of ['accountId', 'bucket', 'accessKeyId', 'secretAccessKey']) {
      if (!body[key]) {
        const error = new Error(`Missing ${key}`);
        error.status = 400;
        throw error;
      }
    }
    fs.writeFileSync(R2_SECRET_PATH, JSON.stringify({
      accountId: body.accountId,
      bucket: body.bucket,
      accessKeyId: body.accessKeyId,
      secretAccessKey: body.secretAccessKey,
      prefix: body.prefix || 'meet-recordings',
      publicBaseUrl: body.publicBaseUrl || ''
    }, null, 2) + '\n', { mode: 0o600 });
    const cfg = readJson(CONFIG_PATH, {});
    cfg.storage = 'r2';
    cfg.r2 = { ...(cfg.r2 || {}), bucket: body.bucket, prefix: body.prefix || 'meet-recordings', publicBaseUrl: body.publicBaseUrl || '' };
    writeJson(CONFIG_PATH, cfg);
    return send(res, 200, { ok: true, r2Configured: true, config: safeConfig(cfg) });
  }
  if (req.method === 'POST' && p === '/secrets/calendar-client') {
    const body = await readBody(req);
    const json = typeof body.json === 'string' ? JSON.parse(body.json) : body.json;
    if (!json || (!json.installed && !json.web && !json.client_email)) {
      const error = new Error('Invalid Google credentials JSON');
      error.status = 400;
      throw error;
    }
    fs.writeFileSync(CAL_CLIENT_PATH, JSON.stringify(json, null, 2) + '\n', { mode: 0o600 });
    return send(res, 200, { ok: true, calendarClientConfigured: true, note: 'OAuth client saved. Use auth URL flow next.' });
  }
  if (req.method === 'POST' && p === '/calendar/sync') return send(res, 200, { ok: true, result: await syncCalendarJobs(readJson(CONFIG_PATH, {})), config: safeConfig(readJson(CONFIG_PATH, {})) });
  if (req.method === 'POST' && p === '/record/start') return send(res, 200, { ok: true, result: startRecording(await readBody(req)) });
  if (req.method === 'POST' && p === '/scheduler/start') return send(res, 200, systemctl(['enable', '--now', 'meet-recorder-scheduler.service']));
  if (req.method === 'POST' && p === '/scheduler/stop') return send(res, 200, systemctl(['disable', '--now', 'meet-recorder-scheduler.service']));
  return send(res, 404, { ok: false, error: 'not_found', path: p });
}

const server = http.createServer((req, res) => route(req, res).catch(error => send(res, error.status || 500, { ok: false, error: error.message || String(error) })));
server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`[${new Date().toISOString()}] bot api listening http://${LISTEN_HOST}:${LISTEN_PORT}${apiSecret.basePath}`);
});
