import fs from 'fs';
import path from 'path';

export const APP_DIR = process.env.ONEAI_APP_DIR || process.cwd();
export const CONFIG_PATH = process.env.ONEAI_CONFIG_PATH || path.join(APP_DIR, 'config/config.json');
export const STATE_PATH = process.env.ONEAI_STATE_PATH || path.join(APP_DIR, 'config/state.json');

export function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export function loadConfig() {
  return readJson(CONFIG_PATH, {});
}

export function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(path.join(APP_DIR, 'logs/bot.log'), line + '\n'); } catch {}
}

export function safeName(s) {
  return String(s || 'meeting').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'meeting';
}
