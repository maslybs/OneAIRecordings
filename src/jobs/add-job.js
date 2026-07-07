import { randomUUID } from 'node:crypto';
import { CONFIG_PATH, parseCliArg, readJson, writeJson } from '../runtime/common.js';

const meetUrl = parseCliArg('url');
const startAt = parseCliArg('start');
const durationMinutes = Number(parseCliArg('duration', '60'));
const title = parseCliArg('title', 'meeting');

if (!meetUrl || !startAt) {
  console.error('Usage: node src/cli.js add-job --url="https://meet.google.com/..." --start="2026-06-22T18:00:00+03:00" --duration=60 --title="demo"');
  process.exit(1);
}

const cfg = readJson(CONFIG_PATH, {});
cfg.jobs ||= [];
const job = { id: randomUUID(), title, meetUrl, startAt, durationMinutes, enabled: true };
cfg.jobs.push(job);
writeJson(CONFIG_PATH, cfg);
console.log(JSON.stringify(job, null, 2));
