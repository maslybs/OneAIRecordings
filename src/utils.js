export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function safeName(value, fallback = 'recording') {
  return String(value || fallback)
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}._ -]+/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120) || fallback;
}

export function fileTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function randomDigits(length = 3) {
  return String(Math.floor(Math.random() * 10 ** length)).padStart(length, '0');
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) out._.push(arg);
    else {
      const [key, inline] = arg.slice(2).split('=');
      out[key] = inline ?? argv[++i] ?? true;
    }
  }
  return out;
}
