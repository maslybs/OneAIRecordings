// Cloudflare Worker gateway for panel -> recorder API.
// Set these as Worker secrets/vars in Cloudflare, do not commit real values:
// PANEL_PASSWORD, SESSION_SECRET, BOT_API_BASE, BOT_API_KEY, ALLOWED_ORIGINS.

function getEnv(name) {
  if (typeof globalThis[name] === 'string') return globalThis[name];
  throw new Error(`Missing Worker setting: ${name}`);
}

function cors(request) {
  const origin = request.headers.get('origin') || '';
  const allowedOrigins = new Set((globalThis.ALLOWED_ORIGINS || '').split(',').map(item => item.trim()).filter(Boolean));
  const allowOrigin = allowedOrigins.has(origin) ? origin : [...allowedOrigins][0] || origin;
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin'
  };
}

function jsonResp(request, data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...cors(request),
      ...extra
    }
  });
}

function parseCookies(request) {
  const cookie = request.headers.get('cookie') || '';
  return Object.fromEntries(cookie
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const i = part.indexOf('=');
      return i >= 0 ? [part.slice(0, i), decodeURIComponent(part.slice(i + 1))] : [part, ''];
    }));
}

async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function validSession(request) {
  const sessionSecret = getEnv('SESSION_SECRET');
  const session = parseCookies(request).mrb_session || '';
  if (!session.includes('.')) return false;
  const [ts, sig] = session.split('.', 2);
  const age = Date.now() - Number(ts || 0);
  if (!Number.isFinite(age) || age < 0 || age > 12 * 60 * 60 * 1000) return false;
  return sig === await sha256Hex(`${ts}:${sessionSecret}`);
}

async function sessionCookie() {
  const sessionSecret = getEnv('SESSION_SECRET');
  const ts = String(Date.now());
  const sig = await sha256Hex(`${ts}:${sessionSecret}`);
  return `mrb_session=${encodeURIComponent(`${ts}.${sig}`)}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=43200`;
}

async function proxy(request, path) {
  const init = {
    method: request.method,
    headers: {
      'x-bot-api-key': getEnv('BOT_API_KEY'),
      'content-type': request.headers.get('content-type') || 'application/json'
    }
  };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.text();
  const upstream = await fetch(getEnv('BOT_API_BASE') + path, init);
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
      ...cors(request)
    }
  });
}

addEventListener('fetch', event => {
  event.respondWith(handle(event.request));
});

async function handle(request) {
  if (request.method === 'OPTIONS') return new Response('', { status: 204, headers: cors(request) });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '') || '/';

  if (request.method === 'POST' && path === '/login') {
    let body = {};
    try { body = await request.json(); } catch {}
    if (body.password !== getEnv('PANEL_PASSWORD')) return jsonResp(request, { ok: false, error: 'Wrong password' }, 401);
    return jsonResp(request, { ok: true }, 200, { 'set-cookie': await sessionCookie() });
  }

  if (request.method === 'POST' && path === '/logout') {
    return jsonResp(request, { ok: true }, 200, {
      'set-cookie': 'mrb_session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0'
    });
  }

  if (!(await validSession(request))) return jsonResp(request, { ok: false, error: 'Unauthorized' }, 401);
  if (path === '/me') return jsonResp(request, { ok: true });
  return proxy(request, path);
}
