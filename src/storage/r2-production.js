import fs from 'node:fs';
import path from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { APP_DIR, log, readJson, safeName } from '../runtime/common.js';

const R2_SECRET_PATH = path.join(APP_DIR, 'secrets/r2.json');

function compact(obj) {
  return Object.fromEntries(Object.entries(obj || {}).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function getR2Config(cfg = {}) {
  const file = readJson(R2_SECRET_PATH, {});
  const env = compact({
    accountId: process.env.R2_ACCOUNT_ID,
    bucket: process.env.R2_BUCKET,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
    prefix: process.env.R2_PREFIX
  });
  return { ...(cfg.r2 || {}), ...file, ...env };
}

export function hasR2Config(cfg = {}) {
  const r2 = getR2Config(cfg);
  return Boolean(r2.accountId && r2.bucket && r2.accessKeyId && r2.secretAccessKey);
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.mkv') return 'video/x-matroska';
  if (ext === '.json') return 'application/json';
  return 'application/octet-stream';
}

function buildObjectKey(filePath, r2, metadata = {}) {
  const date = new Date();
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const prefix = String(r2.prefix || 'meet-recordings').replace(/^\/+|\/+$/g, '');
  const title = metadata.title ? `${safeName(metadata.title)}-` : '';
  return `${prefix}/${yyyy}/${mm}/${dd}/${title}${path.basename(filePath)}`;
}

export async function uploadToR2(filePath, cfg = {}, metadata = {}) {
  const r2 = getR2Config(cfg);
  if (!hasR2Config(cfg)) {
    log('R2 upload skipped: credentials not configured');
    return null;
  }
  if (!fs.existsSync(filePath)) {
    log('R2 upload skipped: file missing', filePath);
    return null;
  }

  const key = metadata.key || buildObjectKey(filePath, r2, metadata);
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: r2.accessKeyId,
      secretAccessKey: r2.secretAccessKey
    }
  });

  const stat = fs.statSync(filePath);
  await client.send(new PutObjectCommand({
    Bucket: r2.bucket,
    Key: key,
    Body: fs.createReadStream(filePath),
    ContentType: contentTypeFor(filePath),
    ContentLength: stat.size,
    Metadata: compact({
      title: metadata.title,
      meet_code: metadata.meetCode,
      recorded_at: metadata.recordedAt
    })
  }));

  const publicBaseUrl = String(r2.publicBaseUrl || '').replace(/\/+$/g, '');
  const url = publicBaseUrl ? `${publicBaseUrl}/${key}` : `r2://${r2.bucket}/${key}`;
  log('R2 upload done', url, `${stat.size} bytes`);
  return { bucket: r2.bucket, key, url, size: stat.size };
}
