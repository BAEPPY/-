// 끝말잇기 게임 서버: 정적 파일 + 우리말샘 검증 API 프록시 + 게임 방(실시간, SSE)
// 외부 패키지 없이 Node 내장 모듈만 사용한다. (Node 18+)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { getConfig } from './lib/config.js';
import { OpenDictClient, MockDictClient, OpenDictError } from './lib/opendict.js';
import { evaluateWord, REASON_MESSAGES, RULE_OPTIONS, DEFAULT_RULES } from './lib/rules.js';
import { allowedStarts, lastSyllable, isHangulWord, euro } from './lib/hangul.js';
import { pickBotWord } from './lib/bot.js';
import { EnglishDict } from './lib/english.js';
import { describeModes } from './lib/modes.js';
import { RoomManager, RoomError, LIMITS } from './lib/room.js';

const config = getConfig();
const PUBLIC_DIR = path.join(config.root, 'public');
const LIB_DIR = path.join(config.root, 'lib');

const client = config.mock
  ? new MockDictClient(path.join(config.root, 'test', 'fixtures', 'mock-dict.json'))
  : new OpenDictClient({ apiKey: config.apiKey, extraParams: config.extraParams });

if (config.mock && !config.apiKey && !/^(1|true|yes|on)$/i.test(process.env.MOCK_DICT ?? '')) {
  console.warn('[경고] OPENDICT_API_KEY 가 설정되지 않아 모의 사전(mock)으로 실행합니다. .env 파일을 확인하세요.');
}

// 영어 사전은 비동기로 준비한다 (없으면 영어 모드만 비활성화)
const englishHolder = { ready: false, size: 0, has: () => false, pick: () => null };
const english = new Proxy(englishHolder, { get: (t, k) => (t.dict ? t.dict[k] : t[k]) });
EnglishDict.load({ file: config.english.file, url: config.english.url, download: config.english.download }).then((d) => { englishHolder.dict = d; });

const rooms = new RoomManager({ client, english });

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
  if (err instanceof OpenDictError || err instanceof RoomError) {
    return sendJson(res, err.status, { ok: false, error: err.message, code: err.code ?? null });
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

function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new RoomError('요청이 너무 커요.', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new RoomError('JSON 본문이 잘못됐어요.')); }
    });
    req.on('error', reject);
  });
}

const cid = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(v) ? v : null);

// ---- 단일 API (방 없이 쓰는 검증·컴퓨터) ----------------------------------

async function handleValidate(url, res) {
  const word = (url.searchParams.get('word') ?? '').trim();
  const used = new Set((url.searchParams.get('used') ?? '').split(',').filter(Boolean));
  const startsParam = (url.searchParams.get('starts') ?? '').split(',').filter(Boolean);

  if (!isHangulWord(word)) return sendJson(res, 200, { ok: false, word, reason: 'not_hangul', message: REASON_MESSAGES.not_hangul });
  if (word.length < config.rules.minLength) return sendJson(res, 200, { ok: false, word, reason: 'too_short', message: REASON_MESSAGES.too_short });
  if (startsParam.length && !startsParam.some((s) => word.startsWith(s))) {
    return sendJson(res, 200, { ok: false, word, reason: 'chain', message: `'${startsParam.join("' 또는 '")}'${euro(startsParam[0])} 시작해야 해요.` });
  }
  if (used.has(word)) return sendJson(res, 200, { ok: false, word, reason: 'used', message: REASON_MESSAGES.used });

  const result = await client.search({ q: word, method: 'exact', num: 100 });
  const verdict = evaluateWord(word, result.items, config.rules);
  if (verdict.ok) verdict.nextStarts = allowedStarts(lastSyllable(word), { dueum: config.dueum });
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
    defaultRules: DEFAULT_RULES,
    ruleOptions: RULE_OPTIONS,
    modes: describeModes({ englishReady: english.ready }),
    english: { ready: english.ready, size: english.size },
    limits: LIMITS,
  });
}

// ---- 게임 방 API ----------------------------------------------------------

async function handleRooms(req, url, res) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api','rooms',id?,action?]
  const id = parts[2];
  const action = parts[3];

  if (!id) {
    if (req.method === 'GET') return sendJson(res, 200, { ok: true, rooms: rooms.list() });
    if (req.method === 'POST') {
      const body = await readJson(req);
      const clientId = cid(body.clientId);
      if (!clientId) throw new RoomError('clientId 가 필요해요.');
      const room = rooms.create({ name: body.roomName, mode: body.mode, settings: body.settings, hostClientId: clientId });
      const player = room.join({ clientId, name: body.name });
      return sendJson(res, 201, { ok: true, roomId: room.id, playerId: player.id, room: room.snapshot(clientId) });
    }
    res.writeHead(405); return res.end();
  }

  const room = rooms.get(id);

  if (action === 'events') {
    const clientId = cid(url.searchParams.get('clientId'));
    if (!clientId) throw new RoomError('clientId 가 필요해요.');
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
    room.subscribe(clientId, res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* ignore */ } }, 20000);
    req.on('close', () => { clearInterval(ping); room.unsubscribe(clientId, res); });
    return undefined;
  }

  if (req.method === 'GET' && !action) {
    return sendJson(res, 200, { ok: true, room: room.snapshot(cid(url.searchParams.get('clientId'))) });
  }
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }

  const body = await readJson(req);
  const clientId = cid(body.clientId);
  if (!clientId) throw new RoomError('clientId 가 필요해요.');

  switch (action) {
    case 'join': {
      const player = room.join({ clientId, name: body.name });
      return sendJson(res, 200, { ok: true, roomId: room.id, playerId: player.id, room: room.snapshot(clientId) });
    }
    case 'leave':
      if (body.playerId) room.removePlayer(String(body.playerId), clientId);
      else for (const p of room.playersOf(clientId)) room.removePlayer(p.id, clientId);
      return sendJson(res, 200, { ok: true });
    case 'bot': {
      const player = room.addBot(clientId, body.level);
      return sendJson(res, 200, { ok: true, playerId: player.id });
    }
    case 'settings':
      room.updateSettings(clientId, body);
      return sendJson(res, 200, { ok: true, room: room.snapshot(clientId) });
    case 'start':
      await room.start(clientId);
      return sendJson(res, 200, { ok: true });
    case 'next':
      await room.next(clientId);
      return sendJson(res, 200, { ok: true });
    case 'word': {
      const result = await room.submit({ clientId, playerId: body.playerId ? String(body.playerId) : null, word: body.word });
      return sendJson(res, 200, result);
    }
    case 'chat':
      room.chat(clientId, body.text);
      return sendJson(res, 200, { ok: true });
    default:
      return notFound(res);
  }
}

// ---- 라우팅 ---------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p.startsWith('/api/rooms')) return await handleRooms(req, url, res);
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

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { rooms.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1000).unref(); });
}
