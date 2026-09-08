// 한글 음절 처리 유틸리티 (두음법칙 등)

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

// 초성 인덱스
const CHO_N = 2; // ㄴ
const CHO_R = 5; // ㄹ
const CHO_IEUNG = 11; // ㅇ

// 중성 인덱스
const JUNG = {
  ㅏ: 0, ㅐ: 1, ㅑ: 2, ㅒ: 3, ㅓ: 4, ㅔ: 5, ㅕ: 6, ㅖ: 7, ㅗ: 8, ㅘ: 9, ㅙ: 10,
  ㅚ: 11, ㅛ: 12, ㅜ: 13, ㅝ: 14, ㅞ: 15, ㅟ: 16, ㅠ: 17, ㅡ: 18, ㅢ: 19, ㅣ: 20,
};

const N_TO_IEUNG = new Set([JUNG.ㅕ, JUNG.ㅛ, JUNG.ㅠ, JUNG.ㅣ]); // 녀 뇨 뉴 니 → 여 요 유 이
const R_TO_IEUNG = new Set([JUNG.ㅑ, JUNG.ㅕ, JUNG.ㅖ, JUNG.ㅛ, JUNG.ㅠ, JUNG.ㅣ]); // 랴 려 례 료 류 리 → 야 여 예 요 유 이
const R_TO_N = new Set([JUNG.ㅏ, JUNG.ㅐ, JUNG.ㅗ, JUNG.ㅚ, JUNG.ㅜ, JUNG.ㅡ]); // 라 래 로 뢰 루 르 → 나 내 노 뇌 누 느

export function isHangulSyllable(ch) {
  const code = ch.codePointAt(0);
  return code >= HANGUL_BASE && code <= HANGUL_LAST;
}

export function isHangulWord(str) {
  return typeof str === 'string' && str.length > 0 && [...str].every(isHangulSyllable);
}

export function decompose(ch) {
  const code = ch.codePointAt(0) - HANGUL_BASE;
  return {
    cho: Math.floor(code / 588),
    jung: Math.floor((code % 588) / 28),
    jong: code % 28,
  };
}

export function compose({ cho, jung, jong }) {
  return String.fromCodePoint(HANGUL_BASE + cho * 588 + jung * 28 + jong);
}

/** 두음법칙을 적용한 음절을 돌려준다. 적용 대상이 아니면 null. */
export function applyDueum(ch) {
  if (!isHangulSyllable(ch)) return null;
  const { cho, jung, jong } = decompose(ch);
  if (cho === CHO_N && N_TO_IEUNG.has(jung)) return compose({ cho: CHO_IEUNG, jung, jong });
  if (cho === CHO_R && R_TO_IEUNG.has(jung)) return compose({ cho: CHO_IEUNG, jung, jong });
  if (cho === CHO_R && R_TO_N.has(jung)) return compose({ cho: CHO_N, jung, jong });
  return null;
}

/**
 * 이전 단어의 마지막 글자를 받아 다음 단어가 시작할 수 있는 글자 목록을 돌려준다.
 * 두음법칙 허용 시 원래 글자 + 두음법칙 적용 글자.
 */
export function allowedStarts(lastChar, { dueum = true } = {}) {
  const starts = [lastChar];
  if (dueum) {
    const alt = applyDueum(lastChar);
    if (alt && alt !== lastChar) starts.push(alt);
  }
  return starts;
}

export function lastSyllable(word) {
  return [...word].at(-1);
}

/** 조사 '으로/로' 선택: 받침이 있으면(ㄹ 제외) '으로', 없으면 '로' */
export function euro(word) {
  const ch = lastSyllable(word);
  if (!isHangulSyllable(ch)) return '(으)로';
  const { jong } = decompose(ch);
  return jong === 0 || jong === 8 ? '로' : '으로';
}

// ───────────────────────── 초성 / 두음법칙 역방향 ─────────────────────────

export const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
export const JUNGSEONG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];

/** 단어의 초성 문자열 ("사과" → "ㅅㄱ"). 한글 음절이 아닌 글자는 그대로 둔다. */
export function choseongOf(word) {
  return [...String(word ?? '')].map((ch) => (isHangulSyllable(ch) ? CHOSEONG[decompose(ch).cho] : ch)).join('');
}

/** 초성 자모인가 (ㄱ~ㅎ) */
export function isChoseongLetter(ch) {
  return CHOSEONG.includes(ch);
}

export function isChoseongString(str) {
  return typeof str === 'string' && str.length > 0 && [...str].every(isChoseongLetter);
}

/** 이 초성으로 시작하는 음절들 (받침 없음). 흔한 모음 순. 컴퓨터가 초성 문제의 후보 단어를 찾을 때 쓴다. */
export function syllablesWithCho(choLetter, { jungs = ['ㅏ', 'ㅓ', 'ㅗ', 'ㅜ', 'ㅡ', 'ㅣ', 'ㅐ', ' ㅔ', 'ㅕ', 'ㅑ', 'ㅛ', 'ㅠ', 'ㅢ', 'ㅚ', 'ㅟ', 'ㅘ', 'ㅝ', 'ㅖ', 'ㅒ', 'ㅙ', 'ㅞ'] } = {}) {
  const cho = CHOSEONG.indexOf(choLetter);
  if (cho < 0) return [];
  return jungs.map((j) => JUNG[j.trim()]).filter((j) => j != null).map((jung) => compose({ cho, jung, jong: 0 }));
}

/**
 * 두음법칙 역방향: 이 글자가 두음법칙의 결과일 수 있는 원래 글자들.
 * (앞말잇기에서 앞 단어가 '역사'로 시작하면 다음 단어는 '역' 또는 '력'으로 끝나도 된다)
 *   여 → [녀, 려], 요 → [뇨, 료], 이 → [니, 리], 야 → [랴], 예 → [례], 나 → [라], 노 → [로] …
 */
export function dueumSources(ch) {
  if (!isHangulSyllable(ch)) return [];
  const { cho, jung, jong } = decompose(ch);
  const out = [];
  if (cho === CHO_IEUNG) {
    if (N_TO_IEUNG.has(jung)) out.push(compose({ cho: CHO_N, jung, jong }));
    if (R_TO_IEUNG.has(jung)) out.push(compose({ cho: CHO_R, jung, jong }));
  } else if (cho === CHO_N && R_TO_N.has(jung)) {
    out.push(compose({ cho: CHO_R, jung, jong }));
  }
  return out;
}

/** 앞말잇기: 앞 단어의 첫 글자를 받아 다음 단어가 끝나야 하는 글자 목록. */
export function allowedEnds(firstChar, { dueum = true } = {}) {
  const ends = [firstChar];
  if (dueum) for (const s of dueumSources(firstChar)) if (!ends.includes(s)) ends.push(s);
  return ends;
}

export function firstSyllable(word) {
  return [...word][0];
}

/** 조사 '으로/로' 와 짝을 이루는 '이/가' 선택 */
export function iga(word) {
  const ch = lastSyllable(word);
  if (!isHangulSyllable(ch)) return '이(가)';
  return decompose(ch).jong === 0 ? '가' : '이';
}
