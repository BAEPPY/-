import test from 'node:test';
import assert from 'node:assert/strict';
import { MockDictClient } from '../lib/opendict.js';
import { pickBotWord } from '../lib/bot.js';
import { DEFAULT_RULES } from '../lib/rules.js';

const client = new MockDictClient(new URL('./fixtures/mock-dict.json', import.meta.url));

test('시작 글자로 시작하는 유효한 단어를 고른다', async () => {
  const e = await pickBotWord(client, { starts: ['사'], rules: DEFAULT_RULES });
  assert.ok(e);
  assert.ok(e.word.startsWith('사'));
  assert.notEqual(e.word, '사과나무');
});

test('사용한 단어는 피한다 / 없으면 null', async () => {
  const all = new Set();
  for (let i = 0; i < 50; i++) {
    const e = await pickBotWord(client, { starts: ['사'], used: all, rules: DEFAULT_RULES });
    if (!e) break;
    all.add(e.word);
  }
  assert.ok(all.has('사과') && all.has('사자') && all.has('사람'));
  assert.ok(!all.has('사과나무'));
  assert.equal(await pickBotWord(client, { starts: ['사'], used: all, rules: DEFAULT_RULES }), null);
});

test('외래어는 검색 필터(type2)로 걸러져 후보에 오르지 않는다', async () => {
  const e = await pickBotWord(client, { starts: ['컴', '오'], rules: DEFAULT_RULES });
  assert.equal(e, null); // 컴퓨터·오뎅은 외래어
  const loan = await pickBotWord(client, { starts: ['컴'], rules: { ...DEFAULT_RULES, allowLoanwords: true } });
  assert.equal(loan?.word, '컴퓨터');
});

test('두음법칙 시작 글자도 후보에 포함', async () => {
  const e = await pickBotWord(client, { starts: ['래', '내'], rules: DEFAULT_RULES, rng: () => 0 });
  assert.ok(e);
  assert.equal(e.word, '내일'); // '래일'(북한어), '래스터'(외래어) 는 제외됨
});
