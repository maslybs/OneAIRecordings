import fs from 'node:fs';
import path from 'node:path';

export function createLogger({ logsDir = './logs', name = 'bot' } = {}) {
  fs.mkdirSync(logsDir, { recursive: true });
  const file = path.join(logsDir, `${name}.log`);

  const write = (level, args) => {
    const line = `[${new Date().toISOString()}] ${level} ${args.map(format).join(' ')}`;
    console.log(line);
    fs.appendFileSync(file, line + '\n');
  };

  return {
    file,
    info: (...args) => write('INFO', args),
    warn: (...args) => write('WARN', args),
    error: (...args) => write('ERROR', args)
  };
}

function format(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
