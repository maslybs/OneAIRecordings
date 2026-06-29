import fs from 'node:fs';
import path from 'node:path';
import { RecordingSession } from './recorder/session.js';
import { createProvider, guessProvider } from './providers/index.js';
import { sleep } from './utils.js';

export class Scheduler {
  constructor({ cfg, logger }) {
    this.cfg = cfg;
    this.logger = logger;
    this.activeSession = null;
    this.stateFile = path.resolve('./config/state.json');
    this.state = this.loadState();
  }

  async start() {
    this.logger.info('scheduler started');
    while (true) {
      await this.tick().catch(error => this.logger.error('scheduler tick failed', error));
      await sleep(5000);
    }
  }

  async tick() {
    if (this.activeSession) return;
    const due = (this.cfg.jobs || [])
      .filter(job => job.enabled !== false && !this.state.startedJobs[job.id])
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
      .find(job => new Date(job.startAt).getTime() <= Date.now());
    if (!due) return;
    this.state.startedJobs[due.id] = new Date().toISOString();
    this.saveState();
    this.logger.info('launching scheduled job', due);
    const provider = createProvider(due.provider || guessProvider(due.url), this.cfg, this.logger);
    this.activeSession = new RecordingSession({ cfg: this.cfg, provider, logger: this.logger });
    this.activeSession.run(due)
      .then(result => this.logger.info('scheduled job finished', result))
      .catch(error => this.logger.error('scheduled job failed', error))
      .finally(() => { this.activeSession = null; });
  }

  loadState() {
    try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); }
    catch { return { startedJobs: {} }; }
  }

  saveState() {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2) + '\n');
  }
}
