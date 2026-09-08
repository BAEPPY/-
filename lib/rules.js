// 우리말샘 검색 결과에 게임 규칙을 적용해 단어 사용 가능 여부를 판정한다.
//
// 규칙
//  * 명사만 허용 (의존 명사·대명사·수사 제외)
//  * 표준어만 허용 (방언·옛말·'~의 잘못'·'→ 다른 말' 식의 비표준 표제어 제외)
//  * 북한어·외국어(외래어) 불허
//  * 합성어·파생어 불허 (표제어에 '-' 또는 '^' 가 들어간 항목, 구 단위 항목)
//  * 고유 명사 불허 (전문 분야가 인명·지명·책명·고유명 일반인 항목)
//  * 길이 2 이상

import { isHangulWord } from './hangul.js';

export const DEFAULT_RULES = Object.freeze({
  minLength: 2,
  allowLoanwords: false,
  allowCompound: false,
});

const PROPER_NOUN_CATS = new Set(['인명', '지명', '책명', '고유명 일반', '고유명사', '고유 명사']);
const NON_STANDARD_TYPES = { 방언: 'dialect', 북한어: 'north', 옛말: 'old' };

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

/** 우리말샘 응답 item 하나를 정규화한다. (뜻풀이 배열·필드 위치가 들쭉날쭉한 것을 흡수) */
export function normalizeItem(item) {
  const senses = asArray(item.sense).map((s) => ({
    senseNo: s.sense_no ?? s.senseNo ?? null,
    definition: text(s.definition),
    pos: text(s.pos || item.pos),
    type: text(s.type || item.type),
    cat: text(s.cat || s.category || item.cat),
    link: text(s.link),
  }));
  return {
    targetCode: item.target_code ?? item.targetCode ?? null,
    word: text(item.word),
    cleanWord: cleanHeadword(item.word),
    supNo: item.sup_no ?? item.supNo ?? null,
    origin: text(item.origin),
    wordUnit: text(item.word_unit || item.wordUnit),
    wordType: text(item.word_type || item.wordType),
    senses,
  };
}

function isNonStandardDefinition(def) {
  if (!def) return false;
  if (/^\s*→/.test(def)) return true; // "→ 사과." 형태: 다른 표제어로 안내하는 비표준 항목
  if (/[’'"」]?\s*의\s*(잘못|비표준어|방언|북한어|옛말|준말이 아닌)/.test(def)) return true;
  return false;
}

function isProperNoun(sense) {
  if (PROPER_NOUN_CATS.has(sense.cat)) return true;
  if (/고유\s?명사/.test(sense.type)) return true;
  return false;
}

/** 표제어 하나(item)에 규칙을 적용한다. */
export function evaluateItem(rawItem, rules = DEFAULT_RULES) {
  const opts = { ...DEFAULT_RULES, ...rules };
  const item = normalizeItem(rawItem);
  const reasons = new Set();

  if (item.cleanWord.length < opts.minLength) {
    return { ok: false, reason: 'too_short', item };
  }
  if (!opts.allowCompound) {
    if (/[-^]/.test(item.word)) return { ok: false, reason: 'compound', item };
    if (item.wordUnit && item.wordUnit !== '단어') return { ok: false, reason: 'compound', item };
  }
  if (!opts.allowLoanwords && item.wordType === '외래어') {
    return { ok: false, reason: 'foreign', item };
  }

  for (const sense of item.senses) {
    if (sense.pos !== '명사') { reasons.add('not_noun'); continue; }
    const typeReason = NON_STANDARD_TYPES[sense.type];
    if (typeReason) { reasons.add(typeReason); continue; }
    if (isProperNoun(sense)) { reasons.add('proper'); continue; }
    if (isNonStandardDefinition(sense.definition)) { reasons.add('nonstandard'); continue; }
    return { ok: true, item, sense };
  }

  if (item.senses.length === 0) reasons.add('not_noun');
  return { ok: false, reason: pickReason(reasons), item };
}

function pickReason(reasons) {
  for (const r of REASON_PRIORITY) if (reasons.has(r)) return r;
  return 'nonstandard';
}

/**
 * 입력 단어와 우리말샘 검색 결과 목록으로 최종 판정을 내린다.
 * 동형어가 여러 개면 하나라도 통과하면 허용.
 */
export function evaluateWord(input, rawItems, rules = DEFAULT_RULES) {
  const word = String(input ?? '').trim();
  if (!isHangulWord(word)) return fail('not_hangul', word);
  const opts = { ...DEFAULT_RULES, ...rules };
  if (word.length < opts.minLength) return fail('too_short', word);

  const matched = asArray(rawItems).filter((it) => cleanHeadword(it.word) === word);
  if (matched.length === 0) return fail('not_found', word);

  const reasons = new Set();
  for (const raw of matched) {
    const res = evaluateItem(raw, opts);
    if (res.ok) return { ok: true, word, entry: toEntry(res.item, res.sense) };
    reasons.add(res.reason);
  }
  return fail(pickReason(reasons), word);
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
    supNo: item.supNo,
    origin: item.origin,
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
