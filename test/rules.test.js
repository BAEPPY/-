import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateWord, passingEntries, cleanHeadword } from '../lib/rules.js';
import { parseSearchResponse } from '../lib/opendict.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/mock-dict.json', import.meta.url), 'utf8'));
const items = fixture.channel.item;
const lookup = (w) => items.filter((it) => cleanHeadword(it.word) === w);

test('일반 명사는 허용', () => {
  const r = evaluateWord('사과', lookup('사과'));
  assert.equal(r.ok, true);
  assert.equal(r.entry.word, '사과');
  assert.match(r.entry.definition, /열매/);
});

test('사전에 없는 단어', () => {
  assert.equal(evaluateWord('없는말', []).reason, 'not_found');
});

test('한 글자 / 한글 아님', () => {
  assert.equal(evaluateWord('물', lookup('물')).reason, 'too_short');
  assert.equal(evaluateWord('apple', []).reason, 'not_hangul');
  assert.equal(evaluateWord('사과1', []).reason, 'not_hangul');
});

test('명사가 아니면 불허 (동사·의존 명사)', () => {
  assert.equal(evaluateWord('먹다', lookup('먹다')).reason, 'not_noun');
  assert.equal(evaluateWord('것', lookup('것')).reason, 'too_short');
});

test('합성어/구 불허 (표제어에 - 또는 ^)', () => {
  assert.equal(evaluateWord('사과나무', lookup('사과나무')).reason, 'compound');
  assert.equal(evaluateWord('가정법원', lookup('가정법원')).reason, 'compound');
  assert.equal(evaluateWord('사과나무', lookup('사과나무'), { allowCompound: true }).ok, true);
});

test('고유 명사 불허', () => {
  assert.equal(evaluateWord('서울', lookup('서울')).reason, 'proper');
  assert.equal(evaluateWord('니체', lookup('니체'), { allowLoanwords: true }).reason, 'proper');
});

test('북한어·방언·옛말·비표준어 불허', () => {
  assert.equal(evaluateWord('래일', lookup('래일')).reason, 'north');
  assert.equal(evaluateWord('강생이', lookup('강생이')).reason, 'dialect');
  assert.equal(evaluateWord('름름', lookup('름름')).reason, 'old');
  assert.equal(evaluateWord('닭도리탕', lookup('닭도리탕')).reason, 'nonstandard');
});

test('외래어 불허 (옵션으로 허용 가능)', () => {
  assert.equal(evaluateWord('리본', lookup('리본')).reason, 'foreign');
  assert.equal(evaluateWord('리본', lookup('리본'), { allowLoanwords: true }).ok, true);
});

test('동형어 중 하나라도 통과하면 허용', () => {
  const mixed = [
    { word: '배', pos: '명사', sense: { definition: '→ 배추.', type: '일반어' } },
    { word: '배-추', pos: '명사', sense: { definition: 'x', type: '일반어' } },
    { word: '배추', pos: '명사', sense: [{ definition: '십자화과의 두해살이풀.', type: '일반어', cat: '식물' }] },
  ];
  const r = evaluateWord('배추', mixed);
  assert.equal(r.ok, true);
  assert.equal(r.entry.definition, '십자화과의 두해살이풀.');
});

test('sense 가 배열이 아니어도 처리', () => {
  const single = [{ word: '바다', pos: '명사', sense: { definition: '넓은 물.', type: '일반어' } }];
  assert.equal(evaluateWord('바다', single).ok, true);
});

test('뜻풀이 안에 품사·범주가 있는 경우도 처리', () => {
  const senseLevel = [{ word: '하늘', sense: [{ definition: '공간.', pos: '명사', type: '일반어' }] }];
  assert.equal(evaluateWord('하늘', senseLevel).ok, true);
  const dialectSense = [{ word: '하늘', sense: [{ definition: '공간.', pos: '명사', type: '방언' }] }];
  assert.equal(evaluateWord('하늘', dialectSense).reason, 'dialect');
});

test('passingEntries: 컴퓨터 후보 필터', () => {
  const words = passingEntries(items).map((e) => e.word);
  assert.ok(words.includes('사과'));
  assert.ok(!words.includes('사과나무'));
  assert.ok(!words.includes('서울'));
  assert.ok(!words.includes('래일'));
  assert.ok(!words.includes('리본'));
  assert.ok(!words.includes('먹다'));
});

test('parseSearchResponse: 오류 응답은 예외', () => {
  assert.throws(() => parseSearchResponse({ error: { error_code: '020', message: '등록되지 않은 인증키' } }), /020/);
  const r = parseSearchResponse({ channel: { total: '1', start: '1', num: '10', item: { word: '사과' } } });
  assert.equal(r.total, 1);
  assert.equal(r.items.length, 1);
  assert.deepEqual(parseSearchResponse({ channel: { total: 0 } }).items, []);
});
