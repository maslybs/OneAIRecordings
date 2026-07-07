import { sleep, log } from '../../runtime/common.js';
import { pageDebug } from './page-debug.js';
import { playBeep } from '../../audio/pulse.js';

export async function clickButtonByText(page, patterns, timeoutMs = 45000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const result = await page.evaluate((patterns) => {
      const visible = el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const tests = patterns.map(pattern => new RegExp(pattern, 'i'));
      const elements = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(visible);
      const scored = elements.map(el => {
        const label = `${el.innerText || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.replace(/\s+/g, ' ').trim();
        const matchIndex = tests.findIndex(test => test.test(label));
        return { el, label, matchIndex };
      }).filter(item => item.matchIndex >= 0).sort((a, b) => a.matchIndex - b.matchIndex || a.label.length - b.label.length);
      const target = scored[0]?.el;
      if (!target) return null;
      target.scrollIntoView({ block: 'center', inline: 'center' });
      target.click();
      return scored[0].label;
    }, patterns).catch(error => `ERROR:${String(error)}`);
    if (result) return result;
    await sleep(1000);
  }
  return null;
}

export async function fillGuestName(page, name) {
  return await page.evaluate((name) => {
    const visible = el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const candidates = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]')).filter(visible);
    const scored = candidates.map(el => {
      const text = `${el.placeholder || ''} ${el.getAttribute('aria-label') || ''} ${el.name || ''} ${el.id || ''}`.toLowerCase();
      let score = 0;
      if (/name|your name|ім.?я|имя/.test(text)) score += 10;
      if (el.maxLength === 60) score += 5;
      if ((el.tagName === 'INPUT' && (!el.type || el.type === 'text')) || el.tagName === 'TEXTAREA') score += 2;
      return { el, score };
    }).sort((a, b) => b.score - a.score);
    const el = scored[0]?.el;
    if (!el) return { ok: false };
    el.focus();
    if (el.isContentEditable) {
      el.textContent = name;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: name }));
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter ? setter.call(el, name) : (el.value = name);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { ok: true, tag: el.tagName, placeholder: el.placeholder || '', aria: el.getAttribute('aria-label') || '', value: el.value || el.textContent || '' };
  }, name).catch(error => ({ ok: false, error: String(error) }));
}

export async function setMicEnabled(page, enabled) {
  const patterns = enabled
    ? ['turn on microphone', 'увімкнути мікрофон', 'включить микрофон']
    : ['turn off microphone', 'вимкнути мікрофон', 'отключить микрофон'];
  const clicked = await clickButtonByText(page, patterns, 3000).catch(() => null);
  log(enabled ? 'Mic enable attempt:' : 'Mic disable attempt:', clicked || 'not-needed-or-not-found');
  await sleep(500);
  return clicked;
}

export async function sendChatMessage(page, message) {
  if (!message) return false;
  const opened = await clickButtonByText(page, ['chat with everyone', 'чат з усіма', 'чат со всеми', '^\\s*chat\\s*$'], 5000).catch(() => null);
  log('Chat open attempt:', opened || 'not-found-or-already-open');
  await sleep(1200);
  const focused = await page.evaluate(() => {
    const visible = el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 20 && rect.height > 10 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const fields = Array.from(document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]')).filter(visible);
    const scored = fields.map(el => {
      const label = `${el.placeholder || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('role') || ''}`.toLowerCase();
      let score = 0;
      if (/message|send|chat|повідом|сообщ/.test(label)) score += 10;
      if (el.isContentEditable) score += 3;
      if (el.tagName === 'TEXTAREA') score += 2;
      const rect = el.getBoundingClientRect();
      score += Math.min(3, rect.bottom / Math.max(1, window.innerHeight));
      return { el, score };
    }).sort((a, b) => b.score - a.score);
    const el = scored[0]?.el;
    if (!el) return false;
    el.focus();
    return true;
  }).catch(() => false);
  if (!focused) {
    log('Chat message failed: input not found');
    await closeMeetSidePanels(page, 'chat-input-not-found').catch(() => null);
    return false;
  }
  await page.keyboard.type(message, { delay: 10 }).catch(() => null);
  await sleep(200);
  await page.keyboard.press('Enter').catch(() => null);
  await sleep(900);
  log('Chat message sent attempt:', message);
  await closeMeetSidePanels(page, 'after-chat-message').catch(error => log('Chat close failed:', String(error)));
  return true;
}

export async function closeMeetSidePanels(page, label = 'close-panels') {
  const result = await page.evaluate(() => {
    const clicked = [];
    const visible = el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const textOf = el => `${el.innerText || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.replace(/\s+/g, ' ').trim();
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(visible);
    for (const el of buttons) {
      const text = textOf(el);
      const rect = el.getBoundingClientRect();
      const parent = textOf(el.closest('[role="dialog"], aside, [aria-label], div') || el);
      const looksLikeClose = /^(close|dismiss|закрити|сховати)$/i.test(text) || /^close\b/i.test(text);
      const isCaptionButton = /caption|subtitles|субтитр/i.test(parent + ' ' + text);
      const isRightPanel = rect.left > window.innerWidth * 0.45;
      const isMeetPanel = /chat|everyone|message|people|participants|activities|meeting details|повідомл|чат|учасник|люди|деталі/i.test(parent + ' ' + text);
      if (looksLikeClose && !isCaptionButton && (isRightPanel || isMeetPanel)) {
        try { el.click(); clicked.push(`side-panel:${text || 'close'}`); } catch {}
      }
    }
    for (const el of buttons) {
      const text = textOf(el);
      const pressed = el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-expanded') === 'true';
      const isPanelToggle = /chat with everyone|chat$|people|show everyone|participants|чат|учасники/i.test(text);
      if (pressed && isPanelToggle) {
        try { el.click(); clicked.push(`toggle-off:${text}`); } catch {}
      }
    }
    return clicked;
  }).catch(error => [`ERROR:${String(error)}`]);
  await page.keyboard.press('Escape').catch(() => null);
  await sleep(300);
  await page.keyboard.press('Escape').catch(() => null);
  await page.mouse.move(1279, 1).catch(() => null);
  await sleep(1200);
  log('Meet side panels close', label, JSON.stringify(result));
}

export async function ensureCaptionsOff(page, label = 'captions-off') {
  const result = await page.evaluate(() => {
    const clicked = [];
    const visible = el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const textOf = el => `${el.innerText || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.replace(/\s+/g, ' ').trim();
    for (const el of Array.from(document.querySelectorAll('button, div[role="button"]')).filter(visible)) {
      const text = textOf(el);
      if (/turn off captions|вимкнути субтитри|выключить субтитры/i.test(text)) {
        try { el.click(); clicked.push(text); } catch {}
      }
    }
    return clicked;
  }).catch(error => [`ERROR:${String(error)}`]);
  if (result.length) await sleep(500);
  log('Meet captions off check', label, JSON.stringify(result));
}

export async function cleanupMeetUi(page, label = 'cleanup') {
  const result = await page.evaluate(() => {
    const clicked = [];
    const hidden = [];
    const visible = el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const textOf = el => `${el.innerText || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.replace(/\s+/g, ' ').trim();
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(visible);
    for (const el of buttons) {
      const text = textOf(el);
      const parent = textOf(el.closest('[role="dialog"], [role="alert"], [aria-live], div') || el);
      const isClose = /^(close|dismiss|got it|закрити|зрозуміло)$/i.test(text) || /close$/i.test(text);
      const relevant = /camera|microphone|mic|browser|automation|not found|error|warning|камера|мікрофон|браузер|помилка/i.test(parent + ' ' + text);
      if (isClose && relevant) {
        try { el.click(); clicked.push(text || 'close'); } catch {}
      }
    }
    for (const el of Array.from(document.querySelectorAll('[role="alert"], [aria-live], .infobar, .notification'))) {
      const text = textOf(el);
      if (/camera|microphone|mic|browser|automation|not found|error|warning|камера|мікрофон|браузер|помилка/i.test(text)) {
        try { el.style.display = 'none'; hidden.push(text.slice(0, 80)); } catch {}
      }
    }
    return { clicked, hidden };
  }).catch(error => ({ error: String(error) }));
  await ensureCaptionsOff(page, `${label}:captions`).catch(() => null);
  await closeMeetSidePanels(page, `${label}:side-panels`).catch(() => null);
  await page.keyboard.press('Escape').catch(() => null);
  await page.mouse.move(1279, 1).catch(() => null);
  await sleep(1200);
  log('Meet UI cleanup', label, JSON.stringify(result));
}

export async function notifyRecordingStart(page, cfg) {
  if (cfg.sendChatOnRecordingStart !== false) {
    await sendChatMessage(page, cfg.recordingStartMessage || 'Запис зустрічі розпочато!').catch(error => log('Start chat failed:', String(error)));
  }
  if (cfg.playStartBeep !== false) {
    await setMicEnabled(page, true).catch(() => null);
    await sleep(300);
    playBeep(cfg);
    await sleep(300);
    if (cfg.muteMicAfterBeep !== false) await setMicEnabled(page, false).catch(() => null);
  }
}

export async function notifyRecordingStop(page, cfg) {
  if (cfg.sendChatOnRecordingStop) {
    await sendChatMessage(page, cfg.recordingStopMessage || 'Запис зустрічі закінчено!').catch(error => log('Stop chat failed:', String(error)));
  }
}

export async function prepareMeet(page, botName, joinWaitMs = 600000) {
  await sleep(9000);
  await pageDebug(page, 'before-join');
  const fill = await fillGuestName(page, botName);
  log('Guest name fill:', JSON.stringify(fill));
  await sleep(1000);
  await pageDebug(page, 'after-name');
  const mic = await clickButtonByText(page, ['turn off microphone', 'вимкнути мікрофон', 'отключить микрофон'], 2500).catch(() => null);
  if (mic) log('Mic toggle:', mic);
  const cam = await clickButtonByText(page, ['turn off camera', 'вимкнути камеру', 'отключить камеру'], 2500).catch(() => null);
  if (cam) log('Camera toggle:', cam);
  const clicked = await clickButtonByText(page, [
    '^\\s*join now\\s*$', 'join now',
    '^\\s*ask to join\\s*$', 'ask to join',
    '^\\s*join meeting\\s*$', 'join meeting',
    '^\\s*join\\s*$',
    'приєднатися зараз', 'приєднатися', 'долучитися', 'попросити приєднатися',
    'присоединиться сейчас', 'присоединиться', 'просить присоединиться'
  ], 60000);
  log('Join/Ask button:', clicked || 'not found');
  if (!clicked) {
    await pageDebug(page, 'join-button-not-found');
    return { ok: false, reason: 'join-button-not-found' };
  }
  const joined = await waitUntilJoined(page, joinWaitMs, 3000);
  if (!joined.ok) {
    log('Join failed:', JSON.stringify(joined));
    await pageDebug(page, 'join-failed');
    return joined;
  }
  await page.keyboard.press('F11').catch(() => {});
  await page.evaluate(() => document.documentElement.requestFullscreen?.().catch?.(() => {})).catch(() => {});
  await sleep(1000);
  await cleanupMeetUi(page, 'after-join-before-debug');
  await pageDebug(page, 'after-join-click');
  return { ok: true, clicked, joined };
}

export async function isInMeeting(page) {
  return await page.evaluate(() => {
    const body = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const labels = Array.from(document.querySelectorAll('button, div[role="button"], [aria-label]')).map(el => {
      return `${el.innerText || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.replace(/\s+/g, ' ').trim();
    }).join(' | ');
    const hay = `${body} | ${labels}`;
    const waiting = /Please wait until a meeting host brings you into the call|Asking to join|You'll join when someone lets you in|Waiting to be admitted|Попросити приєднатися|Очікування|Просить присоединиться|Ожидание/i.test(hay);
    const rejected = /You can't join this video call|You were denied|denied your request|not allowed to join|can't join|Ви не можете приєднатися|відхилено|нельзя присоединиться|запрос отклонен/i.test(hay);
    const joinedSignals = /Meeting details|Chat with everyone|Meeting tools|You have joined the call|This call is open to anyone|Деталі зустрічі|Чат з усіма|Інструменти зустрічі|Сведения о встрече|Чат со всеми/i.test(hay);
    const joined = !waiting && !rejected && joinedSignals;
    return { joined, rejected, waiting, body: body.slice(0, 900) };
  }).catch(error => ({ joined: false, rejected: false, waiting: false, error: String(error) }));
}

export async function waitUntilJoined(page, timeoutMs = 600000, checkMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const state = await isInMeeting(page);
    log('Join state:', JSON.stringify(state));
    if (state.joined) return { ok: true, state };
    if (state.rejected) return { ok: false, reason: 'rejected-or-not-allowed', state };
    await sleep(checkMs);
  }
  const state = await isInMeeting(page);
  return { ok: false, reason: 'join-timeout', state };
}

export async function getParticipantCount(page) {
  return await page.evaluate(() => {
    const visible = el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const items = Array.from(document.querySelectorAll('button, div[role="button"], [aria-label]')).filter(visible).map(el => {
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      const aria = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      const title = (el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
      const label = `${text} ${aria} ${title}`.trim();
      const rect = el.getBoundingClientRect();
      return { text, aria, title, label, x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    });
    const numericButtons = items
      .filter(item => /^\d{1,3}$/.test(item.text) && item.w > 10 && item.h > 10)
      .map(item => ({ n: Number(item.text), item }));
    if (numericButtons.length) {
      numericButtons.sort((a, b) => (a.item.y - b.item.y) || (a.n - b.n));
      return numericButtons[0].n;
    }
    const patterns = [
      /(\d{1,3})\s+(?:people|participants?|учасник|учасники|учасників|участник|участника|участников)/i,
      /(?:people|participants?|учасник|учасники|учасників|участник|участника|участников).*?(\d{1,3})/i,
      /\((\d{1,3})\)/
    ];
    for (const item of items) {
      for (const pattern of patterns) {
        const match = item.label.match(pattern);
        if (match) return Number(match[1]);
      }
    }
    const body = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const match = body.match(/Meeting details\s+(\d{1,3})\s+Press Down Arrow/i);
    if (match) return Number(match[1]);
    return null;
  }).catch(() => null);
}

export async function waitForStopCondition(page, durationMs, minParticipants = 2, belowMs = 30000, checkMs = 5000) {
  const started = Date.now();
  let belowSince = null;
  while (Date.now() - started < durationMs) {
    const count = await getParticipantCount(page);
    log('Participant count:', count === null ? 'unknown' : String(count));
    if (typeof count === 'number' && count < minParticipants) {
      if (!belowSince) belowSince = Date.now();
      const belowFor = Date.now() - belowSince;
      log(`Participant count below ${minParticipants} for ${Math.round(belowFor / 1000)}s`);
      if (belowFor >= belowMs) {
        log(`Auto-stop: participant count < ${minParticipants} for ${Math.round(belowMs / 1000)}s`);
        return 'participants-below-threshold';
      }
    } else {
      belowSince = null;
    }
    const left = durationMs - (Date.now() - started);
    await sleep(Math.min(checkMs, Math.max(0, left)));
  }
  return 'duration-ended';
}
