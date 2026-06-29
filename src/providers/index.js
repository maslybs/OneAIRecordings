import { MeetProvider } from './meet.js';
import { ZoomProvider } from './zoom.js';

export function guessProvider(url) {
  const value = String(url || '').toLowerCase();
  if (value.includes('meet.google.com')) return 'meet';
  if (value.includes('zoom.us')) return 'zoom';
  return 'meet';
}

export function createProvider(name, cfg, logger) {
  const provider = String(name || '').toLowerCase();
  if (provider === 'meet' || provider === 'google-meet') return new MeetProvider(cfg, logger);
  if (provider === 'zoom') return new ZoomProvider(cfg, logger);
  throw new Error(`Unsupported provider: ${name}`);
}
