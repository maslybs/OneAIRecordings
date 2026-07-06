import { spawnSync } from 'child_process';
import fs from 'fs';
const cmds = ['node','npm','ffmpeg','Xvfb','pulseaudio','pactl','chromium'];
for (const c of cmds) {
  const r = spawnSync('bash', ['-lc', `command -v ${c}`], { encoding: 'utf8' });
  console.log(`${c}: ${r.status === 0 ? r.stdout.trim() : 'missing'}`);
}
console.log('config:', fs.existsSync('/opt/meet-recorder-bot/config/config.json'));
console.log('drive creds:', fs.existsSync('/opt/meet-recorder-bot/secrets/google-oauth-client.json'));
console.log('drive token:', fs.existsSync('/opt/meet-recorder-bot/secrets/google-drive-token.json'));
