import path from 'node:path';
import { APP_DIR, log } from '../../runtime/common.js';

export async function pageDebug(page, label) {
  const data = await page.evaluate(() => ({
    href: location.href,
    title: document.title,
    body: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1800),
    buttons: Array.from(document.querySelectorAll('button, div[role="button"]')).map(el => ({
      text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      aria: el.getAttribute('aria-label') || '',
      title: el.getAttribute('title') || ''
    })).filter(x => x.text || x.aria || x.title).slice(0, 60),
    inputs: Array.from(document.querySelectorAll('input, textarea')).map(el => ({
      tag: el.tagName,
      type: el.type || '',
      value: el.value || '',
      placeholder: el.placeholder || '',
      aria: el.getAttribute('aria-label') || '',
      maxLength: el.maxLength || null
    })).slice(0, 20)
  })).catch(error => ({ error: String(error) }));
  log(`PAGE_DEBUG_${label}`, JSON.stringify(data));
  await page.screenshot({ path: path.join(APP_DIR, 'logs', `${label}.png`), fullPage: false }).catch(() => {});
}
