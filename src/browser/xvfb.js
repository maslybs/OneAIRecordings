import fs from 'node:fs';
import { spawn } from 'node:child_process';

export function ensureX(display) {
  const n = display.replace(':', '');
  const lock = `/tmp/.X${n}-lock`;
  if (fs.existsSync(lock)) return null;
  const process = spawn('Xvfb', [display, '-screen', '0', '1280x720x24', '-ac', '+extension', 'RANDR'], {
    detached: true,
    stdio: 'ignore'
  });
  process.unref();
  return process;
}
