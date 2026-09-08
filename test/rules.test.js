import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateWord, passingEntries, cleanHeadword, isNounPos, isForeignOrigin, nonStandardHint, cleanDefinition } from '../lib/rules.js';
import { parseSearchResponse, parseXmlError, OpenDictError, OpenDictClient, MockDictClient } from '../lib/opendict.js';

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

test('명사가 아니면 불허 (동사·의존 명사·어근·수사·대명사)', () => {
  assert.equal(evaluateWord('먹다', lookup('먹다')).reason, 'not_noun');
  assert.equal(evaluateWord('것', lookup('것')).reason, 'too_short');
  assert.equal(evaluateWord('늠름', lookup('늠름')).reason, 'not_noun'); // pos "" (어근)
  assert.equal(evaluateWord('하나', lookup('하나')).entry.pos, '명사'); // 수사 + 명사 동형어
  assert.equal(evaluateWord('우리', lookup('우리')).entry.pos, '명사'); // 대명사 + 명사 동형어
});

test('조합 품사 "관·명"(관형사·명사)은 명사로 본다', () => {
  assert.equal(isNounPos('명사'), true);
  assert.equal(isNounPos('관·명'), true);
  assert.equal(isNounPos('수·관'), false);
  assert.equal(isNounPos('의존 명사'), false);
  assert.equal(isNounPos(''), false);
});

test('합성어/구 불허 (표제어에 - 또는 ^)', () => {
  assert.equal(evaluateWord('사과나무', lookup('사과나무')).reason, 'compound');
  assert.equal(evaluateWord('가정법원', lookup('가정법원')).reason, 'compound');
  assert.equal(evaluateWord('사과나무', lookup('사과나무'), { allowCompound: true }).ok, true);
  assert.equal(evaluateWord('과일나무', lookup('과일나무'), { allowCompound: true }).ok, true);
});

test('고유 명사 불허', () => {
  assert.equal(evaluateWord('서울', lookup('서울')).reason, 'proper');
  assert.equal(evaluateWord('니체', lookup('니체'), { allowLoanwords: true }).reason, 'proper');
});

test('북한어·방언·옛말·비표준어 불허 (+ 표준어 힌트)', () => {
  assert.equal(evaluateWord('래일', lookup('래일')).reason, 'north');
  assert.equal(evaluateWord('래일', lookup('래일')).hint, '내일');
  assert.equal(evaluateWord('강생이', lookup('강생이')).reason, 'dialect');
  assert.equal(evaluateWord('름름', lookup('름름')).reason, 'old');
  assert.equal(evaluateWord('닭도리탕', lookup('닭도리탕')).reason, 'nonstandard');
  assert.equal(evaluateWord('닭도리탕', lookup('닭도리탕')).hint, '닭볶음탕');
  assert.equal(evaluateWord('설겆이', lookup('설겆이')).reason, 'nonstandard'); // 북한어 항목 + ⇒규범 표기 항목
  assert.equal(evaluateWord('오뚜기', lookup('오뚜기')).message, '표준어가 아니에요. (표준어: 오뚝이)');
});

test('비표준 뜻풀이 패턴', () => {
  assert.equal(nonStandardHint('먹고 난 뒤의 그릇을 씻어 정리하는 일. ⇒규범 표기는 ‘설거지’이다.'), '설거지');
  assert.equal(nonStandardHint('‘발자국’의 잘못.'), '발자국');
  assert.equal(nonStandardHint('→ 닭볶음탕.'), '닭볶음탕');
  assert.equal(nonStandardHint('‘조금’의 센말.'), null);
  assert.equal(nonStandardHint('사과나무의 열매.'), null);
});

test('외래어 불허: 원어(origin)에 로마자가 있으면 외래어 (옵션으로 허용 가능)', () => {
  assert.equal(evaluateWord('리본', lookup('리본')).reason, 'foreign');
  assert.equal(evaluateWord('리본', lookup('리본'), { allowLoanwords: true }).ok, true);
  assert.equal(evaluateWord('컴퓨터', lookup('컴퓨터')).reason, 'foreign');
  assert.equal(evaluateWord('아파트', lookup('아파트')).reason, 'foreign'); // "←apartment"
  assert.equal(evaluateWord('금메달', lookup('금메달')).reason, 'foreign'); // "金medal" (혼종어)
  assert.equal(isForeignOrigin('computer'), true);
  assert.equal(isForeignOrigin('▼hand phone'), true);
  assert.equal(isForeignOrigin('←zhajiangmian[炸醬麵]'), true);
  assert.equal(isForeignOrigin('沙果/砂果'), false);
  assert.equal(isForeignOrigin('三춘'), false);
  assert.equal(isForeignOrigin(''), false);
});

test('고유 명사: 전문 분야가 인명·지명이거나 작품명이면 불허, 다른 뜻이 있으면 허용', () => {
  assert.equal(evaluateWord('세종', lookup('세종')).reason, 'proper');
  assert.equal(evaluateWord('한강', lookup('한강')).reason, 'proper'); // 지명 + 소설 + 방언 부사 → 가장 많은 사유
});

test('동형어 중 하나라도 통과하면 허용', () => {
  const mixed = [
    { word: '배', sense: [{ pos: '명사', definition: '→ 배추.', type: '일반어' }] },
    { word: '배-추', sense: [{ pos: '명사', definition: 'x', type: '일반어' }] },
    { word: '배추', sense: [{ pos: '명사', definition: '십자화과의 두해살이풀.', type: '일반어', cat: '식물' }] },
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

test('parseSearchResponse: 오류 응답은 예외 (JSON 오류, XML 오류 모두)', () => {
  assert.throws(() => parseSearchResponse({ error: { error_code: '020', message: 'Unregistered key' } }), /020.*인증키/);
  assert.throws(() => parseSearchResponse({ error: { error_code: 20, message: 'Unregistered key' } }), /020/);
  // req_type=json 이어도 오류는 XML 로 온다
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n <error>\n <error_code>103</error_code>\n <message>Invalid num value</message>\n </error>';
  const err = parseXmlError(xml);
  assert.ok(err instanceof OpenDictError);
  assert.equal(err.code, '103');
  assert.match(err.message, /num/);
  assert.equal(parseXmlError('{"channel":{}}'), null);
  const r = parseSearchResponse({ channel: { total: '1', start: '1', num: '10', item: { word: '사과' } } });
  assert.equal(r.total, 1);
  assert.equal(r.items.length, 1);
  assert.deepEqual(parseSearchResponse({ channel: { total: 0 } }).items, []);
});

test('cleanDefinition: HTML 이스케이프·태그 제거', () => {
  assert.equal(cleanDefinition('에스파냐의 작가 &lt;FL&gt;리오나&lt;/FL&gt;(Lyona)가 지은 책.'), '에스파냐의 작가 리오나(Lyona)가 지은 책.');
  assert.equal(cleanDefinition('  둘 이상의 &amp; 기호. '), '둘 이상의 & 기호.');
});

test('OpenDictClient: 요청 URL (num 범위 보정, 서버 쪽 필터, 추가 파라미터)', () => {
  const c = new OpenDictClient({ apiKey: 'k', extraParams: 'sort=popular' });
  const u = c.buildUrl({ q: '과', method: 'start', num: 5, start: 3, filters: { type1: 'word', pos: '1', type3: 'general' } });
  assert.equal(u.searchParams.get('num'), '10');
  assert.equal(u.searchParams.get('start'), '3');
  assert.equal(u.searchParams.get('req_type'), 'json');
  assert.equal(u.searchParams.get('advanced'), 'y');
  assert.equal(u.searchParams.get('pos'), '1');
  assert.equal(u.searchParams.get('type3'), 'general');
  assert.equal(u.searchParams.get('sort'), 'popular');
});

test('OpenDictClient: XML 오류 본문은 OpenDictError 로', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '<error><error_code>020</error_code><message>Unregistered key</message></error>' });
  const c = new OpenDictClient({ apiKey: 'k', fetchImpl });
  await assert.rejects(() => c.search({ q: '사과' }), (e) => e instanceof OpenDictError && e.code === '020');
});

test('MockDictClient: 서버 쪽 필터를 흉내 낸다', async () => {
  const c = new MockDictClient(new URL('./fixtures/mock-dict.json', import.meta.url));
  const all = await c.search({ q: '하', method: 'start' });
  const nouns = await c.search({ q: '하', method: 'start', filters: { type1: 'word', pos: '1', type3: 'general' } });
  assert.ok(all.total > nouns.total);
  assert.ok(nouns.items.every((it) => it.sense[0].pos === '명사' && it.sense[0].type === '일반어'));
});
