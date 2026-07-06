import { randomUUID } from 'crypto';
import { CONFIG_PATH, readJson, writeJson } from './common.js';

function arg(name, def = '') {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}

const meetUrl = arg('url');
const startAt = arg('start');
const durationMinutes = Number(arg('duration', '60'));
const title = arg('title', 'meeting');

if (!meetUrl || !startAt) {
  console.error('Usage: node src/add-job.js --url="https://meet.google.com/..." --start="2026-06-22T18:00:00+03:00" --duration=60 --title="demo"');
  process.exit(1);
}

const cfg = readJson(CONFIG_PATH, {});
cfg.jobs ||= [];
const job = { id: randomUUID(), title, meetUrl, startAt, durationMinutes, enabled: true };
cfg.jobs.push(job);
writeJson(CONFIG_PATH, cfg);
console.log(JSON.stringify(job, null, 2));
