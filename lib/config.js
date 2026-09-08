import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** .env 파일을 읽어 process.env 에 없는 값만 채운다. (외부 의존성 없이 처리) */
export function loadDotenv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[2].replace(/\s+#.*$/, '');
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const truthy = (v, def) => (v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(v));

export function getConfig() {
  loadDotenv();
  const env = process.env;
  const key = (env.OPENDICT_API_KEY ?? '').trim();
  const looksLikeKey = /^[0-9A-Fa-f]{16,}$/.test(key);
  return {
    root: ROOT,
    port: Number(env.PORT) || 3000,
    apiKey: looksLikeKey ? key : '',
    mock: truthy(env.MOCK_DICT, false) || !looksLikeKey,
    debug: truthy(env.DEBUG, false),
    extraParams: (env.OPENDICT_EXTRA_PARAMS ?? '').trim(),
    rules: {
      minLength: 2,
      allowLoanwords: truthy(env.ALLOW_LOANWORDS, false),
      allowCompound: truthy(env.ALLOW_COMPOUND, false),
    },
    dueum: truthy(env.ALLOW_DUEUM, true),
  };
}
