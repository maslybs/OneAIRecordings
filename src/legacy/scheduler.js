import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { APP_DIR, CONFIG_PATH, STATE_PATH, readJson, writeJson, log } from './common.js';
import { syncCalendarJobs } from './calendar.js';

function due(job) {
  if (!job.enabled) return false;
  const t = new Date(job.startAt).getTime();
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return now >= t && now <= t + 30 * 60 * 1000;
}
function recorderActive() {
  try {
    for (const pid of fs.readdirSync('/proc')) {
      if (!/^\\d+$/.test(pid)) continue;
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`).toString().replace(/\\0/g, ' ');
      if (cmd.includes('/usr/bin/node src/record.js') || cmd.includes('node src/record.js')) return true;
    }
  } catch {}
  return false;
}

function launch(job) {
  const args = ['src/record.js', `--url=${job.meetUrl}`, `--duration=${job.durationMinutes || 60}`, `--title=${job.title || job.id}`];
  const p = spawn('node', args, { cwd: APP_DIR, detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
  p.unref();
  return p.pid;
}

log('Scheduler started');
while (true) {
  let cfg = readJson(CONFIG_PATH, { jobs: [] });
  if (cfg.calendar?.enabled) {
    try { await syncCalendarJobs(cfg); } catch (e) { log('Calendar sync error', e?.message || String(e)); }
    cfg = readJson(CONFIG_PATH, { jobs: [] });
  }
  const state = readJson(STATE_PATH, { launched: {} });
  state.launched ||= {};
  for (const job of cfg.jobs || []) {
    if (!job.id || state.launched[job.id]) continue;
    if (due(job)) {
      if (recorderActive()) { log('Skip due job because recorder is already active', job.id); continue; }
      const pid = launch(job);
      state.launched[job.id] = { pid, launchedAt: new Date().toISOString(), title: job.title || '' };
      writeJson(STATE_PATH, state);
      log('Launched job', job.id, 'pid', pid);
    }
  }
  await new Promise(r => setTimeout(r, 20000));
}
