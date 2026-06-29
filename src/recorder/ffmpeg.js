import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileTimestamp, safeName } from '../utils.js';

export class FfmpegRecorder {
  constructor(cfg, logger) {
    this.cfg = cfg;
    this.logger = logger;
    this.process = null;
    this.outputPath = null;
    this.segmentDir = null;
  }

  start({ title }) {
    this.outputPath = path.resolve(this.cfg.recordingsDir, `${fileTimestamp()}-${safeName(title)}.mp4`);
    const args = this.cfg.segmentedRecording === false ? this.directArgs(this.outputPath) : this.segmentedArgs(this.outputPath);
    this.logger.info('ffmpeg starting', { outputPath: this.outputPath, segmented: this.cfg.segmentedRecording !== false });
    this.process = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.process.stderr.on('data', chunk => fs.appendFileSync(path.resolve(this.cfg.logsDir, 'ffmpeg.log'), chunk));
    return this.outputPath;
  }

  directArgs(outFile) {
    return [
      '-y',
      '-thread_queue_size', String(this.cfg.ffmpegThreadQueueSize || 4096),
      '-f', 'x11grab', '-video_size', this.cfg.resolution, '-framerate', String(this.cfg.fps), '-i', this.cfg.display,
      '-thread_queue_size', String(this.cfg.ffmpegThreadQueueSize || 4096),
      '-f', 'pulse', '-i', 'meet_sink.monitor',
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'libx264', '-preset', this.cfg.videoPreset || 'ultrafast', '-b:v', this.cfg.videoBitrate || '2000k', '-pix_fmt', 'yuv420p',
      '-vsync', 'cfr', '-af', 'aresample=async=1000:first_pts=0',
      '-c:a', 'aac', '-b:a', this.cfg.audioBitrate || '192k', '-ar', '48000', '-ac', String(this.cfg.audioChannels || 2),
      '-movflags', '+frag_keyframe+empty_moov+default_base_moof', outFile
    ];
  }

  segmentedArgs(outFile) {
    this.segmentDir = outFile.replace(/\.mp4$/i, '.segments');
    fs.mkdirSync(this.segmentDir, { recursive: true });
    return [
      '-y',
      '-thread_queue_size', String(this.cfg.ffmpegThreadQueueSize || 4096),
      '-f', 'x11grab', '-video_size', this.cfg.resolution, '-framerate', String(this.cfg.fps), '-i', this.cfg.display,
      '-thread_queue_size', String(this.cfg.ffmpegThreadQueueSize || 4096),
      '-f', 'pulse', '-i', 'meet_sink.monitor',
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'libx264', '-preset', this.cfg.videoPreset || 'ultrafast', '-b:v', this.cfg.videoBitrate || '2000k', '-pix_fmt', 'yuv420p',
      '-vsync', 'cfr', '-af', 'aresample=async=1000:first_pts=0',
      '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', String(this.cfg.audioChannels || 2),
      '-f', 'segment', '-segment_time', String(this.cfg.segmentSeconds || 60), '-reset_timestamps', '1', '-segment_format', 'matroska',
      path.join(this.segmentDir, 'segment-%05d.mkv')
    ];
  }

  async stop() {
    if (!this.process || this.process.killed) return;
    this.logger.info('ffmpeg stopping');
    this.process.kill('SIGINT');
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 15000);
      this.process.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    if (!this.process.killed) this.process.kill('SIGTERM');
  }

  finalize() {
    if (this.cfg.segmentedRecording === false) return this.validate(this.outputPath);
    const files = fs.readdirSync(this.segmentDir).filter(f => /^segment-\d+\.mkv$/.test(f)).sort().map(f => path.resolve(this.segmentDir, f));
    if (!files.length) throw new Error(`No recording segments in ${this.segmentDir}`);
    const listFile = path.join(this.segmentDir, 'segments.txt');
    fs.writeFileSync(listFile, files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    const r = spawnSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'copy', '-c:a', 'aac', '-b:a', this.cfg.audioBitrate || '192k', '-ar', '48000', '-ac', String(this.cfg.audioChannels || 2), '-movflags', '+faststart', this.outputPath], { encoding: 'utf8' });
    fs.appendFileSync(path.resolve(this.cfg.logsDir, 'ffmpeg.log'), `\nFINALIZE_EXIT=${r.status}\n${r.stdout || ''}\n${r.stderr || ''}\n`);
    if (r.status !== 0) throw new Error(`FFmpeg finalize failed with code ${r.status}`);
    this.validate(this.outputPath);
    if (!this.cfg.keepSegmentsAfterFinalize) fs.rmSync(this.segmentDir, { recursive: true, force: true });
    return this.outputPath;
  }

  createMp3(mp4Path) {
    const mp3Path = mp4Path.replace(/\.mp4$/i, '.mp3');
    const r = spawnSync('ffmpeg', ['-y', '-i', mp4Path, '-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', this.cfg.mp3Bitrate || '128k', '-ar', '44100', '-ac', '2', mp3Path], { encoding: 'utf8' });
    fs.appendFileSync(path.resolve(this.cfg.logsDir, 'ffmpeg.log'), `\nCREATE_MP3_EXIT=${r.status}\n${r.stdout || ''}\n${r.stderr || ''}\n`);
    if (r.status !== 0) throw new Error(`MP3 creation failed with code ${r.status}`);
    return this.validate(mp3Path);
  }

  validate(filePath) {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size <= 0) throw new Error(`Invalid media file: ${filePath}`);
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size,bit_rate', '-of', 'json', filePath], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ffprobe failed: ${filePath}`);
    this.logger.info('media validated', { filePath, format: JSON.parse(r.stdout || '{}').format });
    return filePath;
  }
}
