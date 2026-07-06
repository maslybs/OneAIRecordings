import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { APP_DIR, CONFIG_PATH, log, readJson, safeName, writeJson } from './common.js';

const CLIENT_PATH = path.join(APP_DIR, 'secrets/google-calendar-oauth-client.json');
const FALLBACK_CLIENT_PATH = path.join(APP_DIR, 'secrets/google-oauth-client.json');
const TOKEN_PATH = path.join(APP_DIR, 'secrets/google-calendar-token.json');
const MEET_RE = /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i;

export function hasCalendarAuth() {
  return (fs.existsSync(CLIENT_PATH) || fs.existsSync(FALLBACK_CLIENT_PATH)) && fs.existsSync(TOKEN_PATH);
}

function getOAuthClient() {
  const file = fs.existsSync(CLIENT_PATH) ? CLIENT_PATH : FALLBACK_CLIENT_PATH;
  if (!fs.existsSync(file)) throw new Error('Calendar OAuth client JSON missing');
  if (!fs.existsSync(TOKEN_PATH)) throw new Error('Calendar OAuth token missing');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const data = raw.installed || raw.web || raw;
  const redirectUri = (data.redirect_uris || ['urn:ietf:wg:oauth:2.0:oob'])[0];
  const oauth2 = new google.auth.OAuth2(data.client_id, data.client_secret, redirectUri);
  const storedTokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  oauth2.setCredentials(storedTokens);
  oauth2.on('tokens', tokens => {
    const merged = { ...storedTokens, ...tokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 });
    Object.assign(storedTokens, merged);
    log('Calendar OAuth token refreshed');
  });
  return oauth2;
}

export function extractMeetUrl(event) {
  if (event.hangoutLink && MEET_RE.test(event.hangoutLink)) return event.hangoutLink.match(MEET_RE)[0];
  for (const ep of event.conferenceData?.entryPoints || []) {
    if (ep.uri && MEET_RE.test(ep.uri)) return ep.uri.match(MEET_RE)[0];
  }
  const hay = [event.location, event.description, event.summary].filter(Boolean).join('\n');
  const m = hay.match(MEET_RE);
  return m ? m[0] : '';
}

function eventDate(value) {
  return value?.dateTime || (value?.date ? `${value.date}T00:00:00` : '');
}

function shouldRecordEvent(event, calendarCfg) {
  if (event.status === 'cancelled') return false;
  const marker = calendarCfg.marker || '[REC]';
  if (!calendarCfg.requireMarker) return true;
  const hay = `${event.summary || ''}\n${event.description || ''}`;
  return hay.includes(marker);
}

function eventToJob(event, calendarCfg) {
  const meetUrl = extractMeetUrl(event);
  if (!meetUrl) return null;
  const startRaw = eventDate(event.start);
  const endRaw = eventDate(event.end);
  const startMs = new Date(startRaw).getTime();
  const endMs = new Date(endRaw).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const startEarlyMs = Number(calendarCfg.startEarlySeconds ?? 60) * 1000;
  const endBufferMinutes = Number(calendarCfg.endBufferMinutes ?? 5);
  const startAt = new Date(startMs - startEarlyMs).toISOString();
  const durationMinutes = Math.max(1, Math.ceil((endMs - startMs) / 60000) + endBufferMinutes);
  const eventKey = `${event.id}:${startRaw}`;
  return {
    id: `calendar:${Buffer.from(eventKey).toString('base64url')}`,
    source: 'calendar',
    calendarEventId: event.id,
    title: safeName((event.summary || 'calendar-meeting').replace(calendarCfg.marker || '[REC]', '').trim()),
    meetUrl,
    startAt,
    durationMinutes,
    enabled: true
  };
}

export async function syncCalendarJobs(cfg = readJson(CONFIG_PATH, {})) {
  const calendarCfg = cfg.calendar || {};
  if (!calendarCfg.enabled) {
    log('Calendar sync skipped: disabled');
    return { added: 0, skipped: 0, reason: 'disabled' };
  }
  if (!hasCalendarAuth()) {
    log('Calendar sync skipped: OAuth not configured');
    return { added: 0, skipped: 0, reason: 'auth-missing' };
  }
  const auth = getOAuthClient();
  const calendar = google.calendar({ version: 'v3', auth });
  const calendarId = calendarCfg.calendarId || 'primary';
  const now = Date.now();
  const timeMin = new Date(now - Number(calendarCfg.lookbackMinutes ?? 10) * 60000).toISOString();
  const timeMax = new Date(now + Number(calendarCfg.lookaheadHours ?? 48) * 3600000).toISOString();
  const res = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    conferenceDataVersion: 1,
    maxResults: Number(calendarCfg.maxResults ?? 100)
  });
  const events = res.data.items || [];
  cfg.jobs ||= [];
  const existing = new Set(cfg.jobs.map(j => j.id));
  let added = 0, skipped = 0;
  for (const event of events) {
    if (!shouldRecordEvent(event, calendarCfg)) { skipped++; continue; }
    const job = eventToJob(event, calendarCfg);
    if (!job || existing.has(job.id)) { skipped++; continue; }
    cfg.jobs.push(job);
    existing.add(job.id);
    added++;
    log('Calendar job added', job.id, job.title, job.meetUrl, job.startAt);
  }
  writeJson(CONFIG_PATH, cfg);
  return { added, skipped, events: events.length };
}
