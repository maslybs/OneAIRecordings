export class ZoomProvider {
  constructor(cfg, logger) {
    this.cfg = cfg;
    this.logger = logger;
  }

  async start() {
    throw new Error('ZoomProvider is scaffolded but not implemented yet. Implement browser join flow or Zoom Meeting SDK integration.');
  }

  async join() {
    return { ok: false, reason: 'not-supported', state: { provider: 'zoom' } };
  }

  async beforeRecording() {}

  async getParticipantCount() {
    return null;
  }

  async close() {}
}
