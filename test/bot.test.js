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
  const used = new Set(['사과', '사자']);
  const e = await pickBotWord(client, { starts: ['사'], used, rules: DEFAULT_RULES });
  assert.equal(e, null);
});

test('두음법칙 시작 글자도 후보에 포함', async () => {
  const e = await pickBotWord(client, { starts: ['래', '내'], rules: DEFAULT_RULES, rng: () => 0 });
  assert.ok(e);
  assert.equal(e.word, '내일'); // '래일'(북한어), '래스터'(외래어) 는 제외됨
});
