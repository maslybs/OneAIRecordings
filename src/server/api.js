import http from 'node:http';
import { RecordingSession } from '../recorder/session.js';
import { createProvider, guessProvider } from '../providers/index.js';

export class ApiServer {
  constructor({ cfg, logger }) {
    this.cfg = cfg;
    this.logger = logger;
    this.activeSession = null;
  }

  listen() {
    const server = http.createServer((req, res) => this.handle(req, res));
    server.listen(this.cfg.api.port, this.cfg.api.host, () => this.logger.info('api listening', this.cfg.api));
    return server;
  }

  async handle(req, res) {
    try {
      if (this.cfg.api.token && req.headers.authorization !== `Bearer ${this.cfg.api.token}`) return send(res, 401, { error: 'unauthorized' });
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/status') return send(res, 200, this.status());
      if (req.method === 'POST' && url.pathname === '/record/start') return send(res, 202, await this.startRecording(await readJson(req)));
      if (req.method === 'POST' && url.pathname === '/record/stop') return send(res, 202, this.stopRecording());
      return send(res, 404, { error: 'not_found' });
    } catch (error) {
      this.logger.error('api error', error);
      return send(res, 500, { error: error.message });
    }
  }

  status() {
    return { active: Boolean(this.activeSession) };
  }

  async startRecording(body) {
    if (this.activeSession) throw new Error('Recording already active');
    if (!body.url) throw new Error('url is required');
    const provider = createProvider(body.provider || guessProvider(body.url), this.cfg, this.logger);
    const session = new RecordingSession({ cfg: this.cfg, provider, logger: this.logger });
    this.activeSession = session;
    session.run({ url: body.url, title: body.title || body.url, durationMinutes: body.durationMinutes })
      .then(result => this.logger.info('recording finished', result))
      .catch(error => this.logger.error('recording failed', error))
      .finally(() => { this.activeSession = null; });
    return { ok: true, active: true };
  }

  stopRecording() {
    if (!this.activeSession) return { ok: true, active: false, message: 'no active recording' };
    this.activeSession.requestStop('manual-stop');
    return { ok: true, active: true, stopping: true };
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (error) { reject(error); }
    });
  });
}
