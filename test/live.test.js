// 우리말샘 실제 API 로 규칙을 검증한다. OPENDICT_API_KEY 가 없으면 건너뛴다.
//   OPENDICT_API_KEY=... node --test test/live.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from '../lib/config.js';
import { OpenDictClient } from '../lib/opendict.js';
import { evaluateWord, searchFilters, DEFAULT_RULES } from '../lib/rules.js';
import { pickBotWord } from '../lib/bot.js';

const config = getConfig();
const skip = !config.apiKey || /^(1|true|yes|on)$/i.test(process.env.MOCK_DICT ?? '');
const client = skip ? null : new OpenDictClient({ apiKey: config.apiKey, timeoutMs: 15000 });

/** server.js 의 /api/validate 와 같은 2단계 판정 */
async function validate(word, rules = DEFAULT_RULES) {
  const strict = await client.search({ q: word, method: 'exact', num: 100, filters: searchFilters(rules) });
  let v = evaluateWord(word, strict.items, rules);
  if (!v.ok) {
    const all = await client.search({ q: word, method: 'exact', num: 100 });
    v = evaluateWord(word, all.items, rules, { unfiltered: true });
  }
  return v;
}

const EXPECT = {
  // 허용
  사과: 'ok', 과일: 'ok', 나무: 'ok', 하늘: 'ok', 사람: 'ok', 학교: 'ok', 여자: 'ok',
  서울: 'ok', // 지명 외에 일반 명사 뜻이 있음
  나모: 'ok', // 옛말·방언 외에 불교 용어(螺毛) 명사가 있음
  애비: 'ok', // '⇒규범 표기' 뜻이 대부분이지만 표준 뜻이 있음
  // 불허
  먹다: 'not_noun', 즈믄: 'not_noun',
  사과나무: 'compound', 닭도리탕: 'compound', 자동차: 'compound', 가정법원: 'compound',
  니체: 'proper', 이순신: 'proper',
  대한민국: 'compound', // '대한-민국': 지명 외에 연호 뜻이 있어 고유 명사가 아니라 합성어로 걸린다
  래일: 'north', 설겆이: 'north', 강생이: 'dialect',
  숫놈: 'nonstandard', 오랫만: 'nonstandard', 멋장이: 'nonstandard',
  리본: 'foreign', 컴퓨터: 'foreign', 오뎅: 'foreign', 짜장면: 'foreign', 래스터: 'foreign',
  없는말: 'not_found',
};

test('실제 우리말샘 응답으로 규칙 판정', { skip: skip && 'OPENDICT_API_KEY 없음' }, async () => {
  const wrong = [];
  for (const [word, expected] of Object.entries(EXPECT)) {
    const v = await validate(word);
    const got = v.ok ? 'ok' : v.reason;
    if (got !== expected) wrong.push(`${word}: 기대 ${expected}, 실제 ${got}`);
  }
  assert.deepEqual(wrong, []);
});

test('실제 응답 모양: 품사·범주·원어는 sense 쪽에 있고 word_type 은 없다', { skip: skip && 'OPENDICT_API_KEY 없음' }, async () => {
  const { items } = await client.search({ q: '리본', method: 'exact', num: 100 });
  assert.ok(items.length > 0);
  for (const it of items) {
    assert.equal(it.word_type, undefined);
    assert.equal(it.pos, undefined);
    for (const s of [].concat(it.sense)) {
      assert.equal(s.pos, '명사');
      assert.equal(s.type, '일반어');
      assert.equal(s.origin, 'ribbon');
      assert.ok(s.target_code);
    }
  }
  // 외래어는 type2 필터로만 구분된다
  assert.equal((await client.search({ q: '리본', method: 'exact', num: 100, filters: { type2: 'native,chinese,hybrid' } })).total, 0);
  assert.equal((await client.search({ q: '리본', method: 'exact', num: 100, filters: { type2: 'loanword' } })).total, items.length);
});

test('옵션: 외래어·합성어 허용', { skip: skip && 'OPENDICT_API_KEY 없음' }, async () => {
  assert.equal((await validate('컴퓨터', { ...DEFAULT_RULES, allowLoanwords: true })).ok, true);
  assert.equal((await validate('자동차', { ...DEFAULT_RULES, allowCompound: true })).ok, true);
  assert.equal((await validate('이순신', { ...DEFAULT_RULES, allowCompound: true })).reason, 'proper');
});

test('잘못된 인증키는 020 오류로 안내', { skip: skip && 'OPENDICT_API_KEY 없음' }, async () => {
  const bad = new OpenDictClient({ apiKey: '0'.repeat(32), timeoutMs: 15000 });
  await assert.rejects(bad.search({ q: '사과' }), (e) => e.code === '020');
});

test('컴퓨터 단어 고르기: 규칙 필터로 검색해 통과하는 단어만', { skip: skip && 'OPENDICT_API_KEY 없음' }, async () => {
  const entry = await pickBotWord(client, { starts: ['리', '이'], rules: DEFAULT_RULES, level: 'easy', rng: () => 0 });
  assert.ok(entry);
  assert.ok(entry.word.startsWith('리') || entry.word.startsWith('이'));
  assert.ok(entry.word.length >= 2);
  assert.equal((await validate(entry.word)).ok, true);
});
