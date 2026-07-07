import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { APP_DIR, parseCliArg } from '../runtime/common.js';

const CLIENT_PATH = path.join(APP_DIR, 'secrets/google-calendar-oauth-client.json');
const FALLBACK_CLIENT_PATH = path.join(APP_DIR, 'secrets/google-oauth-client.json');
const TOKEN_PATH = path.join(APP_DIR, 'secrets/google-calendar-token.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

function loadClient() {
  const file = fs.existsSync(CLIENT_PATH) ? CLIENT_PATH : FALLBACK_CLIENT_PATH;
  if (!fs.existsSync(file)) {
    throw new Error(`Missing OAuth client JSON: ${CLIENT_PATH} or ${FALLBACK_CLIENT_PATH}`);
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const data = raw.installed || raw.web || raw;
  const redirectUri = (data.redirect_uris || ['urn:ietf:wg:oauth:2.0:oob'])[0];
  return new google.auth.OAuth2(data.client_id, data.client_secret, redirectUri);
}

const code = parseCliArg('code');
const oauth2 = loadClient();

if (!code) {
  const url = oauth2.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
  console.log('Open this URL and authorize Calendar access:');
  console.log(url);
  console.log(`Then run: node src/cli.js auth:calendar --code="PASTE_CODE"`);
  process.exit(0);
}

const { tokens } = await oauth2.getToken(code);
fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2) + '\n');
console.log(`Saved Calendar token to ${TOKEN_PATH}`);
