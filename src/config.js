import fs from 'node:fs';
import path from 'node:path';

export function loadConfig(configPath = process.env.ONEAI_CONFIG_PATH || './config/config.json') {
  const resolved = path.resolve(configPath);
  const fallback = path.resolve('./config/config.example.json');
  const file = fs.existsSync(resolved) ? resolved : fallback;
  const cfg = withDefaults(JSON.parse(fs.readFileSync(file, 'utf8')));
  cfg.__configPath = resolved;
  ensureDirs(cfg);
  return cfg;
}

function withDefaults(cfg) {
  return {
    timezone: 'UTC',
    botName: 'OneAI Recorder',
    botNameRandomSuffix: false,
    botNameRandomDigits: 3,
    display: ':99',
    resolution: '1280x720',
    fps: 15,
    videoBitrate: '2000k',
    videoPreset: 'ultrafast',
    audioBitrate: '192k',
    audioChannels: 2,
    mp3Bitrate: '128k',
    recordingsDir: './recordings',
    logsDir: './logs',
    secretsDir: './secrets',
    joinWaitMinutes: 10,
    maxRecordingMinutesAfterJoin: 120,
    minParticipants: 2,
    autoStopBelowParticipantsSeconds: 60,
    participantCheckMs: 5000,
    segmentedRecording: true,
    segmentSeconds: 60,
    keepSegmentsAfterFinalize: false,
    createMp3AfterRecording: true,
    uploadMp3ToR2: true,
    storage: 'r2',
    sendChatOnRecordingStart: false,
    ...cfg,
    api: {
      host: process.env.ONEAI_API_HOST || '0.0.0.0',
      port: Number(process.env.ONEAI_API_PORT || 8787),
      token: '',
      ...(cfg.api || {})
    }
  };
}

function ensureDirs(cfg) {
  for (const dir of [cfg.logsDir, cfg.recordingsDir, cfg.secretsDir]) {
    fs.mkdirSync(path.resolve(dir), { recursive: true });
  }
}
