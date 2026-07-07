import fs from 'node:fs';
import path from 'node:path';

export const APP_DIR = process.env.ONEAI_APP_DIR || process.cwd();
export const CONFIG_PATH = process.env.ONEAI_CONFIG_PATH || path.join(APP_DIR, 'config/config.json');
export const STATE_PATH = process.env.ONEAI_STATE_PATH || path.join(APP_DIR, 'config/state.json');

export function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
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
  try {
    fs.appendFileSync(path.join(APP_DIR, 'logs/bot.log'), line + '\n');
  } catch {}
}

export function safeName(value) {
  return String(value || 'meeting')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'meeting';
}

export function parseCliArg(name, fallback = '') {
  const hit = process.argv.find(arg => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function makeBotDisplayName(cfg = {}) {
  const base = String(cfg.botNameBase || 'OneAIHUB Recorder').trim() || 'OneAIHUB Recorder';
  if (cfg.botNameRandomSuffix === false) return base;
  const digits = Math.max(1, Math.min(6, Number(cfg.botNameRandomDigits || 3)));
  const max = 10 ** digits;
  const suffix = String(Math.floor(Math.random() * max)).padStart(digits, '0');
  return `${base} ${suffix}`.slice(0, 60);
}
