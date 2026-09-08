// 우리말샘 검색 결과에 게임 규칙을 적용해 단어 사용 가능 여부를 판정한다.
//
// 우리말샘 검색 API(/api/search, req_type=json)의 실제 응답 모양 (2026-09 확인):
//   item = { word: "사과-나무", sense: [ { target_code, sense_no, definition, pos, type, cat?, origin?, link } ] }
//   * 품사(pos)·범주(type)·전문 분야(cat)·원어(origin)·대상 코드는 모두 sense 안에 있다. item 에는 word 뿐이다.
//   * sense 는 항상 원소 1개짜리 배열로 온다 (동형어마다 item 이 따로 온다).
//   * type: "일반어" | "방언" | "북한어" | "옛말"
//   * pos: "명사", "의존 명사", "대명사", "수사", "동사", ... 조합 품사는 "수·관", "관·명" 처럼 축약되고,
//          구·속담·관용구·어근("‘전하다’의 어근.")은 "" 로 온다.
//   * word_unit / word_type 은 검색 응답에 없다. 외래어 여부는 origin(원어)으로 판단한다.
//   * 표제어(word)의 '-' 는 형태소 경계(합성어·파생어), '^' 는 띄어쓰기(구)를 뜻한다.
//   * 비표준어는 type 이 "일반어" 이면서 뜻풀이가 "… ⇒규범 표기는 ‘설거지’이다." 꼴로 온다.
//   * 뜻풀이에는 &lt;FL&gt;…&lt;/FL&gt; 같은 HTML 이스케이프된 태그가 섞여 있다.
//
// 규칙
//  * 명사만 허용 (의존 명사·대명사·수사 제외)
//  * 표준어만 허용 (방언·옛말·'⇒규범 표기는 …'·'~의 잘못'·'→ 다른 말' 식의 비표준 표제어 제외)
//  * 북한어·외국어(외래어) 불허
//  * 합성어·파생어 불허 (표제어에 '-' 또는 '^' 가 들어간 항목)
//  * 고유 명사 불허 (전문 분야가 인명·지명·책명·고유명 일반인 항목, 작품명(그림·노래·영화·소설 …) 항목)
//  * 길이 2 이상

import { isHangulWord } from './hangul.js';

export const DEFAULT_RULES = Object.freeze({
  minLength: 2,
  allowLoanwords: false,
  allowCompound: false,
});

const PROPER_NOUN_CATS = new Set(['인명', '지명', '책명', '고유명 일반', '고유명사', '고유 명사']);
// 작품명(고유 명사이지만 전문 분야가 인명·지명·책명이 아닌 것)이 실리는 분야
const WORK_CATS = new Set(['미술', '음악', '영상', '문학', '연기', '무용', '매체', '예체능 일반']);
const NON_STANDARD_TYPES = { 방언: 'dialect', 북한어: 'north', 옛말: 'old' };

// 실패 사유 우선순위 (여러 표제어/뜻풀이 중 가장 알려줄 만한 사유 하나를 고를 때 사용)
const REASON_PRIORITY = [
  'not_hangul', 'too_short', 'not_found',
  'nonstandard', 'north', 'dialect', 'old', 'foreign', 'proper', 'compound', 'not_noun',
];

export const REASON_MESSAGES = {
  not_hangul: '한글만 입력할 수 있어요.',
  too_short: '두 글자 이상이어야 해요.',
  not_found: '우리말샘에 없는 단어예요.',
  not_noun: '명사만 사용할 수 있어요.',
  compound: '합성어·파생어·구는 사용할 수 없어요.',
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

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };

/** 뜻풀이의 HTML 이스케이프와 태그(<FL>비규범</FL>, <IN>, <DR> …)를 걷어내 표시용 문자열로 만든다. */
export function cleanDefinition(def) {
  let s = String(def ?? '');
  for (let i = 0; i < 2 && /&(lt|gt|amp|quot|apos|#39|nbsp);/.test(s); i++) {
    s = s.replace(/&(lt|gt|amp|quot|apos|#39|nbsp);/g, (_, k) => ENTITIES[k]);
  }
  return s.replace(/<\/?[A-Za-z][^<>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v) {
  return v == null ? '' : String(v).trim();
}

/** 우리말샘 응답 item 하나를 정규화한다. (실제 응답은 sense 안에 필드가 있지만, item 쪽에 있어도 읽는다) */
export function normalizeItem(item) {
  const senses = asArray(item.sense).map((s) => ({
    targetCode: text(s.target_code ?? s.targetCode ?? item.target_code ?? item.targetCode) || null,
    senseNo: s.sense_no ?? s.senseNo ?? null,
    definition: cleanDefinition(s.definition),
    pos: text(s.pos || item.pos),
    type: text(s.type || item.type),
    cat: text(s.cat || s.category || item.cat),
    origin: text(s.origin || item.origin),
    link: text(s.link),
  }));
  return {
    word: text(item.word),
    cleanWord: cleanHeadword(item.word),
    supNo: item.sup_no ?? item.supNo ?? null,
    wordUnit: text(item.word_unit || item.wordUnit),
    wordType: text(item.word_type || item.wordType),
    senses,
  };
}

/** 품사가 (일반) 명사인가. "관·명"(관형사·명사) 처럼 명사를 포함한 조합 품사도 명사로 본다. */
export function isNounPos(pos) {
  return text(pos).split('·').some((p) => p.trim() === '명사' || p.trim() === '명');
}

// 원어(origin)에 로마자·가나·그리스·키릴 문자가 있으면 외래어(또는 외래어가 섞인 혼종어)로 본다.
// 예) "computer", "←apartment", "▼hand phone", "金medal", "←zhajiangmian[炸醬麵]"  → 외래어
//     "沙果", "三춘", "" (고유어)                                                   → 외래어 아님
const FOREIGN_SCRIPT = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ぀-ヿ]/;

export function isForeignOrigin(origin) {
  return FOREIGN_SCRIPT.test(text(origin));
}

const QUOTE = '[‘\'"「]([^’\'"」]+)[’\'"」]';
// "… ⇒규범 표기는 ‘설거지’이다."  /  "‘발자국’의 잘못"  /  "→ 닭볶음탕."
const NORM_SPELLING = new RegExp(`⇒\\s*규범\\s*표기는\\s*${QUOTE}`);
const WRONG_FORM = new RegExp(`${QUOTE}\\s*의\\s*(잘못|비표준어|준말이 아닌)`);
const ARROW = /^\s*→\s*([^.\s]+)/;
// "‘부추’의 방언" / "‘내일’의 북한어." / "‘천’의 옛말."
const OF_TYPE = new RegExp(`${QUOTE}\\s*의\\s*(방언|북한어|옛말)`);

/** 비표준 항목이면 규범 표기(표준어)를, 아니면 null 을 돌려준다. */
export function nonStandardHint(def) {
  if (!def) return null;
  const m = def.match(NORM_SPELLING) || def.match(WRONG_FORM) || def.match(ARROW);
  return m ? m[1] : null;
}

function isNonStandardDefinition(def) {
  return nonStandardHint(def) != null;
}

/** 방언·북한어·옛말 뜻풀이에서 대응하는 표준어를 찾는다. */
function standardOf(def) {
  const m = text(def).match(OF_TYPE);
  return m ? m[1] : null;
}

function isProperNoun(sense) {
  if (PROPER_NOUN_CATS.has(sense.cat)) return true;
  if (/고유\s?명사/.test(sense.type)) return true;
  return isTitledWork(sense);
}

// "이인성이 그린 그림.", "조정래가 지은 대하소설.", "방한준 감독이 만든 영화.", "김재태 작사, 김성현 작곡의 대중가요."
const WORK_VERB = /(작사|작곡|감독|지은|그린|쓴|만든|제작|발표|간행|출간|연출|편찬|촬영)/;
const WORK_NOUN = /(그림|대중가요|가곡|가요|노래|영화|시집|소설|수필집|산문집|희곡|작품|드라마|앨범|음반|저서|철학서|평론집|시나리오|만화|애니메이션|연극|뮤지컬|오페라|교향곡|협주곡)/;

function isTitledWork(sense) {
  if (!WORK_CATS.has(sense.cat)) return false;
  const head = sense.definition.split(/[.。]/)[0];
  return WORK_VERB.test(head) && WORK_NOUN.test(head);
}

/** 뜻풀이 하나에 규칙을 적용해 실패 사유(없으면 null)를 돌려준다. */
function senseReason(sense, item) {
  const typeReason = NON_STANDARD_TYPES[sense.type];
  if (typeReason) return typeReason;
  if (!isNounPos(sense.pos)) {
    // 구(가정^법원)·속담·관용구는 품사가 비어 온다. 이때는 '명사가 아님'보다 '구'라고 알려 주는 편이 낫다.
    return sense.pos === '' && /\^/.test(item.word) ? 'compound' : 'not_noun';
  }
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

  // 뜻풀이 단위 규칙(범주·품사·고유 명사·비표준·외래어)을 먼저 본다.
  const reasons = new Map();
  let passing = null;
  for (const sense of item.senses) {
    let r = senseReason(sense, item);
    if (!r && !opts.allowLoanwords && (item.wordType === '외래어' || isForeignOrigin(sense.origin))) r = 'foreign';
    if (r) reasons.set(r, (reasons.get(r) ?? 0) + 1);
    else if (!passing) passing = sense;
  }
  if (!passing) {
    if (reasons.size === 0) reasons.set('not_noun', 1);
    const reason = pickReason(reasons);
    return { ok: false, reason, item, reasons, hint: hintFor(reason, item) };
  }

  // 표제어 단위 규칙(합성어·구)
  if (!opts.allowCompound) {
    if (/[-^]/.test(item.word)) return { ok: false, reason: 'compound', item };
    if (item.wordUnit && item.wordUnit !== '단어') return { ok: false, reason: 'compound', item };
  }
  return { ok: true, item, sense: passing };
}

/** 실패 사유에 맞는 힌트(대응 표준어)를 찾는다. */
function hintFor(reason, item) {
  for (const s of item.senses) {
    if (reason === 'nonstandard') {
      const h = nonStandardHint(s.definition);
      if (h) return h;
    } else if (reason === 'dialect' || reason === 'north' || reason === 'old') {
      const h = standardOf(s.definition);
      if (h) return h;
    }
  }
  return null;
}

/**
 * 여러 실패 사유 중 하나를 고른다: 해당하는 뜻풀이(동형어)가 가장 많은 사유, 같으면 REASON_PRIORITY 순.
 * @param {Map<string, number>} reasons  사유 → 뜻풀이 수
 */
function pickReason(reasons) {
  let best = null;
  for (const r of REASON_PRIORITY) {
    const n = reasons.get(r) ?? 0;
    if (n > 0 && (best === null || n > reasons.get(best))) best = r;
  }
  return best ?? 'nonstandard';
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

  const reasons = new Map();
  const hints = new Map();
  for (const raw of matched) {
    const res = evaluateItem(raw, opts);
    if (res.ok) return { ok: true, word, entry: toEntry(res.item, res.sense) };
    // 표제어 단위 사유(compound 등)는 1로, 뜻풀이 단위 사유는 뜻풀이 수만큼 센다.
    for (const [r, n] of res.reasons ?? [[res.reason, 1]]) reasons.set(r, (reasons.get(r) ?? 0) + n);
    if (res.hint && !hints.has(res.reason)) hints.set(res.reason, res.hint);
  }
  let reason = pickReason(reasons);
  // 표제어가 전부 합성어·파생어·구(-, ^)이고 그중 규칙을 통과하는 뜻이 있었다면, 다른 동형어의 사유보다 합성어를 알려 준다.
  // (예: 사과-나무 = 식물 + 책명 + 그림 → 고유 명사가 아니라 합성어)
  if (reasons.has('compound') && matched.every((it) => /[-^]/.test(String(it.word ?? '')))) reason = 'compound';
  return fail(reason, word, hints.get(reason) ?? null);
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
    targetCode: sense.targetCode,
    supNo: item.supNo,
    origin: sense.origin,
    wordType: item.wordType,
    pos: sense.pos,
    definition: sense.definition,
    cat: sense.cat,
    link: sense.link,
  };
}

function fail(reason, word, hint = null) {
  let message = REASON_MESSAGES[reason] ?? REASON_MESSAGES.nonstandard;
  if (hint && hint !== word) message += ` (표준어: ${hint})`;
  const out = { ok: false, word, reason, message };
  if (hint) out.hint = hint;
  return out;
}
