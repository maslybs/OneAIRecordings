#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { parseArgs } from './utils.js';
import { createProvider, guessProvider } from './providers/index.js';
import { RecordingSession } from './recorder/session.js';
import { ApiServer } from './server/api.js';
import { Scheduler } from './scheduler.js';

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || 'api';
const cfg = loadConfig(args.config);
const logger = createLogger({ logsDir: cfg.logsDir, name: 'bot' });

try {
  if (command === 'api') {
    new ApiServer({ cfg, logger }).listen();
  } else if (command === 'scheduler') {
    await new Scheduler({ cfg, logger }).start();
  } else if (command === 'record') {
    await recordOnce(args, cfg, logger);
  } else if (command === 'doctor') {
    doctor(cfg);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  logger.error('fatal', error);
  process.exitCode = 1;
}

async function recordOnce(args, cfg, logger) {
  if (!args.url) throw new Error('--url is required');
  const provider = createProvider(args.provider || guessProvider(args.url), cfg, logger);
  const session = new RecordingSession({ cfg, provider, logger });
  process.on('SIGINT', () => session.requestStop('sigint'));
  process.on('SIGTERM', () => session.requestStop('sigterm'));
  const result = await session.run({ url: args.url, title: args.title || args.url, durationMinutes: Number(args.duration || args.durationMinutes || cfg.maxRecordingMinutesAfterJoin) });
  console.log(JSON.stringify(result, null, 2));
}

function doctor(cfg) {
  for (const [cmd, cmdArgs] of [['node', ['--version']], ['ffmpeg', ['-version']], ['ffprobe', ['-version']], [cfg.chromeExecutable, ['--version']]]) {
    const result = spawnSync(cmd, cmdArgs, { encoding: 'utf8' });
    console.log(`${cmd}: ${result.status === 0 ? 'ok' : 'missing'}`);
  }
}
