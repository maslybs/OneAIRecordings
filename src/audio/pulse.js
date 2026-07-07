import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { log } from '../runtime/common.js';

export function configurePulseEnvironment(cfg, display) {
  process.env.DISPLAY = display;
  process.env.PULSE_SINK = 'meet_sink';
  process.env.PULSE_SOURCE = 'bot_mic';
  process.env.XDG_RUNTIME_DIR = cfg.audioRuntimeDir || '/run/user/0';
  fs.mkdirSync(process.env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 });
  process.env.PULSE_SERVER = `unix:${process.env.XDG_RUNTIME_DIR}/pulse/native`;
}

export function ensurePulse() {
  fs.mkdirSync(process.env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 });
  spawnSync('pulseaudio', ['--daemonize=yes', '--exit-idle-time=-1'], {
    encoding: 'utf8',
    env: { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR }
  });

  const modules = spawnSync('pactl', ['list', 'short', 'modules'], { encoding: 'utf8', env: process.env });
  for (const line of (modules.stdout || '').split('\n')) {
    if (line.includes('module-null-sink') || line.includes('module-remap-source')) {
      const id = line.trim().split(/\s+/)[0];
      if (id) spawnSync('pactl', ['unload-module', id], { encoding: 'utf8', env: process.env });
    }
  }

  spawnSync('pactl', ['load-module', 'module-null-sink', 'sink_name=meet_sink', 'sink_properties=device.description=MeetSink'], { encoding: 'utf8', env: process.env });
  spawnSync('pactl', ['load-module', 'module-null-sink', 'sink_name=bot_mic_sink', 'sink_properties=device.description=BotVirtualMic'], { encoding: 'utf8', env: process.env });
  spawnSync('pactl', [
    'load-module',
    'module-remap-source',
    'master=bot_mic_sink.monitor',
    'source_name=bot_mic',
    'source_properties=device.description=BotMic'
  ], { encoding: 'utf8', env: process.env });
  spawnSync('pactl', ['set-default-sink', 'meet_sink'], { encoding: 'utf8', env: process.env });
  spawnSync('pactl', ['set-default-source', 'bot_mic'], { encoding: 'utf8', env: process.env });
}

export async function probeAudioStatus() {
  const info = spawnSync('pactl', ['info'], { encoding: 'utf8', env: process.env });
  const sinks = spawnSync('pactl', ['list', 'short', 'sinks'], { encoding: 'utf8', env: process.env });
  const sources = spawnSync('pactl', ['list', 'short', 'sources'], { encoding: 'utf8', env: process.env });
  const inputs = spawnSync('pactl', ['list', 'short', 'sink-inputs'], { encoding: 'utf8', env: process.env });
  log('Audio status', JSON.stringify({
    info: info.stdout?.trim(),
    sinks: sinks.stdout?.trim(),
    sources: sources.stdout?.trim(),
    sinkInputs: inputs.stdout?.trim()
  }));
}

export function playBeep(cfg) {
  const duration = Math.max(0.2, Number(cfg.beepDurationMs || 800) / 1000);
  const frequency = String(Number(cfg.beepFrequency || 880));
  const volume = String(Number(cfg.beepVolume || 0.25));
  const expr = `sine=frequency=${frequency}:duration=${duration}`;
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', expr, '-filter:a', `volume=${volume}`, '-f', 'pulse', 'bot_mic_sink'], {
    encoding: 'utf8',
    env: process.env
  });
  log('Beep played', JSON.stringify({ status: result.status, duration, frequency, stderr: (result.stderr || '').slice(0, 500) }));
  return result.status === 0;
}
