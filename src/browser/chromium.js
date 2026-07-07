import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

export async function launchMeetBrowser(cfg, display) {
  const profileDir = cfg.guestProfileDir || path.join('/tmp', `meet-recorder-profile-${Date.now()}`);
  if (!cfg.guestProfileDir) fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });

  const browser = await puppeteer.launch({
    executablePath: cfg.chromeExecutable || '/snap/bin/chromium',
    headless: false,
    userDataDir: profileDir,
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-notifications', '--autoplay-policy=no-user-gesture-required',
      '--no-first-run', '--no-default-browser-check', '--disable-popup-blocking', '--test-type',
      '--window-size=1280,720', '--start-maximized', '--kiosk',
      '--use-fake-ui-for-media-stream',
      ...(cfg.useFakeMediaDevice ? ['--use-fake-device-for-media-stream'] : []),
      '--disable-infobars', '--disable-blink-features=AutomationControlled',
      '--lang=en-US,en'
    ],
    env: {
      ...process.env,
      DISPLAY: display,
      PULSE_SINK: 'meet_sink',
      PULSE_SOURCE: 'bot_mic',
      PULSE_SERVER: process.env.PULSE_SERVER,
      LANG: 'en_US.UTF-8',
      LANGUAGE: 'en_US:en'
    }
  });

  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  page.setDefaultTimeout(30000);
  return { browser, page, profileDir };
}
