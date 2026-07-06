#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from './utils.js';

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || 'api';

try {
  if (isLegacyCommand(command)) {
    await runLegacy(command, process.argv.slice(3));
  } else {
    await runModular(command, args);
  }
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}

async function runModular(command, args) {
  const modularCommand = command.startsWith('modular:') ? command.slice('modular:'.length) : command;
  const { loadConfig } = await import('./config.js');
  const { createLogger } = await import('./logger.js');
  const cfg = loadConfig(args.config);
  const logger = createLogger({ logsDir: cfg.logsDir, name: 'bot' });

  if (modularCommand === 'api') {
    const { ApiServer } = await import('./server/api.js');
    new ApiServer({ cfg, logger }).listen();
  } else if (modularCommand === 'scheduler') {
    const { Scheduler } = await import('./scheduler.js');
    await new Scheduler({ cfg, logger }).start();
  } else if (modularCommand === 'record') {
    await recordOnce(args, cfg, logger);
  } else if (modularCommand === 'doctor') {
    doctor(cfg);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}

async function runLegacy(command, passthroughArgs) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const scripts = {
    'add-job': 'add-job.js',
    'api': 'api-server.js',
    'auth:calendar': 'auth-calendar.js',
    'auth:drive': 'auth-drive.js',
    'calendar:sync': 'calendar-sync.js',
    'doctor': 'doctor.js',
    'record': 'record.js',
    'scheduler': 'scheduler.js',
    'legacy:add-job': 'add-job.js',
    'legacy:auth-calendar': 'auth-calendar.js',
    'legacy:auth-drive': 'auth-drive.js',
    'legacy:calendar-sync': 'calendar-sync.js',
    'legacy:record': 'record.js',
    'legacy:api': 'api-server.js',
    'legacy:scheduler': 'scheduler.js',
    'legacy:doctor': 'doctor.js'
  };
  const script = scripts[command];
  if (!script) throw new Error(`Unknown command: ${command}`);

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(here, 'legacy', script), ...passthroughArgs], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exitCode = code ?? 0;
      resolve();
    });
  });
}

function isLegacyCommand(command) {
  return [
    'add-job',
    'api',
    'auth:calendar',
    'auth:drive',
    'calendar:sync',
    'doctor',
    'record',
    'scheduler'
  ].includes(command) || command.startsWith('legacy:');
}

async function recordOnce(args, cfg, logger) {
  const { createProvider, guessProvider } = await import('./providers/index.js');
  const { RecordingSession } = await import('./recorder/session.js');
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
