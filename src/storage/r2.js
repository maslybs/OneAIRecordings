import fs from 'node:fs';
import path from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { safeName } from '../utils.js';

export function loadR2Config(cfg) {
  const secretsFile = path.resolve(cfg.secretsDir || './secrets', 'r2.json');
  const file = fs.existsSync(secretsFile) ? JSON.parse(fs.readFileSync(secretsFile, 'utf8')) : {};
  return {
    ...(cfg.r2 || {}),
    ...file,
    accountId: process.env.R2_ACCOUNT_ID || file.accountId || cfg.r2?.accountId,
    bucket: process.env.R2_BUCKET || file.bucket || cfg.r2?.bucket,
    accessKeyId: process.env.R2_ACCESS_KEY_ID || file.accessKeyId,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || file.secretAccessKey,
    prefix: process.env.R2_PREFIX || file.prefix || cfg.r2?.prefix || 'meet-recordings',
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL || file.publicBaseUrl || cfg.r2?.publicBaseUrl
  };
}

export async function uploadToR2(filePath, cfg, metadata = {}) {
  const r2 = loadR2Config(cfg);
  if (!r2.accountId || !r2.bucket || !r2.accessKeyId || !r2.secretAccessKey) throw new Error('R2 credentials are not configured');
  const stat = fs.statSync(filePath);
  const key = objectKey(filePath, r2, metadata);
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey }
  });
  await client.send(new PutObjectCommand({
    Bucket: r2.bucket,
    Key: key,
    Body: fs.createReadStream(filePath),
    ContentLength: stat.size,
    ContentType: contentType(filePath),
    Metadata: compact({ title: metadata.title, meeting_code: metadata.meetingCode, recorded_at: metadata.recordedAt })
  }));
  return { bucket: r2.bucket, key, url: publicUrl(r2, key), size: stat.size };
}

function objectKey(filePath, r2, metadata) {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const prefix = String(r2.prefix || 'meet-recordings').replace(/^\/+|\/+$/g, '');
  const title = metadata.title ? `${safeName(metadata.title)}-` : '';
  return `${prefix}/${yyyy}/${mm}/${dd}/${title}${path.basename(filePath)}`;
}

function publicUrl(r2, key) {
  return r2.publicBaseUrl ? `${String(r2.publicBaseUrl).replace(/\/+$/g, '')}/${key}` : `r2://${r2.bucket}/${key}`;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.mkv') return 'video/x-matroska';
  return 'application/octet-stream';
}

function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}
