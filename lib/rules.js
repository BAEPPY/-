// 우리말샘 검색 결과에 게임 규칙을 적용해 단어 사용 가능 여부를 판정한다.
//
// 규칙
//  * 명사만 허용 (의존 명사·대명사·수사·'관형사·명사' 같은 겸용 품사 제외)
//  * 표준어만 허용 (방언·옛말·'⇒규범 표기는 …'·'→ 다른 말' 식의 비표준 표제어 제외)
//  * 북한어·외국어(외래어) 불허
//  * 합성어·파생어 불허 (표제어에 '-' 또는 '^' 가 들어간 항목)
//  * 고유 명사 불허 (전문 분야가 인명·지명·책명·고유명 일반인 항목)
//  * 길이 2 이상
//
// 우리말샘 검색 API(/api/search, advanced=y) 실제 응답 모양 (2026-09 확인)
//   item: { word, sense: [{ sense_no, target_code, definition, pos, type, cat, origin, link }] }
//   - 항목(item) 하나에 뜻풀이(sense) 하나씩 온다. 품사·범주·전문 분야·원어는 모두 sense 쪽에 있다.
//   - word_type(고유어/한자어/외래어/혼종어)·word_unit 은 검색 응답에 없다. 그래서 외래어 판정은
//     검색 요청에 type2=native,chinese,hybrid 필터를 붙여 서버 쪽에서 걸러내는 방식으로 한다. (searchFilters 참고)
//   - 구·속담·관용구는 pos 가 비어 있고 표제어에 띄어쓰기 표시 '^' 가 들어 있다.
//   - type 값: 일반어 / 방언 / 북한어 / 옛말

import { isHangulWord } from './hangul.js';

export const DEFAULT_RULES = Object.freeze({
  minLength: 2,
  allowLoanwords: false,
  allowCompound: false,
});

const PROPER_NOUN_CATS = new Set(['인명', '지명', '책명', '고유명 일반', '고유명사', '고유 명사']);
const NON_STANDARD_TYPES = { 방언: 'dialect', '지역어(방언)': 'dialect', 지역어: 'dialect', 북한어: 'north', 옛말: 'old' };

// 실패 사유 우선순위 (여러 표제어/뜻풀이 중 가장 알려줄 만한 사유 하나를 고를 때 사용)
const REASON_PRIORITY = [
  'not_hangul', 'too_short', 'not_found', 'not_noun', 'compound', 'proper',
  'north', 'foreign', 'dialect', 'old', 'nonstandard',
];

export const REASON_MESSAGES = {
  not_hangul: '한글만 입력할 수 있어요.',
  too_short: '두 글자 이상이어야 해요.',
  not_found: '우리말샘에 없는 단어예요.',
  not_noun: '명사만 사용할 수 있어요.',
  compound: '합성어·파생어는 사용할 수 없어요.',
  proper: '고유 명사는 사용할 수 없어요.',
  north: '북한어는 사용할 수 없어요.',
  foreign: '외래어·외국어는 사용할 수 없어요.',
  dialect: '방언은 사용할 수 없어요.',
  old: '옛말은 사용할 수 없어요.',
  nonstandard: '표준어가 아니에요.',
  used: '이미 사용한 단어예요.',
  chain: '앞 단어의 끝 글자로 시작해야 해요.',
};

/**
 * 규칙을 우리말샘 검색 요청 파라미터로 옮긴 것. (advanced=y 일 때만 적용됨)
 *   type1=word   단어만 (구·관용구·속담 제외)
 *   pos=1        명사만
 *   type3=general 일반어만 (방언·북한어·옛말 제외)
 *   type2=native,chinese,hybrid  고유어·한자어·혼종어만 (외래어 제외) — 응답에 원어 유형이 없어 서버 필터로만 가능
 *   letter_s     최소 음절 수
 * type4 는 '일상어/전문어' 구분이라 고유 명사 판정에는 쓸 수 없다. (고유 명사는 cat 으로 판정)
 */
export function searchFilters(rules = DEFAULT_RULES) {
  const opts = { ...DEFAULT_RULES, ...rules };
  const f = { type1: 'word', pos: '1', type3: 'general' };
  if (!opts.allowLoanwords) f.type2 = 'native,chinese,hybrid';
  if (opts.minLength > 1) f.letter_s = String(opts.minLength);
  return f;
}

/** 표제어에서 형태소 경계 표시('-')와 띄어쓰기 표시('^')를 제거한다. */
export function cleanHeadword(word) {
  return String(word ?? '').replace(/[-^\s·]/g, '');
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v) {
  return v == null ? '' : String(v).trim();
}

/** 뜻풀이에 섞여 오는 마크업(&lt;FL&gt;…&lt;/FL&gt; 등)과 HTML 엔티티를 정리한다. */
export function cleanDefinition(def) {
  return text(def)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 우리말샘 응답 item 하나를 정규화한다. (필드가 item 쪽에 있든 sense 쪽에 있든 모두 읽는다) */
export function normalizeItem(item) {
  const senses = asArray(item.sense).map((s) => ({
    senseNo: s.sense_no ?? s.senseNo ?? null,
    targetCode: s.target_code ?? s.targetCode ?? item.target_code ?? item.targetCode ?? null,
    definition: cleanDefinition(s.definition),
    pos: text(s.pos || item.pos),
    type: text(s.type || item.type),
    cat: text(s.cat || s.category || item.cat),
    origin: text(s.origin || item.origin),
    link: text(s.link),
  }));
  return {
    targetCode: item.target_code ?? item.targetCode ?? senses[0]?.targetCode ?? null,
    word: text(item.word),
    cleanWord: cleanHeadword(item.word),
    supNo: item.sup_no ?? item.supNo ?? null,
    origin: text(item.origin) || senses.find((s) => s.origin)?.origin || '',
    wordUnit: text(item.word_unit || item.wordUnit),
    wordType: text(item.word_type || item.wordType),
    senses,
  };
}

/** '→ 사과.', '‘사글세’의 잘못', '⇒규범 표기는 ‘사글세’이다.' 처럼 다른 표제어로 안내하는 비표준 뜻풀이인지 */
export function isNonStandardDefinition(def) {
  if (!def) return false;
  if (/^\s*→/.test(def)) return true;
  if (/⇒\s*규범\s*표기/.test(def)) return true;
  if (/[’'"」]?\s*의\s*(잘못|비표준어|방언|북한어|옛말|준말이 아닌)/.test(def)) return true;
  return false;
}

function isProperNoun(sense) {
  if (PROPER_NOUN_CATS.has(sense.cat)) return true;
  if (/고유\s?명사/.test(sense.type)) return true;
  return false;
}

/** 뜻풀이 하나에 대한 규칙 판정. 통과하면 null, 아니면 사유. */
function senseReason(sense) {
  if (sense.pos !== '명사') return 'not_noun';
  const typeReason = NON_STANDARD_TYPES[sense.type] ?? (/방언|지역어/.test(sense.type) ? 'dialect' : null);
  if (typeReason) return typeReason;
  if (isProperNoun(sense)) return 'proper';
  if (isNonStandardDefinition(sense.definition)) return 'nonstandard';
  return null;
}

/** 표제어 하나(item)에 규칙을 적용한다. */
export function evaluateItem(rawItem, rules = DEFAULT_RULES) {
  const opts = { ...DEFAULT_RULES, ...rules };
  const item = normalizeItem(rawItem);

  if (item.cleanWord.length < opts.minLength) {
    return { ok: false, reason: 'too_short', item };
  }

  // 뜻풀이 단위 규칙(품사·범주·고유 명사·비표준)을 먼저 본다. 그래야 '이-순신' 같은 항목에
  // '합성어'가 아니라 '고유 명사'라고 알려줄 수 있다.
  const reasons = new Set();
  let passing = null;
  for (const sense of item.senses) {
    const r = senseReason(sense);
    if (r) reasons.add(r);
    else if (!passing) passing = sense;
  }
  if (!passing) {
    // 구·속담·관용구는 품사가 비어 있고 표제어에 '^' 가 있다 → 합성어(구)로 안내
    if (/\^/.test(item.word) && item.senses.every((s) => !s.pos)) return { ok: false, reason: 'compound', item };
    if (item.senses.length === 0) reasons.add('not_noun');
    return { ok: false, reason: pickReason(reasons), item };
  }

  // 표제어 단위 규칙
  if (!opts.allowCompound && /[-^]/.test(item.word)) return { ok: false, reason: 'compound', item };
  if (item.wordUnit && item.wordUnit !== '단어' && !opts.allowCompound) return { ok: false, reason: 'compound', item };
  if (!opts.allowLoanwords && item.wordType === '외래어') return { ok: false, reason: 'foreign', item };

  return { ok: true, item, sense: passing };
}

function pickReason(reasons) {
  for (const r of REASON_PRIORITY) if (reasons.has(r)) return r;
  return 'nonstandard';
}

/**
 * 입력 단어와 우리말샘 검색 결과 목록으로 최종 판정을 내린다.
 * 동형어가 여러 개면 하나라도 통과하면 허용.
 *
 * @param options.unfiltered  rawItems 가 searchFilters() 없이 조회한 결과일 때 true.
 *   서버 필터를 붙인 조회가 이미 실패한 뒤 "왜 안 되는지"를 알아내려 다시 조회한 경우로,
 *   여기서 규칙을 통과하는 항목이 있다면 응답에 없는 정보(원어 유형)로 서버가 걸러낸 것이므로 외래어로 본다.
 */
export function evaluateWord(input, rawItems, rules = DEFAULT_RULES, { unfiltered = false } = {}) {
  const word = String(input ?? '').trim();
  if (!isHangulWord(word)) return fail('not_hangul', word);
  const opts = { ...DEFAULT_RULES, ...rules };
  if (word.length < opts.minLength) return fail('too_short', word);

  const matched = asArray(rawItems).filter((it) => cleanHeadword(it.word) === word);
  if (matched.length === 0) return fail('not_found', word);

  const reasons = new Set();
  let best = null;
  for (const raw of matched) {
    const res = evaluateItem(raw, opts);
    if (!res.ok) { reasons.add(res.reason); continue; }
    if (unfiltered && !opts.allowLoanwords) return fail('foreign', word);
    const entry = toEntry(res.item, res.sense);
    if (!best || entryScore(entry) > entryScore(best)) best = entry;
  }
  if (best) return { ok: true, word, entry: best };
  return fail(pickReason(reasons), word);
}

/** 통과한 동형어가 여럿일 때 기록에 보여 줄 항목 고르기: 전문어보다 일상어, '‘X’의 원말' 같은 안내형 뜻풀이보다 본 뜻풀이 */
function entryScore(entry) {
  let s = 0;
  if (!entry.cat) s += 2;
  if (!/^[‘'"][^’'"]+[’'"]의\s*(원말|준말|본말|본딧말)/.test(entry.definition)) s += 1;
  return s;
}

/** 검색 결과 중 규칙을 통과하는 모든 항목을 돌려준다. (컴퓨터가 단어를 고를 때 사용) */
export function passingEntries(rawItems, rules = DEFAULT_RULES) {
  const out = [];
  for (const raw of asArray(rawItems)) {
    const res = evaluateItem(raw, rules);
    if (res.ok) out.push(toEntry(res.item, res.sense));
  }
  return out;
}

function toEntry(item, sense) {
  return {
    word: item.cleanWord,
    headword: item.word,
    targetCode: sense.targetCode ?? item.targetCode,
    supNo: item.supNo,
    origin: sense.origin || item.origin,
    wordType: item.wordType,
    pos: sense.pos,
    definition: sense.definition,
    cat: sense.cat,
    link: sense.link,
  };
}

function fail(reason, word) {
  return { ok: false, word, reason, message: REASON_MESSAGES[reason] ?? REASON_MESSAGES.nonstandard };
}
