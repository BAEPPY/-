// 우리말샘 검색 API 의 실제 응답(test/fixtures/opendict-samples.json, 2026-09 수집)으로 규칙 판정을 검증한다.
// 새 응답을 받아 다시 확인하려면 DEBUG=1 로 서버를 띄우고 /api/raw?word=… 를 보면 된다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateWord, passingEntries, normalizeItem } from '../lib/rules.js';

const samples = JSON.parse(fs.readFileSync(new URL('./fixtures/opendict-samples.json', import.meta.url), 'utf8')).words;
const items = (w) => samples[w];

test('실제 응답 모양: 필드는 sense 안에 있고 sense 는 원소 1개짜리 배열', () => {
  for (const [word, list] of Object.entries(samples)) {
    for (const it of list) {
      assert.deepEqual(Object.keys(it).sort(), ['sense', 'word'], word);
      assert.ok(Array.isArray(it.sense) && it.sense.length === 1, word);
      const s = it.sense[0];
      for (const k of ['definition', 'link', 'sense_no', 'target_code', 'type']) assert.ok(k in s, `${word}: ${k}`);
      assert.ok(['일반어', '방언', '북한어', '옛말'].includes(s.type), `${word}: type=${s.type}`);
      assert.equal(typeof s.pos, 'string', `${word}: pos`);
    }
  }
});

test('normalizeItem: sense 쪽 필드를 읽는다', () => {
  const n = normalizeItem(items('컴퓨터')[0]);
  assert.equal(n.word, '컴퓨터');
  assert.equal(n.senses[0].pos, '명사');
  assert.equal(n.senses[0].origin, 'computer');
  assert.equal(n.senses[0].cat, '정보·통신');
  assert.equal(n.senses[0].targetCode, '547591');
});

const EXPECT = {
  // 허용
  사과: 'ok', 나무: 'ok', 역사: 'ok', 설거지: 'ok', 하나: 'ok', 우리: 'ok',
  담배: 'ok', 구두: 'ok', 가방: 'ok', 고무: 'ok', 쪼끔: 'ok', 먹기: 'ok', 동무: 'ok', 부대: 'ok',
  // 동형어 중 하나라도 통과하면 허용 (서울: '한 나라의 중앙 정부가 있는 곳', 미국: 米麴, 세종: 묘호)
  서울: 'ok', 미국: 'ok', 세종: 'ok', 삼춘: 'ok',
  // 사전에 없음 / 길이
  얼음보숭이: 'not_found', 물: 'too_short', 리: 'too_short', 귤: 'too_short', 빵: 'too_short', 돐: 'too_short', 컵: 'too_short',
  것: 'too_short', 각: 'too_short', 전: 'too_short',
  // 방언·북한어·옛말
  정구지: 'dialect', 강생이: 'dialect', 력사: 'north', 래일: 'north', 로동: 'north', 즈믄: 'old',
  // 비표준어 ("⇒규범 표기는 ‘…’이다.")
  설겆이: 'nonstandard', 오뚜기: 'nonstandard', 발자욱: 'nonstandard', 아지랭이: 'nonstandard',
  케익: 'nonstandard', 겨땀: 'nonstandard', 삭월세: 'nonstandard',
  // 외래어 (origin 에 로마자)
  컴퓨터: 'foreign', 버스: 'foreign', 짜장면: 'foreign', 택시: 'foreign', 아파트: 'foreign', 가스: 'foreign', 커피: 'foreign',
  래스터: 'foreign', 금메달: 'foreign', 핸드폰: 'foreign', 아이스크림: 'foreign', 스마트폰: 'foreign',
  닭도리탕: 'foreign', // 원어 "닭tori[鳥]湯"

  // 합성어·파생어·구
  사과나무: 'compound', 책가방: 'compound', 가난뱅이: 'compound', 가정법원: 'compound', 금붕어: 'compound', 강물: 'compound',
  사글세: 'compound',
  // 고유 명사 (인명·지명·책명·작품명)
  니체: 'proper', 한강: 'proper',
  // 명사 아님 (관형사·접사·어근·의존 명사·형용사)
  늠름: 'not_noun', 일없다: 'not_noun',
};

for (const [word, expected] of Object.entries(EXPECT)) {
  test(`실제 응답 판정: ${word} → ${expected}`, () => {
    const r = evaluateWord(word, items(word));
    if (expected === 'ok') assert.equal(r.ok, true, JSON.stringify(r));
    else assert.equal(r.reason, expected, JSON.stringify(r));
  });
}

test('한 글자 단어도 minLength 를 낮추면 규칙대로 판정된다', () => {
  assert.equal(evaluateWord('귤', items('귤'), { minLength: 1 }).ok, true);
  assert.equal(evaluateWord('빵', items('빵'), { minLength: 1 }).ok, true);
  // 돐: 일반어(⇒규범 표기는 ‘돌’) + 북한어 + 옛말 → 비표준어
  const r = evaluateWord('돐', items('돐'), { minLength: 1 });
  assert.equal(r.reason, 'nonstandard');
  assert.equal(r.hint, '돌');
  assert.equal(evaluateWord('것', items('것'), { minLength: 1 }).reason, 'not_noun'); // 의존 명사뿐
  assert.equal(evaluateWord('컵', items('컵'), { minLength: 1 }).reason, 'foreign'); // origin "cup"
  assert.equal(evaluateWord('각', items('각'), { minLength: 1 }).ok, true); // 관형사·접사 + 명사(角) 동형어
  assert.equal(evaluateWord('전', items('전'), { minLength: 1 }).ok, true); // 관형사·접사·어근 + 명사(前 …) 동형어
});

test('힌트: 비표준어·방언·북한어·옛말은 대응 표준어를 알려 준다', () => {
  assert.equal(evaluateWord('설겆이', items('설겆이')).hint, '설거지');
  assert.equal(evaluateWord('오뚜기', items('오뚜기')).hint, '오뚝이');
  assert.equal(evaluateWord('삭월세', items('삭월세')).hint, '사글세');
  assert.equal(evaluateWord('정구지', items('정구지')).hint, '부추');
  assert.equal(evaluateWord('력사', items('력사')).hint, '역사');
  assert.equal(evaluateWord('즈믄', items('즈믄')).hint, '천');
  assert.match(evaluateWord('정구지', items('정구지')).message, /표준어: 부추/);
});

test('옵션: 외래어·합성어 허용', () => {
  assert.equal(evaluateWord('컴퓨터', items('컴퓨터'), { allowLoanwords: true }).ok, true);
  assert.equal(evaluateWord('사과나무', items('사과나무'), { allowCompound: true }).ok, true);
  assert.equal(evaluateWord('금메달', items('금메달'), { allowLoanwords: true }).reason, 'compound');
  assert.equal(evaluateWord('금메달', items('금메달'), { allowLoanwords: true, allowCompound: true }).ok, true);
  // 구(^)는 품사가 비어 오므로 합성어를 허용해도 명사가 아니어서 불허
  assert.equal(evaluateWord('가정법원', items('가정법원'), { allowCompound: true }).reason, 'compound');
});

test('통과한 항목 정보: 원어·뜻풀이·링크는 sense 에서 가져온다', () => {
  const r = evaluateWord('사과', items('사과'));
  assert.equal(r.entry.pos, '명사');
  assert.match(r.entry.link, /^https:\/\/opendict\.korean\.go\.kr\/dictionary\/view\?sense_no=\d+$/);
  const fruit = passingEntries(items('사과')).find((e) => e.origin === '沙果/砂果');
  assert.equal(fruit.definition, '사과나무의 열매.');
});

test('작품명(그림·노래·영화·소설)은 고유 명사로 본다', () => {
  const titles = items('사과').filter((it) => it.sense[0].cat === '미술');
  assert.equal(evaluateWord('사과', titles).reason, 'proper');
  const works = items('한강').filter((it) => ['문학', '영상', '음악'].includes(it.sense[0].cat));
  assert.equal(works.length, 3);
  assert.equal(evaluateWord('한강', works).reason, 'proper');
});

test('뜻풀이의 HTML 태그(&lt;FL&gt;…)는 걷어낸다', () => {
  const book = items('책가방').find((it) => it.sense[0].cat === '책명');
  assert.match(book.sense[0].definition, /&lt;FL&gt;/);
  assert.doesNotMatch(normalizeItem(book).senses[0].definition, /[<&]/);
});

test('passingEntries: 실제 응답에서 컴퓨터 후보를 고를 때 규칙을 지킨다', () => {
  const all = Object.values(samples).flat();
  const words = new Set(passingEntries(all).map((e) => e.word));
  for (const [w, exp] of Object.entries(EXPECT)) assert.equal(words.has(w), exp === 'ok', w);
});
