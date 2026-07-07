import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR } from '../runtime/common.js';

const commands = ['node', 'npm', 'ffmpeg', 'Xvfb', 'pulseaudio', 'pactl', 'chromium'];
for (const command of commands) {
  const result = spawnSync('bash', ['-lc', `command -v ${command}`], { encoding: 'utf8' });
  console.log(`${command}: ${result.status === 0 ? result.stdout.trim() : 'missing'}`);
}

console.log('config:', fs.existsSync(path.join(APP_DIR, 'config/config.json')));
console.log('drive creds:', fs.existsSync(path.join(APP_DIR, 'secrets/google-oauth-client.json')));
console.log('drive token:', fs.existsSync(path.join(APP_DIR, 'secrets/google-drive-token.json')));
