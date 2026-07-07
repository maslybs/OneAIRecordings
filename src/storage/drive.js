import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { APP_DIR, log } from '../runtime/common.js';

const CRED_PATH = path.join(APP_DIR, 'secrets/google-oauth-client.json');
const TOKEN_PATH = path.join(APP_DIR, 'secrets/google-drive-token.json');
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

export function hasDriveAuth() {
  return fs.existsSync(CRED_PATH) && fs.existsSync(TOKEN_PATH);
}

export function getOAuthClient() {
  if (!fs.existsSync(CRED_PATH)) throw new Error(`Missing ${CRED_PATH}`);
  const raw = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
  const cfg = raw.installed || raw.web || raw;
  const redirect = (cfg.redirect_uris && cfg.redirect_uris[0]) || 'urn:ietf:wg:oauth:2.0:oob';
  return new google.auth.OAuth2(cfg.client_id, cfg.client_secret, redirect);
}

export function getAuthUrl() {
  const client = getOAuthClient();
  return client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
}

export async function saveTokenFromCode(code) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2) + '\n');
  return TOKEN_PATH;
}

export async function uploadToDrive(filePath, folderId = '') {
  if (!hasDriveAuth()) {
    log('Drive upload skipped: OAuth credentials/token not configured');
    return null;
  }
  const auth = getOAuthClient();
  auth.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));
  const drive = google.drive({ version: 'v3', auth });
  const fileMetadata = { name: path.basename(filePath) };
  if (folderId) fileMetadata.parents = [folderId];
  const media = { mimeType: 'video/mp4', body: fs.createReadStream(filePath) };
  const response = await drive.files.create({ requestBody: fileMetadata, media, fields: 'id,name,webViewLink' });
  log('Uploaded to Drive:', JSON.stringify(response.data));
  return response.data;
}
