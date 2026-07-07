import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { APP_DIR, CONFIG_PATH, STATE_PATH, log, readJson, writeJson, sleep } from '../runtime/common.js';
import { syncCalendarJobs } from '../calendar/google.js';

function due(job) {
  if (!job.enabled) return false;
  const time = new Date(job.startAt).getTime();
  if (!Number.isFinite(time)) return false;
  const now = Date.now();
  return now >= time && now <= time + 30 * 60 * 1000;
}

function recorderActive() {
  try {
    for (const pid of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue;
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`).toString().replace(/\0/g, ' ');
      if (cmd.includes('/usr/bin/node src/record.js') || cmd.includes('node src/record.js')) return true;
    }
  } catch {}
  return false;
}

function launch(job) {
  const args = ['src/record.js', `--url=${job.meetUrl}`, `--duration=${job.durationMinutes || 60}`, `--title=${job.title || job.id}`];
  const process = spawn('node', args, { cwd: APP_DIR, detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
  process.unref();
  return process.pid;
}

log('Scheduler started');
while (true) {
  let cfg = readJson(CONFIG_PATH, { jobs: [] });
  if (cfg.calendar?.enabled) {
    try {
      await syncCalendarJobs(cfg);
    } catch (error) {
      log('Calendar sync error', error?.message || String(error));
    }
    cfg = readJson(CONFIG_PATH, { jobs: [] });
  }
  const state = readJson(STATE_PATH, { launched: {} });
  state.launched ||= {};
  for (const job of cfg.jobs || []) {
    if (!job.id || state.launched[job.id]) continue;
    if (due(job)) {
      if (recorderActive()) {
        log('Skip due job because recorder is already active', job.id);
        continue;
      }
      const pid = launch(job);
      state.launched[job.id] = { pid, launchedAt: new Date().toISOString(), title: job.title || '' };
      writeJson(STATE_PATH, state);
      log('Launched job', job.id, 'pid', pid);
    }
  }
  await sleep(20000);
}
