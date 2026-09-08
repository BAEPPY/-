import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenDictClient, MockDictClient, OpenDictError, parseErrorXml, normalizeParams, matchesFilters } from '../lib/opendict.js';
import { searchFilters } from '../lib/rules.js';

const XML_ERROR = `<?xml version="1.0" encoding="UTF-8"?>
  <error>
    <error_code>020</error_code>
    <message>Unregistered key</message>
  </error>`;

function fakeFetch(body, { status = 200 } = {}) {
  const calls = [];
  const fn = async (url) => { calls.push(new URL(url)); return { ok: status < 400, status, text: async () => body }; };
  fn.calls = calls;
  return fn;
}

test('요청 URL: advanced=y + 규칙 필터, num/start 는 API 허용 범위로', () => {
  const c = new OpenDictClient({ apiKey: 'A'.repeat(32), fetchImpl: fakeFetch('{}') });
  const url = c.buildUrl({ q: '사과', method: 'exact', num: 5, start: 0, filters: searchFilters() });
  const p = url.searchParams;
  assert.equal(p.get('req_type'), 'json');
  assert.equal(p.get('advanced'), 'y');
  assert.equal(p.get('num'), '10');
  assert.equal(p.get('start'), '1');
  assert.equal(p.get('type1'), 'word');
  assert.equal(p.get('pos'), '1');
  assert.equal(p.get('type3'), 'general');
  assert.equal(p.get('type2'), 'native,chinese,hybrid');
  assert.equal(p.get('letter_s'), '2');
  assert.equal(new URL(c.buildUrl({ q: 'x', num: 500 })).searchParams.get('num'), '100');
  assert.deepEqual(normalizeParams({ q: 'x', num: 'abc', start: 2000 }), { q: 'x', method: 'exact', num: 100, start: 1000, filters: {} });
});

test('오류 응답은 req_type=json 이어도 XML 로 온다 → 코드와 안내 메시지로 변환', async () => {
  const err = parseErrorXml(XML_ERROR);
  assert.ok(err instanceof OpenDictError);
  assert.equal(err.code, '020');
  assert.match(err.message, /인증키/);
  assert.equal(parseErrorXml('{"channel":{}}'), null);

  const c = new OpenDictClient({ apiKey: 'A'.repeat(32), fetchImpl: fakeFetch(XML_ERROR) });
  await assert.rejects(c.search({ q: '사과' }), (e) => e instanceof OpenDictError && e.code === '020' && e.status === 500);
  const c2 = new OpenDictClient({ apiKey: 'A'.repeat(32), fetchImpl: fakeFetch('<error><error_code>103</error_code><message>Invalid num value</message></error>') });
  await assert.rejects(c2.raw({ q: '사과' }), /103.*num/);
});

test('search: 필터가 다르면 다른 캐시 키', async () => {
  const fetch = fakeFetch(JSON.stringify({ channel: { total: 1, item: [{ word: '리본', sense: [{ pos: '명사', type: '일반어', definition: '끈.' }] }] } }));
  const c = new OpenDictClient({ apiKey: 'A'.repeat(32), fetchImpl: fetch });
  await c.search({ q: '리본' });
  await c.search({ q: '리본' });
  assert.equal(fetch.calls.length, 1);
  await c.search({ q: '리본', filters: searchFilters() });
  assert.equal(fetch.calls.length, 2);
  assert.equal(fetch.calls[1].searchParams.get('type2'), 'native,chinese,hybrid');
});

test('모의 사전: advanced 필터를 흉내 낸다', async () => {
  const client = new MockDictClient(new URL('./fixtures/mock-dict.json', import.meta.url));
  const strict = searchFilters();
  assert.equal((await client.search({ q: '리본', filters: strict })).total, 0); // type2: 외래어 제외
  assert.ok((await client.search({ q: '리본' })).total > 0);
  assert.equal((await client.search({ q: '먹다', filters: strict })).total, 0); // pos=1
  assert.equal((await client.search({ q: '래일', filters: strict })).total, 0); // type3=general
  assert.equal((await client.search({ q: '가정법원', filters: strict })).total, 0); // type1=word
  assert.equal((await client.search({ q: '물', filters: strict })).total, 0); // letter_s=2
  assert.ok((await client.search({ q: '사과', filters: strict })).total > 0);
  const started = await client.search({ q: '사', method: 'start', filters: strict });
  assert.ok(started.items.every((it) => it.sense.every((s) => s.pos === '명사' && s.type === '일반어')));
  assert.equal(matchesFilters({ word: '하늘', sense: [{ pos: '명사', type: '일반어' }] }, { type2: 'native,chinese,hybrid' }), true);
  assert.equal(matchesFilters({ word: '리본', word_type: '외래어', sense: [{ pos: '명사', type: '일반어' }] }, { type2: 'native,chinese,hybrid' }), false);
});
