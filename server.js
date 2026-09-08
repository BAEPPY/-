// 끝말잇기 게임 서버: 정적 파일 제공 + 우리말샘 검증 API 프록시
// 외부 패키지 없이 Node 내장 모듈만 사용한다. (Node 18+)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { getConfig } from './lib/config.js';
import { OpenDictClient, MockDictClient, OpenDictError } from './lib/opendict.js';
import { evaluateWord, REASON_MESSAGES } from './lib/rules.js';
import { allowedStarts, lastSyllable, isHangulWord, euro } from './lib/hangul.js';
import { pickBotWord } from './lib/bot.js';

const config = getConfig();
const PUBLIC_DIR = path.join(config.root, 'public');
const LIB_DIR = path.join(config.root, 'lib');

const client = config.mock
  ? new MockDictClient(path.join(config.root, 'test', 'fixtures', 'mock-dict.json'))
  : new OpenDictClient({ apiKey: config.apiKey, extraParams: config.extraParams });

if (config.mock && !config.apiKey && !/^(1|true|yes|on)$/i.test(process.env.MOCK_DICT ?? '')) {
  console.warn('[경고] OPENDICT_API_KEY 가 설정되지 않아 모의 사전(mock)으로 실행합니다. .env 파일을 확인하세요.');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendError(res, err) {
  if (err instanceof OpenDictError) {
    return sendJson(res, err.status, { ok: false, error: err.message, code: err.code });
  }
  console.error(err);
  return sendJson(res, 500, { ok: false, error: '서버 내부 오류가 발생했어요.' });
}

function serveStatic(res, baseDir, rel) {
  const file = path.normalize(path.join(baseDir, rel));
  if (!file.startsWith(baseDir)) return notFound(res);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

// ---- API 처리 ------------------------------------------------------------

async function handleValidate(url, res) {
  const word = (url.searchParams.get('word') ?? '').trim();
  const used = new Set((url.searchParams.get('used') ?? '').split(',').filter(Boolean));
  const startsParam = (url.searchParams.get('starts') ?? '').split(',').filter(Boolean);

  // 사전을 찾기 전에 가벼운 게임 규칙부터 검사한다.
  if (!isHangulWord(word)) return sendJson(res, 200, { ok: false, word, reason: 'not_hangul', message: REASON_MESSAGES.not_hangul });
  if (word.length < config.rules.minLength) return sendJson(res, 200, { ok: false, word, reason: 'too_short', message: REASON_MESSAGES.too_short });
  if (startsParam.length && !startsParam.some((s) => word.startsWith(s))) {
    return sendJson(res, 200, { ok: false, word, reason: 'chain', message: `'${startsParam.join("' 또는 '")}'${euro(startsParam[0])} 시작해야 해요.` });
  }
  if (used.has(word)) return sendJson(res, 200, { ok: false, word, reason: 'used', message: REASON_MESSAGES.used });

  const result = await client.search({ q: word, method: 'exact', num: 100 });
  const verdict = evaluateWord(word, result.items, config.rules);
  if (verdict.ok) {
    verdict.nextStarts = allowedStarts(lastSyllable(word), { dueum: config.dueum });
  }
  return sendJson(res, 200, verdict);
}

async function handleBot(url, res) {
  const starts = (url.searchParams.get('starts') ?? '').split(',').filter((s) => isHangulWord(s));
  if (starts.length === 0) return sendJson(res, 400, { ok: false, error: 'starts 파라미터가 필요해요.' });
  const used = new Set((url.searchParams.get('used') ?? '').split(',').filter(Boolean));
  const level = url.searchParams.get('level') ?? 'normal';
  const entry = await pickBotWord(client, { starts, used, rules: config.rules, level });
  if (!entry) return sendJson(res, 200, { ok: false, reason: 'no_word', message: '이어갈 단어를 찾지 못했어요.' });
  return sendJson(res, 200, { ok: true, word: entry.word, entry, nextStarts: allowedStarts(lastSyllable(entry.word), { dueum: config.dueum }) });
}

async function handleRaw(url, res) {
  if (!config.debug) return notFound(res);
  const q = (url.searchParams.get('word') ?? url.searchParams.get('q') ?? '').trim();
  if (!q) return sendJson(res, 400, { ok: false, error: 'word 파라미터가 필요해요.' });
  const method = url.searchParams.get('method') ?? 'exact';
  const raw = await client.raw({ q, method, num: Number(url.searchParams.get('num')) || 20, start: Number(url.searchParams.get('start')) || 1 });
  return sendJson(res, 200, raw);
}

function handleConfig(res) {
  return sendJson(res, 200, {
    ok: true,
    dictionary: client.name,
    mock: config.mock,
    dueum: config.dueum,
    rules: config.rules,
  });
}

// ---- 라우팅 ---------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405); return res.end();
    }
    if (p === '/api/validate') return await handleValidate(url, res);
    if (p === '/api/bot') return await handleBot(url, res);
    if (p === '/api/raw') return await handleRaw(url, res);
    if (p === '/api/config') return handleConfig(res);
    if (p.startsWith('/api/')) return notFound(res);
    if (p === '/shared/hangul.js') return serveStatic(res, LIB_DIR, 'hangul.js');
    return serveStatic(res, PUBLIC_DIR, p === '/' ? 'index.html' : decodeURIComponent(p));
  } catch (err) {
    return sendError(res, err);
  }
});

server.listen(config.port, () => {
  console.log(`끝말잇기 서버 실행 중: http://localhost:${config.port}  (사전: ${client.name}${config.debug ? ', DEBUG' : ''})`);
});
