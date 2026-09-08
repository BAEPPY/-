import test from 'node:test';
import assert from 'node:assert/strict';
import { MockDictClient } from '../lib/opendict.js';
import { EnglishDict } from '../lib/english.js';
import { Room, RoomManager, RoomError, sanitizeSettings } from '../lib/room.js';

const client = new MockDictClient(new URL('./fixtures/mock-dict.json', import.meta.url));
const english = new EnglishDict(['apple', 'egg', 'goat', 'tree']);
const seeded = (seed = 3) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

function fakeRes() {
  const events = [];
  return { events, write(s) { const m = s.match(/^event: (\w+)\ndata: (.*)\n\n$/s); if (m) events.push({ event: m[1], data: JSON.parse(m[2]) }); }, end() {} };
}

function makeRoom(overrides = {}) {
  const deps = { client, english, rng: seeded(), now: () => Date.now(), log: { error() {}, warn() {} } };
  const room = new Room({ id: 'TEST01', name: '테스트', mode: 'kkm', settings: { turnSec: 5, rounds: 2, maxPlayers: 8, countdownSec: 0 }, hostClientId: 'host', deps, ...overrides });
  return room;
}

test('sanitizeSettings: 범위 보정과 규칙 옵션', () => {
  const s = sanitizeSettings({ turnSec: 1, rounds: 99, maxPlayers: 'x', rules: { allowOld: 1, bogus: true }, level: 'god' }, { turnSec: 15, rounds: 3, maxPlayers: 4, level: 'normal' });
  assert.equal(s.turnSec, 5);
  assert.equal(s.rounds, 10);
  assert.equal(s.maxPlayers, 4);
  assert.equal(s.level, 'normal');
  assert.equal(s.rules.allowOld, true);
  assert.equal('bogus' in s.rules, false);
});

test('대기실: 참가·이름 중복·좌석 제한·방장 권한', async () => {
  const room = makeRoom();
  const res = fakeRes();
  room.subscribe('host', res);
  const p1 = room.join({ clientId: 'host', name: '나' });
  const p2 = room.join({ clientId: 'host', name: '나' });
  assert.equal(p2.name, '나2');
  room.join({ clientId: 'host', name: '셋' });
  room.join({ clientId: 'host', name: '넷' });
  assert.throws(() => room.join({ clientId: 'host', name: '다섯' }), /4명까지/);
  assert.throws(() => room.addBot('guest', 'easy'), RoomError);
  room.addBot('host', 'hard');
  assert.equal(room.players.length, 5);
  assert.equal(room.players.at(-1).isBot, true);
  const snap = room.snapshot('host');
  assert.equal(snap.isHost, true);
  assert.equal(snap.players.filter((p) => p.isHost).length, 1); // 같은 접속의 다른 좌석에는 방장 표시 없음
  assert.equal(snap.players.filter((p) => p.mine).length, 4);
  assert.throws(() => room.removePlayer(p1.id, 'guest'), /내보낼 수 없어요/);
  room.removePlayer(p1.id, 'host');
  assert.equal(room.players.length, 4);
  assert.ok(res.events.filter((e) => e.event === 'state').length >= 5);
  room.destroy();
});

test('설정 변경은 방장만, 대기실에서만', async () => {
  const room = makeRoom();
  room.join({ clientId: 'host', name: '나' });
  room.addBot('host', 'easy');
  room.updateSettings('host', { mode: 'kung', turnSec: 30, rules: { allowDialect: true } });
  assert.equal(room.modeId, 'kung');
  assert.equal(room.settings.turnSec, 30);
  assert.equal(room.settings.rules.allowDialect, true);
  assert.throws(() => room.updateSettings('guest', { turnSec: 10 }), /방장만/);
  room.updateSettings('host', { mode: 'english' });
  assert.equal(room.modeId, 'english');
  assert.equal(room.players.some((p) => p.isBot), true); // 영어 모드도 컴퓨터 가능
  room.join({ clientId: 'host', name: '둘' });
  await room.start('host');
  assert.throws(() => room.updateSettings('host', { turnSec: 10 }), /대기 중일 때만/);
  room.destroy();
});

test('게임 진행: 시작 → 단어 제출 → 턴 교대 → 시간 초과 → 라운드 종료 → 결과', async () => {
  const room = makeRoom();
  const res = fakeRes();
  room.subscribe('host', res);
  const me = room.join({ clientId: 'host', name: '나' });
  const friend = room.join({ clientId: 'host', name: '친구' });
  await assert.rejects(() => room.start('guest'), /방장만/);
  await room.start('host');
  assert.equal(room.state, 'playing');
  assert.equal(room.round, 1);
  assert.equal(room.prompt.type, 'starts');
  assert.equal(room.players[room.turn], me);

  // 제시 글자에 맞지 않는 단어는 거절 (reject 이벤트는 그 접속에만)
  const r1 = await room.submit({ clientId: 'host', playerId: me.id, word: '없는말' });
  assert.equal(r1.ok, false);
  assert.equal(res.events.at(-1).event, 'reject');
  // 남의 차례
  await assert.rejects(() => room.submit({ clientId: 'host', playerId: friend.id, word: '사과' }), /내 차례가 아니에요/);

  // 제시 글자로 시작하는 단어를 모의 사전에서 찾아 제출
  const bot = await room.mode.botWord(room.prompt, room.ctx('hard'));
  const r2 = await room.submit({ clientId: 'host', playerId: me.id, word: bot.word });
  assert.equal(r2.ok, true);
  assert.equal(room.players[room.turn], friend);
  assert.equal(room.history.length, 1);
  assert.ok(me.score > 0);
  assert.ok(res.events.some((e) => e.event === 'word' && e.data.word === bot.word));
  assert.ok(room.used.has(bot.word)); // 같은 단어는 다시 못 씀 (mode.check 뒤 used 검사)

  // 시간 초과 → 친구 패배, 라운드 종료
  await room.onTimeout(room.token);
  assert.equal(room.state, 'roundEnd');
  assert.equal(room.roundResult.loser.name, '친구');
  assert.equal(me.wins, 1);
  assert.equal(room.roundResult.isLast, false);

  await room.next('host');
  assert.equal(room.state, 'playing');
  assert.equal(room.round, 2);
  assert.equal(room.players[room.turn], friend); // 라운드마다 선공 교대
  await room.onTimeout(room.token);
  assert.equal(room.state, 'roundEnd');
  assert.equal(room.roundResult.isLast, true);
  await room.next('host');
  assert.equal(room.state, 'finished');
  assert.equal(room.roundResult.champion.name, '나');
  assert.equal(room.roundResult.ranking[0].wins, 2);
  await room.next('host');
  assert.equal(room.state, 'lobby');
  room.destroy();
});

test('컴퓨터가 자기 차례에 단어를 낸다', async () => {
  const room = makeRoom();
  room.join({ clientId: 'host', name: '나' });
  room.addBot('host', 'hard');
  await room.start('host');
  // 첫 턴은 사람. 사람이 단어를 내면 컴퓨터 차례가 되고, 잠시 뒤 컴퓨터가 응답한다.
  const first = await room.mode.botWord(room.prompt, room.ctx('hard'));
  await room.submit({ clientId: 'host', word: first.word });
  assert.equal(room.players[room.turn].isBot, true);
  const t0 = Date.now();
  while (room.history.length < 2 && room.state === 'playing' && Date.now() - t0 < 6000) await new Promise((r) => setTimeout(r, 50));
  if (room.state === 'playing') {
    assert.equal(room.history.length, 2);
    assert.equal(room.history[1].isBot, true);
    assert.equal(room.players[room.turn].isBot, false);
  } else {
    // 이어갈 단어가 없어 컴퓨터가 진 경우
    assert.equal(room.roundResult.loser.name, '컴퓨터');
  }
  room.destroy();
});

test('초성 퀴즈: 턴 없이 누구나 답하고, 문제 수만큼 진행', async () => {
  const room = makeRoom({ mode: 'choseong', settings: { turnSec: 5, rounds: 1, quizCount: 3, countdownSec: 0 } });
  const me = room.join({ clientId: 'host', name: '나' });
  await room.start('host');
  assert.equal(room.prompt.type, 'choseong');
  assert.deepEqual(room.quiz, { index: 1, count: 3 });
  assert.equal(room.snapshot('host').turnPlayerId, null);
  assert.equal(room.snapshot('host').prompt.secret, undefined);
  const answer = room.prompt.secret.answer;
  const r = await room.submit({ clientId: 'host', playerId: me.id, word: answer });
  assert.equal(r.ok, true);
  assert.equal(room.quiz.index, 2);
  assert.notEqual(room.prompt.secret.answer, answer);
  await room.onTimeout(room.token); // 시간 초과 → 정답 공개 후 다음 문제
  assert.equal(room.quiz.index, 3);
  await room.submit({ clientId: 'host', playerId: me.id, word: room.prompt.secret.answer });
  assert.equal(room.state, 'roundEnd');
  assert.deepEqual(room.roundResult.winners, ['나']);
  room.destroy();
});

test('영어 모드: 사전이 준비된 경우에만 시작', async () => {
  const room = makeRoom({ mode: 'english', settings: { turnSec: 5, rounds: 1, countdownSec: 0 } });
  room.join({ clientId: 'host', name: 'me' });
  room.join({ clientId: 'host', name: 'you' });
  await room.start('host');
  assert.equal(room.prompt.type, 'letter');
  const noDict = new Room({ id: 'X', name: 'x', mode: 'english', settings: { countdownSec: 0 }, hostClientId: 'h', deps: { client, english: new EnglishDict(), rng: Math.random, now: Date.now, log: { error() {}, warn() {} } } });
  noDict.join({ clientId: 'h', name: 'a' });
  noDict.join({ clientId: 'h', name: 'b' });
  await assert.rejects(() => noDict.start('h'), /영어 사전/);
  room.destroy();
  noDict.destroy();
});

test('RoomManager: 만들기·목록·비공개·빈 방 정리', () => {
  const mgr = new RoomManager({ client, english });
  const a = mgr.create({ name: '공개', mode: 'kkm', settings: {}, hostClientId: 'h1' });
  const b = mgr.create({ name: '비공개', mode: 'apm', settings: { isPublic: false }, hostClientId: 'h2' });
  assert.deepEqual(mgr.list().map((r) => r.id), [a.id]);
  assert.equal(mgr.get(a.id.toLowerCase()), a);
  assert.throws(() => mgr.get('NOPE'), /찾을 수 없어요/);
  const p = b.join({ clientId: 'h2', name: 'x' });
  b.removePlayer(p.id, 'h2'); // 사람이 없고 접속도 없으면 방 삭제
  assert.throws(() => mgr.get(b.id), RoomError);
  mgr.close();
});

test('시작 카운트다운: countdownSec 동안 countdown 상태였다가 게임 시작', async () => {
  const room = makeRoom({ settings: { turnSec: 5, rounds: 1, countdownSec: 1 } });
  room.join({ clientId: 'host', name: '나' });
  room.addBot('host', 'easy');
  const starting = room.start('host');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(room.state, 'countdown');
  assert.ok(room.deadline > Date.now());
  await starting;
  assert.equal(room.state, 'playing');
  room.destroy();
});
