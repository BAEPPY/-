// 게임 방: 플레이어·설정·진행 상태를 서버에서 관리하고, 변경이 있을 때마다 접속한 클라이언트(SSE)에 알린다.
// 컴퓨터와 대전, 한 화면에서 번갈아(로컬 좌석 여러 개), 온라인 대전이 모두 같은 방 구조로 돌아간다.

import crypto from 'node:crypto';
import { getMode, publicPrompt } from './modes.js';
import { sanitizeRules, DEFAULT_RULES } from './rules.js';

export const LIMITS = Object.freeze({
  turnSec: [5, 120], rounds: [1, 10], maxPlayers: [1, 8], quizCount: [3, 30], countdownSec: [0, 10], seatsPerClient: 4, nameLen: 12, roomNameLen: 24,
});
const ROUND_END_AUTO_MS = 8000;
const LOBBY_DISCONNECT_GRACE_MS = 6000;
const IDLE_ROOM_MS = 30 * 60 * 1000;

const clamp = (v, [lo, hi], def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : def;
};
// eslint-disable-next-line no-control-regex
const cleanName = (s, max) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

export class RoomError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function sanitizeSettings(input = {}, base = {}) {
  const s = { ...base };
  if (input.turnSec != null) s.turnSec = clamp(input.turnSec, LIMITS.turnSec, base.turnSec ?? 15);
  if (input.rounds != null) s.rounds = clamp(input.rounds, LIMITS.rounds, base.rounds ?? 3);
  if (input.maxPlayers != null) s.maxPlayers = clamp(input.maxPlayers, LIMITS.maxPlayers, base.maxPlayers ?? 4);
  if (input.quizCount != null) s.quizCount = clamp(input.quizCount, LIMITS.quizCount, base.quizCount ?? 10);
  if (input.countdownSec != null) s.countdownSec = clamp(input.countdownSec, LIMITS.countdownSec, base.countdownSec ?? 3);
  if (input.level != null) s.level = ['easy', 'normal', 'hard'].includes(input.level) ? input.level : (base.level ?? 'normal');
  if (input.dueum != null) s.dueum = Boolean(input.dueum);
  if (input.isPublic != null) s.isPublic = Boolean(input.isPublic);
  if (input.rules != null) s.rules = sanitizeRules({ ...(base.rules ?? DEFAULT_RULES), ...input.rules });
  return s;
}

export class Room {
  /**
   * @param {object} o
   * @param {string} o.hostClientId
   * @param {object} o.deps   { client, english, rng, now, log }
   */
  constructor({ id, name, mode, settings = {}, hostClientId, deps }) {
    this.id = id;
    this.name = cleanName(name, LIMITS.roomNameLen) || '끝말잇기 방';
    this.modeId = getMode(mode) ? mode : 'kkm';
    this.settings = sanitizeSettings(settings, {
      turnSec: 15, rounds: 3, maxPlayers: 4, quizCount: 10, countdownSec: 3, level: 'normal', dueum: true, isPublic: true, rules: { ...DEFAULT_RULES },
    });
    this.hostClientId = hostClientId;
    this.deps = deps;
    this.players = [];
    this.state = 'lobby'; // lobby | playing | roundEnd | finished
    this.round = 0;
    this.turn = 0;
    this.prompt = null;
    this.deadline = 0;
    this.history = [];
    this.used = new Set();
    this.roundResult = null;
    this.quiz = null; // 초성 퀴즈: { index, count }
    this.token = 0;
    this.busy = false;
    this.prefetched = null;
    this.timer = null;
    this.botTimer = null;
    this.subscribers = new Map(); // clientId -> Set<res>
    this.graceTimers = new Map();
    this.createdAt = deps.now();
    this.lastActive = this.createdAt;
    this.chatLog = [];
    this.onEmpty = null;
  }

  get mode() { return getMode(this.modeId); }
  get now() { return this.deps.now(); }
  get rng() { return this.deps.rng; }

  // ───────────────────────── 플레이어 ─────────────────────────

  isHost(clientId) { return clientId === this.hostClientId; }

  playersOf(clientId) { return this.players.filter((p) => p.clientId === clientId); }

  join({ clientId, name }) {
    if (!clientId) throw new RoomError('clientId 가 필요해요.');
    if (this.state !== 'lobby') throw new RoomError('게임이 진행 중인 방에는 들어갈 수 없어요. 끝날 때까지 기다려 주세요.');
    if (this.players.filter((p) => !p.isBot).length >= this.settings.maxPlayers) throw new RoomError('방이 가득 찼어요.');
    if (this.playersOf(clientId).length >= LIMITS.seatsPerClient) throw new RoomError(`한 접속에서 ${LIMITS.seatsPerClient}명까지만 참가할 수 있어요.`);
    let nm = cleanName(name, LIMITS.nameLen) || '플레이어';
    const names = new Set(this.players.map((p) => p.name));
    const base = nm;
    let i = 2;
    while (names.has(nm)) nm = `${base}${i++}`;
    const player = { id: newId(6), name: nm, clientId, isBot: false, score: 0, wins: 0, words: 0, connected: this.subscribers.has(clientId) };
    this.players.push(player);
    this.touch();
    this.broadcastState();
    return player;
  }

  addBot(clientId, level) {
    this.requireHost(clientId);
    if (this.state !== 'lobby') throw new RoomError('대기 중일 때만 컴퓨터를 추가할 수 있어요.');
    if (!this.mode.hasBot) throw new RoomError('이 모드에서는 컴퓨터가 참가할 수 없어요.');
    if (this.players.length >= LIMITS.maxPlayers[1]) throw new RoomError('더 추가할 수 없어요.');
    const n = this.players.filter((p) => p.isBot).length + 1;
    const lv = ['easy', 'normal', 'hard'].includes(level) ? level : this.settings.level;
    const player = { id: newId(6), name: n === 1 ? '컴퓨터' : `컴퓨터${n}`, clientId: null, isBot: true, level: lv, score: 0, wins: 0, words: 0, connected: true };
    this.players.push(player);
    this.touch();
    this.broadcastState();
    return player;
  }

  removePlayer(playerId, byClientId) {
    const idx = this.players.findIndex((p) => p.id === playerId);
    if (idx < 0) return;
    const p = this.players[idx];
    if (p.clientId !== byClientId && !this.isHost(byClientId)) throw new RoomError('다른 사람을 내보낼 수 없어요.', 403);
    this.players.splice(idx, 1);
    if (this.state === 'countdown' && this.players.length < (this.mode.turnBased ? 2 : 1)) {
      this.clearTimers(); this.state = 'lobby'; this.deadline = 0;
    }
    if (this.state === 'playing' || this.state === 'roundEnd') {
      if (this.players.filter((x) => !x.isBot).length === 0) this.finish('모두 나갔어요');
      else if (this.state === 'playing' && this.mode.turnBased) {
        if (this.players.length < 2) this.endRound(null, '상대가 나가서 라운드를 마쳐요');
        else {
          if (idx < this.turn) this.turn -= 1;
          else if (idx === this.turn) { this.turn %= this.players.length; this.startTurn(); }
        }
      }
    }
    if (p.clientId === this.hostClientId && this.playersOf(p.clientId).length === 0) this.transferHost();
    this.touch();
    this.broadcastState();
    this.checkEmpty();
  }

  transferHost() {
    const next = this.players.find((p) => !p.isBot && p.connected) ?? this.players.find((p) => !p.isBot);
    if (next) this.hostClientId = next.clientId;
  }

  requireHost(clientId) {
    if (!this.isHost(clientId)) throw new RoomError('방장만 할 수 있어요.', 403);
  }

  updateSettings(clientId, patch = {}) {
    this.requireHost(clientId);
    if (this.state !== 'lobby') throw new RoomError('대기 중일 때만 설정을 바꿀 수 있어요.');
    if (patch.mode && getMode(patch.mode)) {
      if (getMode(patch.mode).lang === 'en' && !this.deps.english?.ready) throw new RoomError('영어 사전이 준비되지 않아 영어 모드를 쓸 수 없어요.');
      this.modeId = patch.mode;
      if (!this.mode.hasBot) this.players = this.players.filter((p) => !p.isBot);
    }
    if (patch.name != null) this.name = cleanName(patch.name, LIMITS.roomNameLen) || this.name;
    this.settings = sanitizeSettings(patch, this.settings);
    this.touch();
    this.broadcastState();
  }

  // ───────────────────────── 접속(SSE) ─────────────────────────

  subscribe(clientId, res) {
    if (!this.subscribers.has(clientId)) this.subscribers.set(clientId, new Set());
    this.subscribers.get(clientId).add(res);
    const g = this.graceTimers.get(clientId);
    if (g) { clearTimeout(g); this.graceTimers.delete(clientId); }
    for (const p of this.playersOf(clientId)) p.connected = true;
    this.broadcastState();
  }

  unsubscribe(clientId, res) {
    const set = this.subscribers.get(clientId);
    if (!set) return;
    set.delete(res);
    if (set.size > 0) return;
    this.subscribers.delete(clientId);
    for (const p of this.playersOf(clientId)) p.connected = false;
    // 새로고침 등 잠깐 끊긴 경우를 위해 잠시 기다렸다가 대기실 좌석을 정리한다.
    const t = setTimeout(() => {
      this.graceTimers.delete(clientId);
      if (this.subscribers.has(clientId)) return;
      if (this.state === 'lobby' || this.state === 'finished') {
        this.players = this.players.filter((p) => p.clientId !== clientId);
        if (this.isHost(clientId)) this.transferHost();
      }
      this.broadcastState();
      this.checkEmpty();
    }, LOBBY_DISCONNECT_GRACE_MS);
    this.graceTimers.set(clientId, t);
    this.broadcastState();
  }

  checkEmpty() {
    const humans = this.players.filter((p) => !p.isBot);
    if (humans.length === 0 && this.subscribers.size === 0) this.destroy();
  }

  send(res, event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* 끊긴 연결 */ }
  }

  broadcast(event, data, { only = null } = {}) {
    for (const [clientId, set] of this.subscribers) {
      if (only && clientId !== only) continue;
      for (const res of set) this.send(res, event, data);
    }
  }

  broadcastState() {
    for (const [clientId, set] of this.subscribers) {
      const snap = this.snapshot(clientId);
      for (const res of set) this.send(res, 'state', snap);
    }
  }

  snapshot(clientId = null) {
    const hostPlayer = this.players.find((p) => p.clientId != null && p.clientId === this.hostClientId) ?? null;
    return {
      id: this.id, name: this.name, mode: this.modeId, settings: this.settings, state: this.state,
      hostClientId: this.hostClientId, isHost: clientId != null && this.isHost(clientId),
      round: this.round, turnPlayerId: this.mode.turnBased && this.state === 'playing' ? this.players[this.turn]?.id ?? null : null,
      prompt: publicPrompt(this.prompt), deadline: this.deadline, serverNow: this.now,
      players: this.players.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot, level: p.level, score: p.score, wins: p.wins, words: p.words, connected: p.connected, mine: p.clientId != null && p.clientId === clientId, isHost: p === hostPlayer })),
      history: this.history.slice(-60), roundResult: this.roundResult, quiz: this.quiz,
      chat: this.chatLog.slice(-30),
    };
  }

  summary() {
    return {
      id: this.id, name: this.name, mode: this.modeId, state: this.state, isPublic: this.settings.isPublic,
      players: this.players.filter((p) => !p.isBot).length, bots: this.players.filter((p) => p.isBot).length, maxPlayers: this.settings.maxPlayers,
      turnSec: this.settings.turnSec, rounds: this.settings.rounds, createdAt: this.createdAt,
    };
  }

  chat(clientId, text) {
    const p = this.playersOf(clientId)[0];
    const t = cleanName(text, 200);
    if (!p || !t) return;
    const msg = { id: newId(4), name: p.name, text: t, at: this.now };
    this.chatLog.push(msg);
    if (this.chatLog.length > 100) this.chatLog.shift();
    this.broadcast('chat', msg);
    this.touch();
  }

  // ───────────────────────── 게임 진행 ─────────────────────────

  ctx(level = this.settings.level) {
    return { client: this.deps.client, english: this.deps.english, rules: this.settings.rules, dueum: this.settings.dueum, used: this.used, rng: this.rng, level };
  }

  async start(clientId) {
    this.requireHost(clientId);
    if (this.state !== 'lobby' && this.state !== 'finished') throw new RoomError('이미 게임이 진행 중이에요.');
    const minPlayers = this.mode.turnBased ? 2 : 1;
    if (this.players.length < minPlayers) throw new RoomError(this.mode.hasBot ? '플레이어가 2명 이상 필요해요. 컴퓨터를 추가하거나 친구를 초대하세요.' : '플레이어가 2명 이상 필요해요.');
    if (this.mode.lang === 'en' && !this.deps.english?.ready) throw new RoomError('영어 사전이 준비되지 않았어요.');
    for (const p of this.players) { p.score = 0; p.wins = 0; p.words = 0; }
    this.round = 0;
    this.roundResult = null;
    this.history = [];
    this.prompt = null;
    const cd = this.settings.countdownSec ?? 0;
    if (cd > 0) {
      // "잠시 후 경기를 시작합니다!" 카운트다운
      this.clearTimers();
      this.token += 1;
      this.state = 'countdown';
      this.deadline = this.now + cd * 1000;
      this.broadcastState();
      await new Promise((resolve) => { this.timer = setTimeout(resolve, cd * 1000); });
      if (this.state !== 'countdown') return;
    }
    this.state = 'playing';
    await this.startRound();
  }

  async startRound() {
    this.clearTimers();
    this.round += 1;
    this.history = [];
    this.used = new Set();
    this.roundResult = null;
    this.state = 'playing';
    this.busy = false;
    this.turn = (this.round - 1) % this.players.length;
    this.quiz = this.mode.turnBased ? null : { index: 0, count: this.settings.quizCount };
    let prompt = null;
    try { prompt = await this.mode.initialPrompt(this.ctx()); } catch (e) { this.deps.log?.error?.(e); }
    if (!prompt) {
      this.finish('문제를 만들지 못했어요 (사전 오류)');
      return;
    }
    this.prompt = prompt;
    if (this.quiz) this.quiz.index = 1;
    this.broadcast('system', { text: `${this.round}라운드 시작!` });
    this.startTurn();
  }

  startTurn() {
    if (this.state !== 'playing') return;
    this.clearTimers();
    this.token += 1;
    this.busy = false;
    const token = this.token;
    this.deadline = this.now + this.settings.turnSec * 1000;
    this.timer = setTimeout(() => this.onTimeout(token), this.settings.turnSec * 1000 + 250);
    if (this.mode.turnBased) {
      const p = this.players[this.turn];
      if (p?.isBot) this.scheduleBot(p, token);
    } else {
      // 초성 퀴즈: 다음 문제를 미리 만들어 둔다 (문제 출제는 사전 검색이 여러 번 필요해 느리다)
      this.prefetched = this.mode.nextPrompt(this.prompt, null, this.ctx()).catch((e) => { this.deps.log?.error?.(e); return null; });
      const bots = this.players.filter((p) => p.isBot);
      if (bots.length) this.scheduleBot(bots[Math.floor(this.rng() * bots.length)], token);
    }
    this.touch();
    this.broadcastState();
  }

  /** 다음 제시어: 턴 모드는 바로 계산, 퀴즈 모드는 미리 만들어 둔 것을 쓴다 */
  async nextPromptAfter(word) {
    if (!this.mode.turnBased && this.prefetched) {
      const p = this.prefetched;
      this.prefetched = null;
      return p;
    }
    return this.mode.nextPrompt(this.prompt, word, this.ctx());
  }

  scheduleBot(bot, token) {
    const T = this.settings.turnSec;
    const range = { easy: [0.35, 0.75], normal: [0.2, 0.5], hard: [0.08, 0.25] }[bot.level ?? this.settings.level] ?? [0.2, 0.5];
    const delay = (range[0] + this.rng() * (range[1] - range[0])) * T * 1000;
    const thinking = this.mode.botWord(this.prompt, this.ctx(bot.level)).catch((e) => { this.deps.log?.warn?.(`[bot] ${e.message}`); return null; });
    this.botTimer = setTimeout(async () => {
      if (token !== this.token || this.state !== 'playing') return;
      const entry = await thinking;
      if (token !== this.token || this.state !== 'playing') return;
      // 초성 퀴즈에서 쉬운 컴퓨터는 가끔 못 맞힌다
      const giveUp = !this.mode.turnBased && bot.level === 'easy' && this.rng() < 0.35;
      if (!entry || giveUp) {
        if (this.mode.turnBased) this.endRound(this.players.indexOf(bot), '이어갈 단어를 찾지 못했어요');
        return;
      }
      this.accept(bot, entry.word, entry, token);
    }, delay);
  }

  async submit({ clientId, playerId, word }) {
    if (this.state !== 'playing') throw new RoomError('지금은 단어를 낼 수 없어요.');
    const player = this.players.find((p) => p.id === playerId) ?? this.playersOf(clientId)[0];
    if (!player || player.clientId !== clientId) throw new RoomError('참가자만 단어를 낼 수 있어요.', 403);
    if (this.mode.turnBased && this.players[this.turn] !== player) throw new RoomError('내 차례가 아니에요.');
    const w = String(word ?? '').trim();
    if (!w) throw new RoomError('단어를 입력하세요.');
    if (this.mode.turnBased && this.busy) throw new RoomError('확인 중이에요. 잠시만요.');
    const token = this.token;
    this.busy = true;
    let result;
    try {
      result = await this.mode.check(w, this.prompt, this.ctx());
    } catch (e) {
      this.busy = false;
      throw new RoomError(`사전 확인에 실패했어요: ${e.message}`, 502);
    }
    if (token !== this.token || this.state !== 'playing') { this.busy = false; return { ok: false, reason: 'late', message: '시간이 지났어요.' }; }
    this.busy = false;
    if (result.ok && this.used.has(result.entry.word)) result = { ok: false, reason: 'used', message: '이미 나온 단어예요.' };
    if (!result.ok) {
      this.broadcast('reject', { playerId: player.id, word: w, reason: result.reason, message: result.message }, { only: clientId });
      return result;
    }
    await this.accept(player, result.entry.word, result.entry, token);
    return { ok: true, entry: result.entry };
  }

  async accept(player, word, entry, token) {
    if (token !== this.token) return;
    this.token += 1; // 이 턴은 끝남 (타이머·컴퓨터 무효화)
    this.clearTimers();
    const remaining = Math.max(0, (this.deadline - this.now) / 1000);
    const points = this.mode.score(word, remaining, this.settings.turnSec);
    player.score += points;
    player.words += 1;
    this.used.add(word);
    const item = { word, entry, playerId: player.id, name: player.name, isBot: player.isBot, points, at: this.now };
    this.history.push(item);
    this.broadcast('word', item);
    let next = null;
    try { next = await this.nextPromptAfter(word); } catch (e) { this.deps.log?.error?.(e); }
    if (this.state !== 'playing') return;
    if (this.mode.turnBased) {
      if (!next) return this.finish('다음 문제를 만들지 못했어요');
      this.prompt = next;
      const idx = this.players.indexOf(player);
      this.turn = ((idx < 0 ? this.turn : idx) + 1) % this.players.length;
      this.startTurn();
    } else {
      this.nextQuestion(next);
    }
  }

  nextQuestion(next) {
    if (this.quiz.index >= this.quiz.count || !next) {
      this.endRound(null, next ? '문제를 모두 풀었어요' : '문제를 더 만들지 못했어요');
      return;
    }
    this.quiz.index += 1;
    this.prompt = next;
    this.startTurn();
  }

  async onTimeout(token) {
    if (token !== this.token || this.state !== 'playing') return;
    if (this.mode.turnBased) {
      const p = this.players[this.turn];
      this.endRound(this.turn, '시간 안에 답하지 못했어요');
    } else {
      const answer = this.prompt?.secret?.answer ?? null;
      this.broadcast('reveal', { cho: this.prompt?.cho, answer, entry: this.prompt?.secret?.entry ?? null });
      this.token += 1;
      let next = null;
      try { next = await this.nextPromptAfter(null); } catch { /* 아래에서 처리 */ }
      if (this.state !== 'playing') return;
      this.nextQuestion(next);
    }
  }

  endRound(loserIdx, why) {
    this.clearTimers();
    this.token += 1;
    this.state = 'roundEnd';
    let winners = [];
    if (this.mode.turnBased) {
      const loser = loserIdx != null ? this.players[loserIdx] : null;
      winners = this.players.filter((p) => p !== loser);
      for (const p of winners) p.wins += 1;
      this.roundResult = { round: this.round, loser: loser ? { id: loser.id, name: loser.name } : null, winners: winners.map((p) => p.name), why, words: this.history.length, isLast: this.round >= this.settings.rounds };
    } else {
      // 초성 퀴즈: 이번 라운드 점수가 가장 높은 사람이 승리
      const roundScore = new Map(this.players.map((p) => [p.id, 0]));
      for (const h of this.history) roundScore.set(h.playerId, (roundScore.get(h.playerId) ?? 0) + h.points);
      const top = Math.max(0, ...roundScore.values());
      winners = top > 0 ? this.players.filter((p) => roundScore.get(p.id) === top) : [];
      for (const p of winners) p.wins += 1;
      this.roundResult = { round: this.round, loser: null, winners: winners.map((p) => p.name), why, words: this.history.length, isLast: this.round >= this.settings.rounds };
    }
    this.deadline = this.now + ROUND_END_AUTO_MS;
    this.timer = setTimeout(() => this.next(null, true), ROUND_END_AUTO_MS);
    this.touch();
    this.broadcastState();
  }

  async next(clientId, auto = false) {
    if (!auto) this.requireHost(clientId);
    if (this.state === 'roundEnd') {
      if (this.round >= this.settings.rounds) this.finish();
      else await this.startRound();
    } else if (this.state === 'finished') {
      this.clearTimers();
      this.state = 'lobby';
      this.prompt = null; this.history = []; this.roundResult = null; this.quiz = null; this.round = 0;
      this.broadcastState();
    }
  }

  finish(why = null) {
    this.clearTimers();
    this.token += 1;
    this.state = 'finished';
    const ranked = [...this.players].sort((a, b) => b.wins - a.wins || b.score - a.score);
    const top = ranked[0];
    const tie = !top || (ranked.length > 1 && ranked[1].wins === top.wins && ranked[1].score === top.score);
    this.roundResult = { ...(this.roundResult ?? {}), final: true, why: why ?? this.roundResult?.why ?? null, champion: tie ? null : { id: top.id, name: top.name }, tie, ranking: ranked.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot, wins: p.wins, score: p.score, words: p.words })) };
    this.deadline = 0;
    this.touch();
    this.broadcastState();
  }

  clearTimers() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.botTimer) { clearTimeout(this.botTimer); this.botTimer = null; }
  }

  touch() { this.lastActive = this.now; }

  idleFor() { return this.now - this.lastActive; }

  destroy() {
    this.clearTimers();
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    for (const set of this.subscribers.values()) for (const res of set) { try { res.end(); } catch { /* ignore */ } }
    this.subscribers.clear();
    this.onEmpty?.(this);
  }
}

export class RoomManager {
  constructor(deps) {
    this.deps = { now: () => Date.now(), rng: Math.random, log: console, ...deps };
    this.rooms = new Map();
    this.sweeper = setInterval(() => this.sweep(), 60 * 1000);
    this.sweeper.unref?.();
  }

  create({ name, mode, settings, hostClientId }) {
    if (this.rooms.size >= 200) throw new RoomError('방이 너무 많아요. 잠시 후 다시 시도하세요.', 503);
    if (getMode(mode)?.lang === 'en' && !this.deps.english?.ready) throw new RoomError('영어 사전이 준비되지 않아 영어 모드를 쓸 수 없어요.');
    let id;
    do id = newId(6); while (this.rooms.has(id));
    const room = new Room({ id, name, mode, settings, hostClientId, deps: this.deps });
    room.onEmpty = (r) => this.rooms.delete(r.id);
    this.rooms.set(id, room);
    return room;
  }

  get(id) {
    const room = this.rooms.get(String(id ?? '').toUpperCase());
    if (!room) throw new RoomError('방을 찾을 수 없어요. 이미 닫혔을 수 있어요.', 404);
    return room;
  }

  list() {
    return [...this.rooms.values()].filter((r) => r.settings.isPublic).map((r) => r.summary()).sort((a, b) => b.createdAt - a.createdAt);
  }

  sweep() {
    for (const r of [...this.rooms.values()]) {
      if (r.idleFor() > IDLE_ROOM_MS && r.subscribers.size === 0) r.destroy();
    }
  }

  close() {
    clearInterval(this.sweeper);
    for (const r of [...this.rooms.values()]) r.destroy();
  }
}

function newId(len) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

function iga(name) {
  const ch = [...String(name)].at(-1);
  const code = ch?.codePointAt(0) ?? 0;
  if (code < 0xac00 || code > 0xd7a3) return '이(가)';
  return (code - 0xac00) % 28 === 0 ? '가' : '이';
}
