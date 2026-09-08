import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  evaluateWord, evaluateItem, passingEntries, cleanHeadword, cleanDefinition, searchFilters, isNonStandardDefinition,
} from '../lib/rules.js';
import { parseSearchResponse } from '../lib/opendict.js';

// 픽스처는 우리말샘 검색 API 실제 응답으로 만든 것 (scripts/build-fixture.mjs)
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/mock-dict.json', import.meta.url), 'utf8'));
const items = fixture.channel.item;
const lookup = (w) => items.filter((it) => cleanHeadword(it.word) === w);
// 서버가 규칙 필터(searchFilters)를 붙여 조회한 결과를 흉내 낸다 (외래어 항목은 word_type 주석으로 구분)
const strictLookup = (w, rules) => lookup(w).filter((it) => rules?.allowLoanwords || it.word_type !== '외래어');

test('일반 명사는 허용', () => {
  const r = evaluateWord('사과', lookup('사과'));
  assert.equal(r.ok, true);
  assert.equal(r.entry.word, '사과');
  assert.equal(r.entry.pos, '명사');
  assert.ok(r.entry.link.startsWith('https://opendict.korean.go.kr/'));
});

test('통과한 동형어가 여럿이면 전문어·안내형 뜻풀이보다 일상어를 보여 준다', () => {
  const r = evaluateWord('사과', lookup('사과'));
  assert.equal(r.entry.cat, '');
  assert.doesNotMatch(r.entry.definition, /의 원말/);
  assert.match(evaluateWord('상자', lookup('상자')).entry.definition, /^(?!‘)/);
});

test('사전에 없는 단어', () => {
  assert.equal(evaluateWord('없는말', []).reason, 'not_found');
});

test('한 글자 / 한글 아님', () => {
  assert.equal(evaluateWord('물', lookup('물')).reason, 'too_short');
  assert.equal(evaluateWord('것', lookup('것')).reason, 'too_short');
  assert.equal(evaluateWord('apple', []).reason, 'not_hangul');
  assert.equal(evaluateWord('사과1', []).reason, 'not_hangul');
});

test('명사가 아니면 불허 (동사·수사·관형사)', () => {
  assert.equal(evaluateWord('먹다', lookup('먹다')).reason, 'not_noun');
  assert.equal(evaluateWord('즈믄', lookup('즈믄')).reason, 'not_noun'); // 수·관 옛말
  const dependent = [{ word: '가지', sense: [{ definition: '…', pos: '의존 명사', type: '일반어' }] }];
  assert.equal(evaluateWord('가지', dependent).reason, 'not_noun');
});

test('합성어(-)·구(^) 불허', () => {
  assert.equal(evaluateWord('사과나무', lookup('사과나무')).reason, 'compound');
  assert.equal(evaluateWord('닭도리탕', lookup('닭도리탕')).reason, 'compound');
  assert.equal(evaluateWord('가정법원', lookup('가정법원')).reason, 'compound'); // 구: pos 없음 + '^'
  assert.equal(evaluateWord('사과나무', lookup('사과나무'), { allowCompound: true }).ok, true);
  assert.equal(evaluateWord('가정법원', lookup('가정법원'), { allowCompound: true }).reason, 'compound'); // 구는 명사가 아니므로 계속 불허
});

test('고유 명사 불허 (cat 이 인명·지명·책명)', () => {
  assert.equal(evaluateWord('니체', lookup('니체'), { allowLoanwords: true }).reason, 'proper');
  assert.equal(evaluateWord('이순신', lookup('이순신')).reason, 'proper'); // '이-순신' 이지만 합성어보다 고유 명사로 안내
  // '대한-민국' 은 지명 외에 연호 뜻(전문 분야 없음)이 있어 고유 명사가 아니라 합성어로 걸린다
  assert.equal(evaluateWord('대한민국', lookup('대한민국')).reason, 'compound');
  assert.equal(evaluateWord('대한민국', lookup('대한민국'), { allowCompound: true }).ok, true);
  // '서울' 은 지명 외에 '한 나라의 중앙 정부가 있는 곳' 이라는 일반 명사 뜻이 있어 허용된다
  const seoul = evaluateWord('서울', lookup('서울'));
  assert.equal(seoul.ok, true);
  assert.equal(seoul.entry.cat, '');
});

test('북한어·방언·옛말 불허 (type 필드)', () => {
  assert.equal(evaluateWord('래일', lookup('래일')).reason, 'north');
  assert.equal(evaluateWord('설겆이', lookup('설겆이')).reason, 'north');
  assert.equal(evaluateWord('강생이', lookup('강생이')).reason, 'dialect');
  const old = lookup('나모').filter((it) => it.sense[0].type === '옛말');
  assert.equal(evaluateWord('나모', old).reason, 'old');
  // '나모' 는 옛말·방언 말고도 불교 용어(螺毛) 명사가 있어 실제로는 허용
  assert.equal(evaluateWord('나모', lookup('나모')).ok, true);
});

test('비표준 표기 불허 (⇒규범 표기는 …, → …, ~의 잘못)', () => {
  assert.equal(isNonStandardDefinition('짐승의 수컷. ⇒규범 표기는 ‘수놈’이다.'), true);
  assert.equal(isNonStandardDefinition('아내가 남편을 이르는 말. ⇒규범 표기는‘아비’이다.'), true);
  assert.equal(isNonStandardDefinition('→ 사과.'), true);
  assert.equal(isNonStandardDefinition('‘사글세’의 잘못.'), true);
  assert.equal(isNonStandardDefinition('‘상재’의 원말.'), false);
  assert.equal(evaluateWord('숫놈', lookup('숫놈')).reason, 'nonstandard');
  assert.equal(evaluateWord('오랫만', lookup('오랫만')).reason, 'nonstandard');
  assert.equal(evaluateWord('멋장이', lookup('멋장이'), { allowCompound: true }).reason, 'nonstandard');
  // '애비' 는 '⇒규범 표기는 아비' 뜻이 대부분이지만 은어·비석 뜻(표준)이 있어 허용
  assert.equal(evaluateWord('애비', lookup('애비')).ok, true);
});

test('외래어: 검색 응답에 원어 유형이 없으므로 서버 필터 조회 → 실패 시 무필터 재조회로 판정', () => {
  // 1단계: 규칙 필터를 붙인 조회에는 외래어가 아예 오지 않는다
  assert.equal(evaluateWord('리본', strictLookup('리본')).reason, 'not_found');
  // 2단계: 필터 없이 다시 조회했을 때 규칙을 통과하는 항목이 있으면 외래어
  assert.equal(evaluateWord('리본', lookup('리본'), undefined, { unfiltered: true }).reason, 'foreign');
  assert.equal(evaluateWord('컴퓨터', lookup('컴퓨터'), undefined, { unfiltered: true }).reason, 'foreign');
  // 외래어 허용 시에는 필터를 붙이지 않으므로 그대로 통과
  assert.equal(evaluateWord('리본', strictLookup('리본', { allowLoanwords: true }), { allowLoanwords: true }).ok, true);
  assert.equal(evaluateWord('리본', lookup('리본'), { allowLoanwords: true }, { unfiltered: true }).ok, true);
  // 무필터 재조회에서도 다른 사유로 떨어지면 그 사유를 알려 준다
  assert.equal(evaluateWord('래일', lookup('래일'), undefined, { unfiltered: true }).reason, 'north');
  // 옛 응답 모양(word_type 이 item 에 있는 경우)도 그대로 처리
  const legacy = [{ word: '리본', pos: '명사', word_type: '외래어', sense: [{ definition: '끈.', type: '일반어' }] }];
  assert.equal(evaluateWord('리본', legacy).reason, 'foreign');
});

test('searchFilters: 규칙을 우리말샘 advanced 검색 파라미터로', () => {
  assert.deepEqual(searchFilters(), { type1: 'word', pos: '1', type3: 'general', type2: 'native,chinese,hybrid', letter_s: '2' });
  assert.equal(searchFilters({ allowLoanwords: true }).type2, undefined);
  assert.equal(searchFilters({ minLength: 1 }).letter_s, undefined);
  assert.equal(searchFilters().type4, undefined); // type4 는 일상어/전문어 구분이라 쓰지 않는다
});

test('동형어 중 하나라도 통과하면 허용', () => {
  const mixed = [
    { word: '배', sense: { definition: '→ 배추.', pos: '명사', type: '일반어' } },
    { word: '배-추', sense: { definition: 'x', pos: '명사', type: '일반어' } },
    { word: '배추', sense: [{ definition: '십자화과의 두해살이풀.', pos: '명사', type: '일반어', cat: '식물' }] },
  ];
  const r = evaluateWord('배추', mixed);
  assert.equal(r.ok, true);
  assert.equal(r.entry.definition, '십자화과의 두해살이풀.');
});

test('sense 가 배열이 아니어도, 품사·범주가 item 쪽에 있어도 처리', () => {
  assert.equal(evaluateWord('바다', [{ word: '바다', pos: '명사', sense: { definition: '넓은 물.', type: '일반어' } }]).ok, true);
  assert.equal(evaluateWord('하늘', [{ word: '하늘', sense: [{ definition: '공간.', pos: '명사', type: '일반어' }] }]).ok, true);
  assert.equal(evaluateWord('하늘', [{ word: '하늘', sense: [{ definition: '공간.', pos: '명사', type: '방언' }] }]).reason, 'dialect');
  assert.equal(evaluateWord('하늘', [{ word: '하늘', sense: [{ definition: '공간.', pos: '명사', type: '지역어(방언)' }] }]).reason, 'dialect');
});

test('entry: 원어·대상 코드는 sense 쪽에서 읽는다', () => {
  const r = evaluateItem(lookup('기차').find((it) => it.sense[0].origin === '汽車'));
  assert.equal(r.ok, true);
  assert.equal(r.item.origin, '汽車');
  assert.ok(r.sense.targetCode);
});

test('cleanDefinition: 마크업·엔티티 정리', () => {
  assert.equal(cleanDefinition('프랑스의 작가 &lt;FL&gt;베르베르&lt;/FL&gt;가 지은 소설.'), '프랑스의 작가 베르베르가 지은 소설.');
  assert.equal(cleanDefinition('<FL>포더길</FL>(F. Fothergill)'), '포더길(F. Fothergill)');
});

test('passingEntries: 컴퓨터 후보 필터', () => {
  const words = passingEntries(items).map((e) => e.word);
  assert.ok(words.includes('사과'));
  assert.ok(words.includes('서울'));
  assert.ok(!words.includes('사과나무'));
  assert.ok(!words.includes('니체'));
  assert.ok(!words.includes('래일'));
  assert.ok(!words.includes('먹다'));
  assert.ok(!words.includes('숫놈'));
  // 실제 API 에서는 외래어를 검색 필터(type2)가 거른다. 픽스처의 word_type 주석은 옛 응답 모양 처리로 걸러진다
  assert.ok(!words.includes('리본'));
  assert.ok(passingEntries(items, { allowLoanwords: true }).some((e) => e.word === '리본'));
});

test('parseSearchResponse: 오류 응답은 예외', () => {
  assert.throws(() => parseSearchResponse({ error: { error_code: '020', message: 'Unregistered key' } }), /020.*인증키/);
  const r = parseSearchResponse({ channel: { total: '1', start: '1', num: '10', item: { word: '사과' } } });
  assert.equal(r.total, 1);
  assert.equal(r.items.length, 1);
  assert.deepEqual(parseSearchResponse({ channel: { total: 0, item: [] } }).items, []);
});
