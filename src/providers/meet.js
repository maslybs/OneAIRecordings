import puppeteer from 'puppeteer-core';
import { sleep } from '../utils.js';

export class MeetProvider {
  constructor(cfg, logger) {
    this.cfg = cfg;
    this.logger = logger;
    this.browser = null;
    this.page = null;
  }

  async start() {
    this.browser = await puppeteer.launch({
      executablePath: this.cfg.chromeExecutable,
      headless: false,
      ignoreDefaultArgs: ['--enable-automation'],
      env: { ...process.env, PULSE_SINK: 'meet_sink', PULSE_SOURCE: 'bot_mic' },
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-notifications',
        '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check',
        '--disable-popup-blocking', '--test-type', `--window-size=${this.cfg.resolution.replace('x', ',')}`,
        '--start-maximized', '--kiosk', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
        '--disable-infobars', '--disable-blink-features=AutomationControlled', '--lang=en-US,en'
      ]
    });
    this.page = await this.browser.newPage();
    const [width, height] = this.cfg.resolution.split('x').map(Number);
    await this.page.setViewport({ width, height });
  }

  async join({ url, displayName, joinWaitMs }) {
    await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
    await this.fillName(displayName);
    await this.clickJoinButton();
    const end = Date.now() + joinWaitMs;
    while (Date.now() < end) {
      const state = await this.detectState();
      this.logger.info('join state', state);
      if (state.joined) return { ok: true, state };
      if (state.rejected) return { ok: false, reason: 'rejected-or-not-allowed', state };
      await sleep(3000);
    }
    return { ok: false, reason: 'join-timeout', state: await this.detectState() };
  }

  async beforeRecording() {
    if (this.cfg.sendChatOnRecordingStart && this.cfg.recordingStartMessage) await this.sendChat(this.cfg.recordingStartMessage);
    await this.cleanupUi();
  }

  async getParticipantCount() {
    return this.page.evaluate(() => {
      const body = document.body?.innerText || '';
      const other = body.match(/There are (\d+) other people in the call/i);
      if (other) return Number(other[1]) + 1;
      const total = body.match(/(\d+) people? in the call/i);
      if (total) return Number(total[1]);
      return null;
    }).catch(() => null);
  }

  async close() {
    await this.browser?.close();
  }

  async fillName(displayName) {
    const input = await this.page.$('input[aria-label="Your name"], input[placeholder="Your name"]');
    if (!input) return;
    await input.click({ clickCount: 3 });
    await input.type(displayName);
  }

  async clickJoinButton() {
    const clicked = await this.page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('button, div[role="button"]'));
      const button = items.find(el => /ask to join|join now|приєднатися|попросити/i.test(el.innerText || el.getAttribute('aria-label') || ''));
      if (!button) return false;
      button.click();
      return true;
    });
    if (!clicked) throw new Error('Google Meet join button not found');
  }

  async detectState() {
    return this.page.evaluate(() => {
      const body = document.body?.innerText || '';
      return {
        joined: /You have joined|Meeting details|Leave call|Chat with everyone/i.test(body) && !/Please wait until/i.test(body),
        waiting: /Please wait until|waiting|asks to join/i.test(body),
        rejected: /You can't join|not allowed|rejected|denied/i.test(body),
        body: body.slice(0, 500)
      };
    }).catch(error => ({ joined: false, waiting: false, rejected: false, error: String(error) }));
  }

  async sendChat(message) {
    const sent = await this.page.evaluate(async text => {
      const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
      buttons.find(el => /chat/i.test(el.innerText || el.getAttribute('aria-label') || ''))?.click();
      await new Promise(resolve => setTimeout(resolve, 800));
      const input = document.querySelector('textarea, div[contenteditable="true"]');
      if (!input) return false;
      input.focus();
      if (input.tagName === 'TEXTAREA') input.value = text;
      else input.textContent = text;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      return true;
    }, message);
    this.logger.info('chat notification', { sent });
  }

  async cleanupUi() {
    await this.page.keyboard.press('Escape').catch(() => null);
    await this.page.keyboard.press('Escape').catch(() => null);
    await this.page.evaluate(() => {
      const textOf = el => `${el.innerText || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`;
      for (const el of Array.from(document.querySelectorAll('button, div[role="button"]'))) {
        const text = textOf(el);
        if (/turn off captions|вимкнути субтитри/i.test(text)) el.click();
        if (/^(close|dismiss|закрити)$/i.test(text.trim())) el.click();
      }
    }).catch(() => null);
    const [width] = this.cfg.resolution.split('x').map(Number);
    await this.page.mouse.move(width - 1, 1).catch(() => null);
    await sleep(1200);
  }
}
