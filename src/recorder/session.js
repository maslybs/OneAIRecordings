import { FfmpegRecorder } from './ffmpeg.js';
import { uploadToR2 } from '../storage/r2.js';
import { randomDigits, sleep } from '../utils.js';

export class RecordingSession {
  constructor({ cfg, provider, logger }) {
    this.cfg = cfg;
    this.provider = provider;
    this.logger = logger;
    this.ffmpeg = new FfmpegRecorder(cfg, logger);
    this.stopRequested = false;
    this.stopReason = null;
  }

  requestStop(reason = 'manual-stop') {
    this.stopRequested = true;
    this.stopReason = reason;
    this.logger.info('stop requested', reason);
  }

  async run(job) {
    const recordedAt = new Date().toISOString();
    await this.provider.start();
    const join = await this.provider.join({
      url: job.url,
      displayName: this.displayName(),
      joinWaitMs: Number(this.cfg.joinWaitMinutes || 10) * 60 * 1000
    });

    if (!join.ok) {
      await this.provider.close().catch(() => null);
      return { ok: false, reason: join.reason, join };
    }

    await this.provider.beforeRecording?.();
    const mp4Target = this.ffmpeg.start({ title: job.title || job.url });
    await this.waitForStopCondition();
    await this.ffmpeg.stop();

    const mp4 = this.ffmpeg.finalize();
    const mp3 = this.cfg.createMp3AfterRecording === false ? null : this.ffmpeg.createMp3(mp4);
    const uploads = [];

    if (this.cfg.storage === 'r2') {
      uploads.push(await uploadToR2(mp4, this.cfg, { title: job.title, meetingCode: meetingCode(job.url), recordedAt }));
      if (mp3 && this.cfg.uploadMp3ToR2 !== false) {
        uploads.push(await uploadToR2(mp3, this.cfg, { title: job.title, meetingCode: meetingCode(job.url), recordedAt, mediaType: 'audio' }));
      }
    }

    await this.provider.close().catch(error => this.logger.warn('provider close failed', error));
    return { ok: true, reason: this.stopReason || 'completed', files: { mp4, mp3, mp4Target }, uploads };
  }

  async waitForStopCondition() {
    const start = Date.now();
    const maxMs = Number(this.cfg.maxRecordingMinutesAfterJoin || 0) * 60 * 1000;
    let belowSince = null;

    while (!this.stopRequested) {
      if (maxMs > 0 && Date.now() - start >= maxMs) {
        this.requestStop('duration-ended');
        break;
      }

      const count = await this.provider.getParticipantCount?.().catch(() => null);
      if (typeof count === 'number') {
        this.logger.info('participant count', count);
        if (count < Number(this.cfg.minParticipants ?? 2)) {
          belowSince ||= Date.now();
          if (Date.now() - belowSince >= Number(this.cfg.autoStopBelowParticipantsSeconds || 60) * 1000) {
            this.requestStop('participants-below-threshold');
            break;
          }
        } else {
          belowSince = null;
        }
      }

      await sleep(Number(this.cfg.participantCheckMs || 5000));
    }
  }

  displayName() {
    if (!this.cfg.botNameRandomSuffix) return this.cfg.botName;
    return `${this.cfg.botName} ${randomDigits(this.cfg.botNameRandomDigits || 3)}`;
  }
}

function meetingCode(url) {
  return String(url || '').match(/(?:meet\.google\.com|zoom\.us\/j)\/([^/?#]+)/)?.[1] || '';
}
