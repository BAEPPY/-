import test from 'node:test';
import assert from 'node:assert/strict';
import { MockDictClient } from '../lib/opendict.js';
import { DEFAULT_RULES } from '../lib/rules.js';
import { EnglishDict } from '../lib/english.js';
import { getMode, MODE_LIST, describeModes, publicPrompt, randomKoreanWord } from '../lib/modes.js';
import { choseongOf, dueumSources, allowedEnds, syllablesWithCho, isChoseongString } from '../lib/hangul.js';

const client = new MockDictClient(new URL('./fixtures/mock-dict.json', import.meta.url));
const english = new EnglishDict(['apple', 'egg', 'goat', 'tree', 'eel', 'lemon', 'nose', 'ab']);
const seeded = (seed = 7) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const ctx = (extra = {}) => ({ client, english, rules: DEFAULT_RULES, dueum: true, used: new Set(), rng: seeded(), level: 'normal', ...extra });

test('hangul: 초성·두음법칙 역방향', () => {
  assert.equal(choseongOf('사과나무'), 'ㅅㄱㄴㅁ');
  assert.equal(choseongOf('가방a'), 'ㄱㅂa');
  assert.deepEqual(dueumSources('역'), ['녁', '력']);
  assert.deepEqual(dueumSources('노'), ['로']);
  assert.deepEqual(dueumSources('사'), []);
  assert.deepEqual(allowedEnds('역'), ['역', '녁', '력']);
  assert.deepEqual(allowedEnds('역', { dueum: false }), ['역']);
  assert.ok(syllablesWithCho('ㄱ').includes('가'));
  assert.equal(isChoseongString('ㅅㄱ'), true);
  assert.equal(isChoseongString('사ㄱ'), false);
});

test('모드 목록과 공개 제시어', () => {
  assert.deepEqual(MODE_LIST.map((m) => m.id), ['kkm', 'kung', 'apm', 'hunmin', 'choseong', 'english']);
  const d = describeModes({ englishReady: false });
  assert.equal(d.find((m) => m.id === 'english').available, false);
  assert.equal(d.find((m) => m.id === 'kkm').available, true);
  assert.deepEqual(publicPrompt({ type: 'choseong', cho: 'ㅅㄱ', secret: { answer: '사과' } }), { type: 'choseong', cho: 'ㅅㄱ' });
});

test('끝말잇기: 제시어 → 검사 → 다음 제시어(두음법칙) → 컴퓨터', async () => {
  const m = getMode('kkm');
  const c = ctx();
  const p = await m.initialPrompt(c);
  assert.equal(p.type, 'starts');
  const bad = await m.check('없는말', p, c);
  assert.equal(bad.reason, 'chain');
  const bot = await m.botWord(p, c);
  assert.ok(bot && bot.word.startsWith(p.starts[0]) || p.starts.some((s) => bot.word.startsWith(s)));
  const ok = await m.check(bot.word, p, c);
  assert.equal(ok.ok, true);
  const next = await m.nextPrompt(p, '내일', c);
  assert.deepEqual(next.starts, ['일']);
  const next2 = await m.nextPrompt(p, '노래', c);
  assert.deepEqual(next2, { type: 'starts', starts: ['래', '내'], lastWord: '노래' });
  const next3 = await m.nextPrompt(p, '노래', ctx({ dueum: false }));
  assert.deepEqual(next3.starts, ['래']);
});

test('쿵쿵따: 세 글자만', async () => {
  const m = getMode('kung');
  const c = ctx();
  const p = { type: 'starts', starts: ['사'], lastWord: '' };
  assert.equal((await m.check('사과', p, c)).reason, 'length');
  assert.equal((await m.check('사자', p, c)).reason, 'length');
  const bot = await m.botWord({ type: 'starts', starts: ['다'] }, c);
  assert.equal(bot.word, '다람쥐');
});

test('앞말잇기: 앞 단어의 첫 글자로 끝나야 함 (두음법칙 역방향 허용)', async () => {
  const m = getMode('apm');
  const c = ctx();
  const p = await m.initialPrompt(c);
  assert.equal(p.type, 'ends');
  const bot = await m.botWord(p, c);
  assert.ok(p.ends.some((e) => bot.word.endsWith(e)), `${bot.word} ends with ${p.ends}`);
  const next = await m.nextPrompt(p, '내일', c);
  assert.deepEqual(next.ends, ['내', '래']);
  assert.equal((await m.check('사과', { type: 'ends', ends: ['물'] }, c)).reason, 'chain');
  assert.equal((await m.check('강물', { type: 'ends', ends: ['물'] }, c)).ok, true);
});

test('훈민정음: 두 초성으로 시작하는 단어, 라운드 내내 같은 제시어', async () => {
  const m = getMode('hunmin');
  const c = ctx();
  const p = await m.initialPrompt(c);
  assert.equal(p.type, 'hunmin');
  assert.equal(p.cho.length, 2);
  assert.ok(isChoseongString(p.cho));
  assert.equal(await m.nextPrompt(p, '아무', c), p);
  const p2 = { type: 'hunmin', cho: 'ㅅㄱ', secret: { seed: '사과' } };
  assert.equal((await m.check('사과', p2, c)).ok, true);
  assert.equal((await m.check('나무', p2, c)).reason, 'chain');
  const bot = await m.botWord(p2, ctx({ used: new Set(['사과']) }));
  assert.ok(bot && choseongOf(bot.word).startsWith('ㅅㄱ'), bot?.word); // 사자? no: ㅅㅈ. 소금(ㅅㄱ) 등
});

test('초성 퀴즈: 정답 또는 같은 초성의 다른 단어도 정답', async () => {
  const m = getMode('choseong');
  const c = ctx();
  const p = await m.initialPrompt(c);
  assert.equal(p.type, 'choseong');
  assert.equal(p.cho.length, p.length);
  assert.equal(choseongOf(p.secret.answer), p.cho);
  assert.equal((await m.check(p.secret.answer, p, c)).ok, true);
  const p2 = { type: 'choseong', cho: 'ㅅㄱ', length: 2, secret: { answer: '수박', entry: { word: '수박' } } };
  assert.equal((await m.check('사과', p2, c)).ok, true); // 초성만 맞으면 사전 단어는 모두 정답
  assert.equal((await m.check('사자', p2, c)).reason, 'chain');
  assert.equal((await m.botWord(p2, c)).word, '수박');
  const used = new Set();
  for (let i = 0; i < 5; i++) { const w = await randomKoreanWord(ctx({ used })); used.add(w.word); }
  assert.equal(used.size, 5); // 이미 나온 단어는 다시 출제하지 않음
});

test('영어 끝말잇기', async () => {
  const m = getMode('english');
  const c = ctx();
  const p = { type: 'letter', starts: ['e'], lastWord: 'apple' };
  assert.equal((await m.check('egg', p, c)).ok, true);
  assert.equal((await m.check('Egg', p, c)).ok, true);
  assert.equal((await m.check('apple', p, c)).reason, 'chain');
  assert.equal((await m.check('ab', { type: 'letter', starts: ['a'] }, c)).reason, 'too_short');
  assert.equal((await m.check('eggs', p, c)).reason, 'not_found');
  assert.equal((await m.check('e-g', p, c)).reason, 'not_alpha');
  assert.deepEqual(await m.nextPrompt(p, 'Egg', c), { type: 'letter', starts: ['g'], lastWord: 'egg' });
  const bot = await m.botWord({ type: 'letter', starts: ['e'] }, ctx({ used: new Set(['egg']) }));
  assert.equal(bot.word, 'eel');
  assert.equal((await m.check('egg', p, ctx({ english: new EnglishDict() }))).reason, 'no_dict');
});

test('EnglishDict: 목록 읽기, 길이 제한, 사용한 단어 제외', () => {
  const d = new EnglishDict(['Apple', 'apple', 'ab', 'x-ray', 'zoo', '']);
  assert.equal(d.size, 2);
  assert.equal(d.has('APPLE'), true);
  assert.equal(d.has('ab'), false);
  assert.equal(d.pick(['a'], { used: new Set(['apple']) }), null);
  assert.equal(d.pick(['z']), 'zoo');
  assert.equal(new EnglishDict().ready, false);
});
